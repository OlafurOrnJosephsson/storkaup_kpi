---
description: clasp push + bump versioned web-app deployment + git commit & push
---

Deploy the GAS project end-to-end. Steps:

1. If any `Webflow/*.js` files changed in the working tree, run `node --check` on each; abort on syntax error.
2. `clasp push` — upload code to Apps Script.
3. Bump the **versioned** web-app deployment to a new version (keeps the same `/exec` URL the Webflow iframes use):
   ```
   clasp deploy -i AKfycbwgKkjKG64Avj4qoCgZOzbDd8mGvhtEf4IaT1-LTawVurQwfZ5OFLNsieCKZIJw3noA4w -d "<short description>"
   ```
   (The other deployment, `AKfycbyvxp5JmYoo6Fdb7gFZWwb9gSiAuE2EZYvn3N3oBCTI`, is `@HEAD` — never target it.)
4. Stage the changed files, commit, and `git push origin main`.

Use `$ARGUMENTS` as the deploy/commit description when provided; otherwise summarize the changes yourself.

Report back: the new deployment version number and the commit hash.

Notes:
- `git push` (GitHub/jsDelivr, for Webflow) and `clasp push` (Apps Script) are separate — this command does both.
- Never create a *new* deployment (changes the `/exec` URL and breaks the Webflow iframe). Only `-i` the existing versioned one.
