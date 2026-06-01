# NEWWEB Entrypoint Migration (2026-02-19)

## What changed in this release

- `core/menu.js`
  - `menu_refreshNEWWEB()` now calls only `safePoll_v2()`.
  - Legacy menu fallback chain (`safePoll`, `pollMagentoNewOrders`) was removed.
- `core/newsales.js`
  - Removed.
- `core/newsales_legacy_shims.js`
  - Provides thin compatibility wrappers:
    - `pollMagentoNewOrders()` -> `pollMagentoOrders_v2()`
    - `safePoll()` -> `safePoll_v2()`
    - `pollOnce()` -> `pollMagentoOrders_v2()`
- `core/newsales_v2.js`
  - Owns `mapOrdersToOrderRows_()` (previously defined in `core/newsales.js`).

## Why this is safe

- Existing manual runs that call old names (`safePoll`, `pollMagentoNewOrders`, `pollOnce`) still work.
- Menu action now enforces a single canonical runtime path (v2), reducing ambiguity.
- No trigger target names were removed in this release.

## Required validation in Apps Script UI

1. Open Apps Script project triggers.
2. Verify no production trigger depends on deprecated v1-only behavior.
3. Confirm scheduled/import jobs use one of:
   - `safePoll_v2`
   - `pollMagentoOrders_v2`
   - or compatibility wrapper names (temporarily accepted).

## Planned cleanup in next release (after validation)

1. Delete `core/newsales_legacy_shims.js` after confirming no trigger/manual run uses v1 helper names.
2. Delete debug-only files if not used operationally:
   - `core/tests.js`
   - `core/testconfig.js`
   - `core/version.js`
3. No additional NEWWEB v1 code should remain after shim removal.

## Rollback plan

- If unexpected behavior appears, restore `menu_refreshNEWWEB()` fallback chain and point wrappers back to prior implementation.
- Because old function names are still present in this release, rollback is low-risk and does not require trigger rewiring.
