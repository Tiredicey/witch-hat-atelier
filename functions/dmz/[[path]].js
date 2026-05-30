// Cloudflare Pages Function: same-origin /dmz/* routes.
//
// Mirrors functions/fetch.js and functions/discover.js: re-exports the Worker
// handler from worker/src/index.js, which already dispatches /dmz/* to
// handleDmz. The [[path]] catch-all matches every /dmz/... path (health,
// messages, message, file, migrate) so the Pages deploy serves the whole DMZ
// API on its own origin (e.g. https://witch-hat-atelier.pages.dev/dmz/health)
// with no separate Worker subdomain.
//
// Set the DMZ environment variables on the Pages project
// (Pages project -> Settings -> Variables and Secrets):
//   Secrets: DMZ_GITHUB_TOKEN, DMZ_HMAC_SECRET, DMZ_OWNER_TOKEN,
//            DMZ_TELEGRAM_TOKEN, DMZ_TELEGRAM_CHAT
//   Text:    DMZ_GITHUB_OWNER, DMZ_GITHUB_REPO, DMZ_GITHUB_BRANCH,
//            DMZ_ALLOWED_ORIGINS, DMZ_MAX_FILE_MB

import worker from "../../worker/src/index.js";

export const onRequest = ({ request, env }) => worker.fetch(request, env);
