// GFI client sign-in + work-request intake (request.html).
// No user-supplied string is ever inserted with innerHTML — everything
// renders through textContent, so a hostile organization name or detail
// line can't inject markup into this page.
"use strict";

var API = (window.GFI_API_URL || "").replace(/\/+$/, "");
var TOKEN_KEY = "gfi_token";
var cfg = { googleClientId: "", turnstileSiteKey: "", emailVerification: false };
var turnstileWidgetId = null;

function el(id) { return document.getElementById(id); }
function token() { return localStorage.getItem(TOKEN_KEY) || ""; }
function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function post(path, body) {
  var r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  var d = null;
  try { d = await r.json(); } catch (e) { /* non-JSON error page */ }
  return { status: r.status, data: d };
}

function setMsg(id, text, ok) {
  var m = el(id);
  m.textContent = text || "";
  m.className = "msg " + (ok === true ? "ok" : ok === false ? "err" : "");
}

/* ---------- Turnstile (only when the Worker reports a site key) ---------- */
function loadTurnstile() {
  if (!cfg.turnstileSiteKey) return;
  var s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.async = true;
  s.onload = function () {
    try {
      turnstileWidgetId = window.turnstile.render("#turnstile-box", {
        sitekey: cfg.turnstileSiteKey,
      });
    } catch (e) { /* widget unavailable — server still rate-limits */ }
  };
  document.head.appendChild(s);
}
function turnstileToken() {
  try {
    if (turnstileWidgetId !== null && window.turnstile) {
      return window.turnstile.getResponse(turnstileWidgetId) || "";
    }
  } catch (e) { /* fall through */ }
  return "";
}
function turnstileReset() {
  try {
    if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId);
  } catch (e) { /* noop */ }
}

/* ---------- Google sign-in (only when a client id is configured) ---------- */
function loadGoogle() {
  if (!cfg.googleClientId) return;
  var s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client";
  s.async = true;
  s.onload = function () {
    try {
      window.google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async function (resp) {
          var r = await post("/auth/google", { idToken: resp.credential });
          if (r.data && r.data.ok && r.data.token) {
            setToken(r.data.token);
            onSignedIn(r.data.email);
          } else {
            setMsg("auth-msg", "Google sign-in failed (" + ((r.data && r.data.error) || r.status) + ").", false);
          }
        },
      });
      window.google.accounts.id.renderButton(el("google-btn"), {
        theme: "outline", size: "large", text: "signin_with",
      });
    } catch (e) { /* Google unavailable — email path still works */ }
  };
  document.head.appendChild(s);
}

/* ---------- sign-in flows ---------- */
async function sendCode() {
  var email = el("auth-email").value.trim();
  if (!email) { setMsg("auth-msg", "Enter your email first.", false); return; }
  setMsg("auth-msg", "Sending your code…");
  var r = await post("/auth/code", { email: email, turnstileToken: turnstileToken() });
  turnstileReset();
  if (r.data && r.data.ok) {
    el("code-step").hidden = false;
    setMsg("auth-msg", "Code sent — check your inbox, then enter it below.", true);
  } else if (r.data && r.data.error === "email_not_configured") {
    el("register-step").hidden = false;
    setMsg("auth-msg", "Email codes are being set up — use the account option below.", false);
  } else if (r.data && r.data.error === "bot_check_failed") {
    setMsg("auth-msg", "The bot check failed — please complete it and try again.", false);
  } else {
    setMsg("auth-msg", "Could not send a code (" + ((r.data && r.data.error) || r.status) + ").", false);
  }
}

async function verifyCode() {
  var email = el("auth-email").value.trim();
  var code = el("auth-code").value.trim();
  var name = el("auth-name").value.trim();
  var r = await post("/auth/verify", { email: email, code: code, name: name });
  if (r.data && r.data.ok && r.data.token) {
    setToken(r.data.token);
    onSignedIn(r.data.email);
  } else {
    setMsg("auth-msg", "That code didn't work (" + ((r.data && r.data.error) || r.status) + ").", false);
  }
}

async function registerFallback() {
  var email = el("auth-email").value.trim();
  var name = el("auth-name").value.trim();
  if (!email) { setMsg("auth-msg", "Enter your email first.", false); return; }
  var r = await post("/auth/register", { email: email, name: name, turnstileToken: turnstileToken() });
  turnstileReset();
  if (r.data && r.data.ok && r.data.token) {
    setToken(r.data.token);
    onSignedIn(email);
  } else {
    setMsg("auth-msg", "Could not create the account (" + ((r.data && r.data.error) || r.status) + ").", false);
  }
}

function onSignedIn(email) {
  el("signin-box").hidden = true;
  el("signedin-box").hidden = false;
  el("who").textContent = email || "";
  el("form-section").hidden = false;
  el("mine-section").hidden = false;
  loadMine();
}

function signOut() {
  setToken("");
  el("signin-box").hidden = false;
  el("signedin-box").hidden = true;
  el("form-section").hidden = true;
  el("mine-section").hidden = true;
  el("mine-list").textContent = "";
}

/* ---------- the form ---------- */
var FIELDS = ["organization", "contactName", "contactEmail", "phone", "category",
  "state", "location", "budget", "timeline", "details"];
var FIELD_LABELS = {
  organization: "Organization", contactName: "Contact name", contactEmail: "Contact email",
  phone: "Phone (a US number, e.g. (209) 555-0100)", category: "Work type",
  state: "State", location: "Service location", budget: "Budget — required",
  timeline: "Timeline — required", details: "Details (a sentence or two about the work)",
};
var MAX_PDF = 10 * 1024 * 1024;

function clearFieldErrors() {
  FIELDS.concat(["file"]).forEach(function (f) {
    var e = el("e-" + f);
    if (e) e.textContent = "";
  });
}
function showFieldErrors(fields) {
  Object.keys(fields || {}).forEach(function (f) {
    var e = el("e-" + f);
    if (e) e.textContent = "Please check this field (" + fields[f].replace(/_/g, " ") + ").";
  });
}

async function submitForm(ev) {
  ev.preventDefault();
  clearFieldErrors();
  setMsg("form-msg", "");
  var body = { token: token(), turnstileToken: turnstileToken() };
  FIELDS.forEach(function (f) { body[f] = el("f-" + f).value; });
  var fileInput = el("f-file");
  var file = fileInput.files && fileInput.files[0];
  if (file) {
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) {
      el("e-file").textContent = "Only PDF files are accepted.";
      return;
    }
    if (file.size > MAX_PDF) {
      el("e-file").textContent = "That PDF is over the 10 MB limit.";
      return;
    }
    if (file.size === 0) {
      el("e-file").textContent = "That file is empty.";
      return;
    }
  }
  var btn = el("submit-btn");
  btn.disabled = true;
  setMsg("form-msg", "Sending…");
  try {
    var r = await post("/intake/submit", body);
    turnstileReset();
    if (!r.data || !r.data.ok) {
      if (r.data && r.data.error === "validation_failed") {
        showFieldErrors(r.data.fields);
        setMsg("form-msg", "A few fields need attention — see above.", false);
      } else if (r.data && r.data.error === "signed_out") {
        setMsg("form-msg", "You've been signed out — sign in again to send.", false);
        signOut();
      } else if (r.data && r.data.error === "bot_check_failed") {
        setMsg("form-msg", "The bot check failed — please complete it and try again.", false);
      } else {
        setMsg("form-msg", "Could not send (" + ((r.data && r.data.error) || r.status) + ").", false);
      }
      return;
    }
    var id = r.data.submissionId;
    if (file) {
      setMsg("form-msg", "Request saved — sending your PDF into the security scanner…");
      var buf = await file.arrayBuffer();
      var up = await fetch(API + "/intake/upload", {
        method: "POST",
        headers: {
          "content-type": "application/pdf",
          "x-session-token": token(),
          "x-submission-id": id,
          "x-file-name": file.name,
        },
        body: buf,
      });
      var ud = null;
      try { ud = await up.json(); } catch (e) { /* noop */ }
      if (!up.ok || !ud || !ud.ok) {
        setMsg("form-msg",
          "Your request was saved, but the PDF upload failed (" +
          ((ud && ud.error) || up.status) + "). Sign in and try the upload again from a new request, or email us the document instead.", false);
        loadMine();
        return;
      }
      setMsg("form-msg", scanStatusCopy(ud.scanStatus, true), true);
    } else {
      setMsg("form-msg", "Request sent — thank you. We review every request personally and reply by email.", true);
    }
    el("intake-form").reset();
    loadMine();
  } catch (e) {
    setMsg("form-msg", "Network problem — the request may not have been sent. Please try again.", false);
  } finally {
    btn.disabled = false;
  }
}

function scanStatusCopy(s, justUploaded) {
  switch (s) {
    case "awaiting_scanner":
      return "PDF received and locked in quarantine — it will be security-scanned before our team can open it.";
    case "scanning":
      return "PDF received — its security scan is running. Our team can open it once it clears.";
    case "clean":
      return "PDF received and scanned clean — our team can open it now.";
    case "infected":
      return "Warning: the security scan flagged your PDF, so it stays locked and our team cannot open it. Please send a clean copy.";
    case "scan_error":
      return "The security scan hit a problem, so your PDF stays locked for now — our team can re-run the scan.";
    default:
      return justUploaded ? "PDF received." : "";
  }
}

/* ---------- your requests ---------- */
function fieldLine(label, value) {
  var p = document.createElement("p");
  var b = document.createElement("strong");
  b.textContent = label + ": ";
  p.appendChild(b);
  p.appendChild(document.createTextNode(value == null ? "" : String(value)));
  return p;
}

async function loadMine() {
  if (!token()) return;
  var r = await post("/intake/list", { token: token() });
  var list = el("mine-list");
  list.textContent = "";
  if (!r.data || !r.data.ok) return;
  if (!r.data.submissions.length) {
    var p = document.createElement("p");
    p.textContent = "No requests yet.";
    list.appendChild(p);
    return;
  }
  r.data.submissions.forEach(function (s) {
    var card = document.createElement("div");
    card.className = "sub-card";
    var h = document.createElement("h3");
    h.textContent = s.organization + " — " + s.category;
    card.appendChild(h);
    card.appendChild(fieldLine("Location", s.location + ", " + s.state));
    card.appendChild(fieldLine("Budget", s.budget));
    card.appendChild(fieldLine("Timeline", s.timeline));
    card.appendChild(fieldLine("Status", s.status));
    if (s.file) {
      var fp = document.createElement("p");
      var fb = document.createElement("strong");
      fb.textContent = "PDF: ";
      fp.appendChild(fb);
      fp.appendChild(document.createTextNode(s.file.fileName + " — "));
      var badge = document.createElement("span");
      badge.className = "badge " +
        (s.file.scanStatus === "clean" ? "clean" :
         s.file.scanStatus === "infected" || s.file.scanStatus === "scan_error" ? "locked" : "pending");
      badge.textContent = s.file.scanStatus.replace(/_/g, " ");
      fp.appendChild(badge);
      card.appendChild(fp);
      var note = document.createElement("p");
      note.className = "hint";
      note.textContent = scanStatusCopy(s.file.scanStatus, false);
      card.appendChild(note);
    }
    list.appendChild(card);
  });
}

/* ---------- boot ---------- */
var STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","GU","VI","AS","MP"];
function fillStates() {
  var sel = el("f-state");
  STATES.forEach(function (st) {
    var o = document.createElement("option");
    o.value = st;
    o.textContent = st;
    sel.appendChild(o);
  });
}

document.addEventListener("DOMContentLoaded", async function () {
  fillStates();
  el("auth-send-code").addEventListener("click", sendCode);
  el("auth-verify").addEventListener("click", verifyCode);
  el("auth-register").addEventListener("click", registerFallback);
  el("signout").addEventListener("click", signOut);
  el("intake-form").addEventListener("submit", submitForm);
  try {
    var r = await fetch(API + "/auth/config");
    var d = await r.json();
    if (d && d.ok) cfg = d;
  } catch (e) { /* API unreachable — form explains on submit */ }
  loadGoogle();
  loadTurnstile();
  if (token()) {
    var s = await post("/auth/session", { token: token() });
    if (s.data && s.data.ok) onSignedIn(s.data.email);
    else setToken("");
  }
});
