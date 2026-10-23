# CLAUDE.md

Guidance for Claude Code in this repo. This file holds only what almost every
task needs. Reference material lives elsewhere and loads when relevant:

| Where | What |
|---|---|
| [RUNBOOK.md](RUNBOOK.md) | Deploy flags, BC import, Magento off switch, safePoll watchdog, triggers + their history, **Webflow deploy and pins** (mechanics, fallbacks, incidents), GA4 data breaks |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Data flow, web-app split, trigger table, Supabase layout, PIM lock, Webflow pages |
| [NEXT_TASKS.md](NEXT_TASKS.md) | Open work, release notes |
| `SECURITY_REVIEW.md` · `SECURITY_RESPONSE.md` | Security history (e.g. the `loadConfig()` exposure) |
| [.claude/rules/](.claude/rules/) | Path-scoped rules: Webflow, SEO manager, GA4/GTM, Klaviyo profiles, PIM lock |
| `/deploy` ([.claude/commands/deploy.md](.claude/commands/deploy.md)) | The deploy checklist |

## Deploy workflow

```bash
.\gas_deploy.ps1 "short description"   # push + new version, BOTH projects
git add <the files you changed>          # by name — never `git add .` / `-A`
git commit -m "..."
git push
```

Stage by name: the working tree carries unrelated local files (e.g.
`GAS.code-workspace`) that must not be committed.

- **Two Apps Script projects:** Main (repo root — ingest + anonymous web app)
  and Admin-apps (`admin/` — PII apps behind Google login; excluded from the
  main push by `.claspignore`). `clasp` reads `.clasp.json` from the current
  directory, so **a bare `clasp push` from the root covers only half the code.**
- [gas_deploy.ps1](gas_deploy.ps1) is the single source of truth for both
  deployment IDs and refuses either `@HEAD` deployment. **Never create a new
  deployment** (`clasp deploy` without `-i`) — it changes the `/exec` URL and
  breaks the Webflow iframe and the nav links to the admin apps.
- Changes go live only on a **new version**, not on `clasp push` (that moves
  `@HEAD`; `/exec` runs the pinned version). **The main project too:** the admin
  app's "Keyra aftur" button calls the main project's pinned `/exec`; push
  without deploying and it runs old code, overwriting fresh results with stale.
- **Check `git status` first.** A root push uploads every uncommitted change
  under `core/` and any `.js` in a non-ignored subdirectory (`pim/` included).
  A new `.js` must be real Apps Script — a top-level `require()` throws on load
  and kills every trigger in the project.
- `Webflow/*.js` is not pushed by clasp: it ships via GitHub → jsDelivr at a
  pinned commit. Run `node --check Webflow/<file>.js` first. It takes **two
  commits**: push the source, publish the new pin in Webflow, *then* update the
  pin table, run the check and commit that. Steps and which pin to move:
  [RUNBOOK.md → Webflow deploy and production pins](RUNBOOK.md#webflow-deploy-and-production-pins).
- `-Only Main|Admin`, `-PushOnly` and the 200-version limit:
  [RUNBOOK.md → Deploying](RUNBOOK.md#deploying-gas_deployps1).

## Architecture

```
Magento / BC / Klaviyo / GA4 / Cludo / storkaup.is GraphQL / Typeform
        ↓
Google Apps Script (core/*.js)     ← scheduled triggers, ingest
        ↓
Supabase raw.* → mart.* → api.* / public.* RPCs
        ↓
Webflow (Webflow/*.js)             ← dashboards; the customer page writes flags via RPC
```

No backend server. All ingest runs in Apps Script on time-based triggers.
SQL lives in `core/sql/` and is applied by hand in the Supabase SQL editor.

## Where things live

Every Apps Script function is global across its project; the file only matters
for reading and editing. `clasp` flattens `core/x.js` to `core/x`.

| File | Holds |
|---|---|
| [core/utils.js](core/utils.js) | The grab-bag (~5k lines). Trigger management (`auditTriggers_v1`, `resetRecommendedTimeTriggers_v1`, `requiredTimeTriggers_`, `install*Trigger*`), BC drop, sanity checks, Supabase upserts, Klaviyo events sync, shared helpers. |
| [core/menu.js](core/menu.js) | `onOpen` and every `menu_*` entry point — start here to find what a menu item calls. |
| [core/config.js](core/config.js) · [core/schema.js](core/schema.js) | `loadConfig_()`; `STORKAUP_SCHEMA` header maps (data only). |
| [core/newsales_v2.js](core/newsales_v2.js) | Magento NEWWEB ingest, `safePoll_v2` and its run-window gate. |
| [core/auth.js](core/auth.js) | Magento admin token cache; `isMagentoApiEnabled_()`. |
| [core/salessummaries.js](core/salessummaries.js) | Sales summary sheets and marts. |
| [core/customers.js](core/customers.js) · [core/customer_analysis.js](core/customer_analysis.js) | Magento customers; customer profiles and scoring. |
| [core/cludo.js](core/cludo.js) | Cludo search API, PRODUCTS master catalog, weekly index cleanup (`cludoHreinsaVaraDocs_v1`), search watch (`evaluateCludoSearchHealth_`). Frontend fixes needed from Hagar: `docs/cludo/`. |
| [core/storkaup_pricing.js](core/storkaup_pricing.js) | storkaup.is GraphQL: price and product health (feeds vöruvöktun), zero-price scan. |
| [core/web_catalog.js](core/web_catalog.js) | Published product list → `raw.web_catalog`; the only source of supplier `brand_sku`. |
| [core/klaviyo_profiles.js](core/klaviyo_profiles.js) | Our data → Klaviyo `stk_*` profile properties (privacy rules in `.claude/rules/`). |
| [core/email.js](core/email.js) | Weekly/monthly digests, cache-help templates. |
| [core/seo_manager.js](core/seo_manager.js) | SEO copy queue (rules in `.claude/rules/seo-manager.md`). |
| [core/ga4.js](core/ga4.js) · [core/search_console.js](core/search_console.js) | GA4 and Search Console ingest. |
| [core/applications.js](core/applications.js) | Typeform applications (kennitölur, credit scores). |
| [core/invoices.js](core/invoices.js) · [core/order_monitor.js](core/order_monitor.js) | Gmail → Drive invoices; pending-order monitor. |
| [core/solution_pages.js](core/solution_pages.js) · [core/lagersala.js](core/lagersala.js) | Solution pages; lagersala stock snapshot. |
| [webapp.js](webapp.js) | `doPost`/`doGet` for the anonymous deployment — guarded actions only. |
| [Webflow/](Webflow/) | Frontend. `vorur.js` (`/kpi/vorur`) and `vidskiptavinir.js` (`/kpi/vidskiptavinur`) build their own markup; their Embed is a mount `<div>`. |
| [pim/](pim/) | PIM work sheet / Plytix. `.js` **is pushed with the main project**. |
| [admin/](admin/) | The second GAS project: `app.js` routes three apps (umsókn, listaverð/vöruvöktun, vöruinnihald), `auth.js` guards, `delegate.js` calls the main project. |

`core/utils.js` section headers are double-encoded UTF-8 (`ðŸ§©`) — cosmetic.

## Web-app projects and access control

| Project | Location | Web app access | Serves |
|---|---|---|---|
| Main | repo root | `ANYONE_ANONYMOUS` | Typeform webhook (token-checked); guarded dashboard JSON, badge count, cache-help send; key-only delegation actions for the admin project |
| Admin-apps | `admin/` | `DOMAIN` (@storkaup.is) + allowlist | umsókn (applicant PII, kennitölur, credit scores), vöruvöktun/listaverð, vöruinnihald |

- The anonymous main deployment serves **no HTML app and no applicant PII**.
  `?app=umsokn`/`?app=listaverd` were removed — do **not** re-add them.
- Admin apps guard every `google.script.run` entry point with `adminGuard_()`
  ([admin/auth.js](admin/auth.js)); the deployer is always allowed, others need
  `SETTINGS.ADMIN_APP_EMAILS` or the app's own `<APP>_APP_EMAILS` row.
- **Every admin function without a trailing `_` is a `google.script.run` entry
  point** — not just the ones the HTML calls; any @storkaup.is user can call it
  from the browser console (the access-denied page is HtmlService output too).
  A helper or diagnostic either ends in `_` or calls `adminGuard_()` first.
- **The same rule binds the main project the moment it serves any HtmlService
  page.** Do not re-add a public config reader (`loadConfig()`) in either
  project — it once leaked `SERVICE_ROLE_KEY` (history: `SECURITY_REVIEW.md`).
- Heavy/stateful ops stay in the main project; the admin project calls them via
  key-protected `doPost` actions ([admin/delegate.js](admin/delegate.js)).
- Keep `access: DOMAIN` on the admin project (Workspace offboarding + MFA).
  Never `ANYONE`; route external users through IT as Workspace guests.
- Webflow nav links open the admin `/exec` URL in a **new tab** (logged-in GAS
  apps break inside an iframe).
- **No secret in any Webflow custom code**, site-wide or page-level — not
  `gasKey`, not `EXEC_URL`, not BC figures. The Webflow password was removed
  2026-10-09, so page code is readable by anyone: the 8 pages the checker scans
  answered HTTP 200 without credentials on 2026-10-20. Data is **meant** to be
  protected by Google sign-in (`Webflow/auth.js`, anon revoked in Supabase) —
  that enforcement has not been verified live. `tools/check-webflow-pins.js`
  fails if a secret appears on a scanned page; that is a string scan, not proof
  that access control works.
- Audit logging per app, and how the PIM worksheet is locked across the two
  projects: [ARCHITECTURE.md](ARCHITECTURE.md) → *Web-app projects*, *PIM*.

## Config system

All runtime config lives in the `STORKAUP_CONFIG` Google Sheet (ID in
`core/config.js`), read and cached 5 min by `loadConfig_()`:
`cfg.API.<Service>.<KEY>`, `cfg.SETTINGS.<KEY>`, `cfg.SHEETS.<Service>.ID`,
`cfg.ENDPOINTS.<Service>.<KEY>`. New key: add a row in the API tab
(`Service | Key | Value`). **The repo is public — never commit secrets, IDs or
passwords.**

Security-relevant rows:
- `API.Typeform.WEBHOOK_TOKEN` — `?token=` on the Typeform webhook; enforced when `SETTINGS.TYPEFORM_TOKEN_ENFORCE=true`.
- `API.Dashboard.KEY` — `isApiKeyValid_`, **fail-closed** (missing key rejects all). Delegation actions accept only this key; Webflow actions accept a signed-in user's `authToken` (`webflowCaller_` in `webapp.js`).
- `API.Dashboard.EXEC_URL` — main-project `/exec` the admin project delegates to.
- `SETTINGS.ADMIN_APP_EMAILS` — admin-app allowlist.
- `SETTINGS.MAGENTO_API_ENABLED` — `false` makes every Magento entry point skip quietly; a missing row means on. See RUNBOOK → *Magento API off switch*.

## GAS code conventions

- A `_` suffix means private — hidden from the Apps Script function picker. Anything to run by hand ends in `_v1` or has no suffix.
- Menu entry points are `menu_*` in `core/menu.js`.
- Sheet reads use `loadTableBySchema_('SCHEMA_NAME')` via `STORKAUP_SCHEMA`.
- Shared helpers: `safeJsonParse_`, `truncateForLog_`, `toast_` in `core/utils.js`.
- `applySheetStyling_()` is slow on large sheets — one-time setup/seed only, **never** in per-row, generate/revise or batch loops (100+ s runs).

## Non-negotiables

- **`safePoll_v2`'s 5-minute trigger must not be broken.** It is the primary Magento order ingest. The trigger is not the cadence: `getNewwebRunWindowDecision_v2_()` gates it (off 00:00–06:59, every run 07:00–21:59, quarter-hours 22:00–23:59). Manual run: `safePollNow_v2()` — bare `safePoll_v2()` silently no-ops outside the window.
- **BC web share logic must not change casually.** Monthly cards use net BC; daily cards use `day_kpi_pack`; canonical tag is `salesperson_code = 'VEFUR'`.
- **Webflow dashboards must degrade gracefully** if a secondary RPC fails — the primary dashboard must still render.
- **`auditTriggers_v1()` is the source of truth for triggers**, not any table. Install a missing one with its own idempotent `install*Trigger*` function; don't reach for `resetRecommendedTimeTriggers_v1()` — it touches `safePoll_v2`. Add new handlers to `requiredTimeTriggers_()` ([core/utils.js](core/utils.js)) so audit and reset both see them.
- **BC has no trigger.** It loads only from the BC Sync menu (`processBcDrop_v1`); export a rolling ~3-month window. **Never run `processBcDropForce_v1` on the invoice file** — it nulls `order_no` and `email` across all history. Details: RUNBOOK → *BC import*.

## Current production pins

**This section is the single source of truth for pin values, and it must stay
in this file under this exact heading** — `tools/check-webflow-pins.js` parses
it (first SHA per labelled table row wins). The table describes the site; it
does not govern it — when they disagree, run the tool and find out which is
right before changing either. How the pins work, the independent-pin locations,
fallbacks and history: [RUNBOOK.md → Webflow deploy and production pins](RUNBOOK.md#webflow-deploy-and-production-pins).
What each deploy shipped: `NEXT_TASKS.md` → *Recent Release Notes*.

| What | Value | Set |
|---|---|---|
| `data-storkaup-rev` — governs all bootstrap child files | `bddf84f` | 2026-10-23 — `dashboard.js` ignores a day response that arrives after another day was picked (a slow `day_kpi_pack` for today overwrote the picked day's top figures) |
| `dashboard-bootstrap.js` script-tag src | `bddf84f` | 2026-10-23 (pin only — file unchanged since `1b08cff`) |
| `website-dashboard-bootstrap.js` script-tag src | `bddf84f` | 2026-10-23 (pin only — file unchanged since `30f0908`) |
| `auth.js` script-tag src, **site-wide head** (independent) | `af0191a` | 2026-10-09 — KPI page sign-in, see RUNBOOK → KPI page sign-in |
| `vidskiptavinir.js` script-tag src, **in page head code** (independent) | `a013033` | 2026-10-16 — opportunity lists, onboarding template, bulk "Senda vefkynningu" |
| `vorur.js` script-tag src, **in page head code** (independent) | `ed515f6` | 2026-10-16 — new `/kpi/vorur` |

Move a pin only when a file under `Webflow/` actually changed; a new
independently pinned file goes in this table **and** `EMBED_PINNED` in the tool.
