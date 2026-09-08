---
description: clasp push + bump versioned web-app deployment (BOTH projects) + git commit & push
---

Deploy the GAS projects end-to-end. Steps:

1. If any `Webflow/*.js` files changed in the working tree, run `node --check` on each; abort on syntax error.
2. Push **and** cut a new version on **both** Apps Script projects:
   ```
   .\gas_deploy.ps1 "<short description>"
   ```
   That script is the single source of truth for the deployment IDs. It pushes
   the root project and `admin/`, then bumps each one's *versioned* deployment
   (keeping the same `/exec` URLs). It refuses to target either `@HEAD`
   deployment and aborts before pushing if a `.clasp.json` is missing.
3. Stage the changed files, commit, and `git push origin main`.

Use `$ARGUMENTS` as the deploy/commit description when provided; otherwise summarize the changes yourself.

Report back: the new deployment version number **for each project** and the commit hash.

Notes:
- **Both projects need a new version, not just a push.** Live `/exec` runs a
  pinned version, so `clasp push` alone only moves `@HEAD`. This bites in a
  non-obvious way: the admin app's "Keyra aftur" button calls `doPost` on the
  *main* project's `/exec`, which is also pinned. Push the main project without
  deploying it and that button runs the old code, overwriting fresh results
  with stale ones.
- `clasp` only ever works on one project at a time (it reads `.clasp.json` from
  the current directory), which is why the wrapper script exists. Running a
  bare `clasp push` from the repo root silently covers only half the code —
  `.claspignore` excludes `admin/**`.
- `git push` (GitHub/jsDelivr, for Webflow) and `clasp push` (Apps Script) are
  separate — this command does both.
- Never create a *new* deployment (changes the `/exec` URL, breaking the Webflow
  iframe and the nav links to the admin apps). The script only ever uses `-i`.
- A bare `clasp push` from the root also carries **every** uncommitted change
  under `core/`, plus any `.js` in a non-ignored subdirectory. Check
  `git status` first, and be sure any new `.js` is real Apps Script code — a
  top-level `require()` throws on load and kills every trigger in the project.
