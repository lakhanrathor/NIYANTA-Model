# AGENTS.md — read before any planning/design work

## 1. READ FIRST — canonical research

**Before doing anything that involves product direction, features, comparison pages,
watch/monitoring, evacuation, or SIH26161 requirements — read:**

> **`docs/SIH26161_ROADMAP.md`**

It is the single source of truth: problem-statement research (SIH26161 / NTRO),
PPT↔codebase mapping, verified base inventory, doubts & findings, the **decisions log
(D1–D8)**, and the phased roadmap. Never re-research SIH26161; update that doc instead.

## 2. Core philosophy (governs every doc and every screen)

1. **Part 1 — Watch & Trigger:** fixed target areas are swept daily via Google Earth
   Engine; change detection (glacier, water extent, rainfall, natural-dam blockage,
   seismic) → risk → alert → trigger into Part 2. Always-on, real-time UX.
2. **Part 2 — River Context:** the analyst selects a river; the context (corridor, DEM,
   dams, population, OSM, runs) is built once. **Every other page SUBSCRIBES and
   PUBLISHES to this river context** — Discover publishes the selection, Build publishes
   scenario config, Run/Results/Compare/Player/Evacuation publish outputs back, Watch
   publishes events. No page keeps private river state.

If a document in `docs/` contradicts this, **update the document first**, then the code.

## 3. Standing rules

- **Evidence rule:** no fabricated numbers anywhere; missing data renders `EM_DASH`;
  readouts come only from real API data.
- **Compare = TIME comparison** (T1 vs T2 flood progression incl. roads) — never
  engine-vs-engine framing (decision D3).
- **Verification:** backend `python -m pytest tests/ -q` (baseline: all pass
  except the two `test_seg_sam` tests, which need `torch`; the old SPH dispatch
  failure is fixed — decision D11), 43-endpoint probe battery against
  `http://127.0.0.1:8000/api`, frontend `npx tsc --noEmit` + `npx oxlint src`.
  **No Playwright specs** — the user supplies screenshots (decision D6).
- **Stack:** backend Python 3.11 (isolated — always `sys.path.insert(0, backend)` in
  `-c` snippets), single SQLite DB `backend/data/niyanta.sqlite` (geometry = GeoJSON
  text; SQL dialect via `modules/db/client.py::_translate`), FastAPI, React 19 + Vite
  + TS at `frontend/app/` (build `npm run build`, lint `npx oxlint src`).
- Never write PG jsonb `?` operators in SQL (collides with placeholder translation).
- Do not PowerShell round-trip TS files (encoding corruption); use the edit tool.
