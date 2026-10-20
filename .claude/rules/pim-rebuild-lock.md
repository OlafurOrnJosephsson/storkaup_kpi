---
paths:
  - "pim/**"
  - "admin/voruinnihald.js"
  - "admin/voruinnihald_app.html"
---

# PIM worksheet: cross-project rebuild lock

The PIM worksheet is written by **both** Apps Script projects, and `ScriptLock` does not cross them. The lock is the developer-metadata key `PIM_REBUILD_STARTED_MS`, a string constant in both `pim/buildPimWorksheet.js` (`PIM_REBUILD_META_`) and `admin/voruinnihald.js` (`VI_REBUILD_META_`).

- Never rename it in one project only — the lock silently stops working.
- Every admin write path must open the sheet with `vi_open_(true)` inside its lock.
- Mechanism and timings (30 s wait, 15-min staleness): `ARCHITECTURE.md` → *PIM / vöruinnihald*.
- `pim/*.js` is pushed with the **main** project (`pim/` is not in `.claspignore`). A `.js` here must be real Apps Script — a top-level `require()` throws on load and kills every trigger. The `.py` tools run locally only.
