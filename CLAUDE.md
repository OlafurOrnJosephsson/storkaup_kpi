# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deploy workflow

```bash
clasp push          # push GAS code to Apps Script
git add .
git commit -m "..."
git push
```

Webflow JS files (`Webflow/*.js`) are **not** pushed via clasp — deploy by copy/paste into Webflow custom code and updating jsDelivr commit pins in `README.md` and `NEXT_TASKS.md`.

After any Webflow deploy: run `node --check Webflow/<file>.js` before touching Webflow custom code.

## Architecture

```
Magento / BC / Klaviyo / GA4 / Cludo
        ↓
Google Apps Script (core/*.js)     ← scheduled triggers, ingest
        ↓
Supabase raw.*                     ← append-only source tables
        ↓
Supabase mart.*                    ← materialized views / aggregations
        ↓
Supabase api.* / public.*          ← RPC functions
        ↓
Webflow (Webflow/*.js)             ← read-only dashboards
```

No backend server. All ingest runs in Apps Script via time-based triggers managed by `resetRecommendedTimeTriggers_v1()`.

## Config system

All runtime config lives in a separate Google Sheet (`STORKAUP_CONFIG`, ID hardcoded in `core/config.js`). `loadConfig_()` reads and caches it for 5 min via Script Properties. Structure:

- `cfg.API.<Service>.<KEY>` — API keys and tokens
- `cfg.SETTINGS.<KEY>` — feature flags and model settings
- `cfg.SHEETS.<Service>.ID` — spreadsheet IDs
- `cfg.ENDPOINTS.<Service>.<KEY>` — resolved URL templates

To add a new API key: add a row in STORKAUP_CONFIG → API tab (`Service | Key | Value`). Reference via `cfg.API.ServiceName.KEY_NAME`.

SEO-specific settings in SETTINGS tab: `SEO_PROVIDER` (`gemini`/`claude`/`openai`), `SEO_GEMINI_MODEL`, `SEO_GEMINI_FALLBACK_MODELS`, `SEO_CLAUDE_MODEL`.

## GAS code conventions

- Functions ending in `_` are private (hidden from Apps Script run menu).
- Public menu entry points are in `core/menu.js` as `menu_*` functions.
- Sheet reads use `loadTableBySchema_('SCHEMA_NAME')` which resolves through `STORKAUP_SCHEMA` in `core/schema.js`.
- `safeJsonParse_`, `truncateForLog_`, `toast_` are shared utilities in `core/utils.js`.
- `applySheetStyling_()` is slow on large sheets — only call it during one-time setup/seed operations, never in per-row or batch loops.

## Non-negotiables

- **`safePoll_v2` 5-minute cadence must not be broken.** This is the primary Magento order ingest.
- **BC web share logic must not change casually.** Monthly cards use net BC; daily cards use `day_kpi_pack`; canonical tag is `salesperson_code = 'VEFUR'`.
- **Webflow dashboards must degrade gracefully** if a secondary RPC fails — the primary dashboard must still render.
- Never call `applySheetStyling_()` inside generate/revise/batch loops — it causes 100+ second execution times on large sheets.

## SEO Manager (`core/seo_manager.js`)

Queue-driven Icelandic B2B SEO copy generation. Flow:

1. Categories seed into `SEO_QUEUE` sheet via `buildSeoQueueFromCludo_v1()` or `mergeSeoFromSheet_v1()`
2. AI generates/revises via `runSeoAutomationBatch_v1()` or `runSeoForSelectedRow_v1()` / `runReviseSeoForSelectedRows_v1()`
3. Human reviews in sheet, marks `Approved = true`, pastes into Prismic

Provider chain: `SEO_PROVIDER=gemini` → tries model chain (`gemini-2.0-flash` preferred, `gemini-2.0-flash-lite` returns 404 on this API key); `SEO_PROVIDER=claude` → Anthropic API (`API.Anthropic.API_KEY` required).

Prompt versions: `buildSeoPromptV2_` (default), `buildSeoPromptV3_` (level-aware, brand/attribute detection, varied title endings) — pass `opts.useV3=true, opts.level=1|2|3` to `generateSEOTitles()`. Revise flow uses `temperature: 0.5`; generate uses `0.3`.

Title rules (V3, from SEO review Apr 2025):
- LVL1: `X í heildsölu | Stórkaup`
- LVL2: `Flokkur | Undirflokkur | Stórkaup`
- LVL3: `Vara | Hook (magn/tegund/notkunarsvið) | Stórkaup`
- No adjectives. No "í heildsölu" on LVL2/3. No "pantaðu í dag" / "skjót afhending" CTA.

## Key scheduled triggers

| Function | Cadence | Source |
|---|---|---|
| `safePoll_v2` | Every 5 min | Magento new orders |
| `scheduledMagentoSync_v1` | Hourly | Magento full incremental |
| `scheduledBcSync_v1` | Twice daily | Business Central |
| `scheduledKlaviyoSync_v1` | Every 15 min | Klaviyo events |
| `scheduledReferenceSync_v1` | Daily | Products, customers, Cludo |
| `runDailySanityChecks_v1` | Daily morning | Cross-source validation |

## Current production pins

**This section is the single source of truth for production pins.** `NEXT_TASKS.md` and `README.md` point here — do not duplicate pin values elsewhere. Update these whenever Webflow custom code changes.

- Webflow deploy rev (`data-storkaup-rev`): `de078fb`
- `Webflow/dashboard.js`: `de078fb`
- `Webflow/website-dashboard.js`: `9d75dcb`
- `Webflow/dashboard-theme.css`: `79acc08`
- `Webflow/customer-profiles.js`: `2d2ec9b`
- Trigger schedule baseline: `ab2931a`
- Parent/child profile aggregation baseline: `ab0aafd`
- Parent/child last-orders merge: `ca32334`

jsDelivr URL pattern: `https://cdn.jsdelivr.net/gh/OlafurOrnJosephsson/storkaup_kpi@<commit>/Webflow/<file>.js`
