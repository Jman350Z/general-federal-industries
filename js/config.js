// GFI site configuration (staging).
// API base for the gfi-intake Worker. This is the account's workers.dev
// subdomain — CONFIRM at deploy time. When generalfederalindustries.com
// moves behind Cloudflare, route the Worker at
// generalfederalindustries.com/api and set this to "/api" instead, and
// update the connect-src origin in request.html's CSP to match.
window.GFI_API_URL = "https://gfi-intake.jeffpruden288.workers.dev";
