---
paths:
  - "core/seo_manager.js"
---

# SEO Manager (`core/seo_manager.js`)

Queue-driven Icelandic B2B SEO copy generation. Flow:

1. Categories seed into the `SEO_QUEUE` sheet via `buildSeoQueueFromCludo_v1()` or `mergeSeoFromSheet_v1()`.
2. AI generates/revises via `runSeoAutomationBatch_v1()` or `runSeoForSelectedRow_v1()` / `runReviseSeoForSelectedRows_v1()`.
3. A human reviews in the sheet, marks `Approved = true`, and pastes into Prismic.

Deliberately hand-run — no trigger (see `RUNBOOK.md` → *Trigger Baseline*).

## Providers and models (defaults as in `getSeoManagerEnv_`)

- `SETTINGS.SEO_PROVIDER` picks the **text** model: `gemini` (default), `claude`, or `openai`.
- Gemini: `SEO_GEMINI_MODEL` (default `gemini-2.5-flash`), then `SEO_GEMINI_FALLBACK_MODELS` (default `gemini-2.5-flash-lite,gemini-2.0-flash-lite`), then built-in safe defaults.
- Claude: `SEO_CLAUDE_MODEL`; needs `API.Anthropic.API_KEY`.
- OpenAI: `SEO_OPENAI_MODEL`; needs `API.OpenAI.API_KEY`.
- OG images **always** go through OpenAI (`SEO_IMAGE_MODEL`), whatever `SEO_PROVIDER` says.
- Older notes said `gemini-2.0-flash-lite` returns 404 on this API key. It is still in the default fallback list; unverified whether that note still holds.

## Prompts

- `generateSEOTitles(..., opts)` uses `buildSeoPromptV2_` unless `opts.useV3` is set. The batch and selected-row flows pass `{ useV3: true, level: seoRowLevel_(row) }`, so in practice **V3 is what runs**.
- `buildSeoPromptV3_` is level-aware, with brand/attribute detection and varied title endings.
- Revise uses `temperature: 0.5`; generate uses `0.3`.

## Title rules (V3, from the SEO review Apr 2025)

- LVL1: `X í heildsölu | Stórkaup`
- LVL2: `Flokkur | Undirflokkur | Stórkaup`
- LVL3: `Vara | Hook (magn/tegund/notkunarsvið) | Stórkaup`
- No adjectives. No "í heildsölu" on LVL2/3. No "pantaðu í dag" / "skjót afhending" CTA.

## Performance

Never call `applySheetStyling_()` inside generate/revise/batch loops — it causes 100+ second execution times on large sheets.
