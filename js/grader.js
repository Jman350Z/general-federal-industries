// Lost-Lead Grader — the whole calculation, in the open.
// monthly requests = weekly x 4.33; "waits" = share not answered same-day;
// lost jobs = one third of waits (a stated planning assumption, shown on
// the page); lost dollars = lost jobs x typical job value.
(function () {
  var form = document.getElementById("grader-form");
  if (!form) return;
  function money(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var weekly = Math.max(0, Number(document.getElementById("g-weekly").value) || 0);
    var warm = Number(document.getElementById("g-warm").value) || 0;
    var job = Math.max(0, Number(document.getElementById("g-job").value) || 0);
    var where = document.getElementById("g-where").value;

    var monthly = weekly * 4.33;
    var waits = monthly * (1 - warm);
    var lostJobs = waits / 3;
    var lostMoney = lostJobs * job;

    document.getElementById("r-waits").textContent = String(Math.round(waits));
    document.getElementById("r-lost").textContent = money(lostMoney);
    document.getElementById("r-year").textContent = money(lostMoney * 12);
    document.getElementById("r-note").textContent =
      where === "scattered"
        ? "And one more thing your answers point at: when requests live in personal texts and separate inboxes, nobody can see the whole queue — which is how the waits happen in the first place."
        : where === "one-inbox"
          ? "One shared inbox is a good start. The gap that usually remains: nothing flags a request — or a quote — that's been sitting too long, so it waits quietly until it's cold."
          : "You've already got the shared system — then your lever is speed on quotes and a stale-warning on anything that sits. That's the part most systems skip.";
    var result = document.getElementById("grader-result");
    result.style.display = "block";
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  });
})();
