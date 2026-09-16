# CLAUDE.md — Pop Vroum

This file is loaded automatically by Claude Code at the start of every session in this repo. Keep it lean: high-signal, project-specific instructions only.

---

## What Pop Vroum is

A phygital cooperative web game built for Collectif Mille Trois Cents workshops. Participants color a vehicle on a paper sheet, scan it via webcam (4 QR codes + OpenCV.js), the sheet is reconstructed as a 4×4×8 voxel vehicle in Three.js. Up to 5 participants then traverse a procedural map together as a cohesive group, with color-based individual stats and shared powers.

This is **not a game studio project**. It's a **workshop device**: robustness in non-controlled lighting and clarity for non-technical users matter more than gameplay polish. It's also a **solo side project with no fixed deadline** — favor getting things right over getting them done fast.

**Living specs — read these first:**
- `@docs/prd.md` (v1.0) — vision, current priorities, scope decisions, known inconsistencies
- `@docs/architecture.md` (v1.0) — real file structure, JSON formats, Socket.io schema, configs

Both were consolidated on 2026-09-16 after a product-alignment session and **describe the code as it actually is**, not as originally planned. When in doubt, trust them and the code over anything else.

**Archived, no longer maintained** (kept for history, don't build on them without checking `prd.md`/`architecture.md` first): `brainstorming-session.md`, `prd-race.md`, `prd-solo-v3.md`, `prd-v4.md`, `prd-v1.1-stories.md`, `prd_physique_vehicule.md`, `scan-v2-sandwich.md`, `phase-6-revisee.md`, `stories.md`, `stories-race.md`. Several of these directly contradict the current code or each other — that's expected, that's why they were consolidated.

**Current priority** (see `prd.md` §5): calibrating the core driving physics / game feel. Don't expand powers, active obstacles (punchers, wind), or glass borders without being asked — they're deliberately deferred to V1.x.

---

## Stack & versions

- Backend: **Node.js 20+** + Express 4 + Socket.io 4
- Frontend: **vanilla JS (ES modules), no bundler, no framework**
- 3D: **Three.js** (loaded as ES module from `/public/js/lib/`)
- Vision: **OpenCV.js** + **jsQR** (loaded from `/public/js/lib/`, no CDN)
- Storage: **JSON files** (`/data/`) and **localStorage** (client). No database.
- The server imports the client's physics/collision/map-generator modules directly (`server/game-loop.js`) — there is only **one** physics implementation, not a server copy. Keep those modules free of `document`/`window`/Three.js so they stay importable from Node.

---

## Critical conventions

### Coordinate system (DO NOT BREAK)

Voxel grid is **`grid[x][z][y]`** where:
- `x ∈ [0, 7]` = front-back axis (length, 8 cells) — `x = 7` is the FRONT
- `z ∈ [0, 3]` = left-right axis (width, 4 cells) — `z = 3` is the RIGHT side
- `y ∈ [0, 3]` = bottom-top axis (height, 4 cells) — `y = 0` is the BOTTOM

This is the one true convention. `docs/scan-v2-sandwich.md` documents it inverted (x=cols, z=rows) — that doc is **wrong**; `voxel/builder-sandwich.js` says so explicitly in its own header and implements the correct convention. If a doc and the code disagree on this, the code wins.

### Two scan pipelines — v2 is canonical

- **`scan2.html` / `voxel/builder-sandwich.js` (v2 "sandwich", 4 horizontal slices)** — the official sheet going forward. This is what gets maintained and extended.
- **`scan.html` / `voxel/builder.js` (v1, 3 orthographic views, union 2-of-3)** — frozen. Code stays in the repo for reference, but don't add features to it or fix bugs in it beyond what's needed to keep it from breaking the build.

Don't reintroduce a "which sheet should this feature target" decision — default to v2 unless told otherwise.

### Module pattern

Every module follows this contract:
1. **One responsibility per file**, named after the responsibility.
2. **JSON in, JSON out** when possible. Modules should be testable with mocked JSON.
3. **No side effects in the module body** — export functions, don't run on import.
4. **Debug mode hooks**: every module in the scan pipeline must expose its intermediate output for `debug-view.js` to render.

### Configuration externalization

Three config files in `/config/` hold all tunable values:
- `gameplay.json` — speed, grip, power magnitudes, cohesion radius, physics constants
- `scan.json` — HSL color targets, tolerances, sample ratios
- `layout.json` — sheet dimensions, region coordinates, grid sizes

**Never hardcode values that belong in these configs.** When in doubt, externalize. (There's a known existing violation — `DAMAGE_THRESHOLD` hardcoded in `game-page.js` instead of read from `gameplay.json` — see `architecture.md` §11. Don't add new ones.)

---

## Product guardrails

These are deliberate product decisions, not implementation details — don't reverse them without the user explicitly asking:

- **Never show individual ranking/podium to players.** `game:victory`'s podium payload can stay (useful for a future facilitator-only debrief screen), but no player-facing UI should render arrival order. Victory is collective: everyone connected must arrive.
- **Vehicles never collide with each other** in V1.
- **Minimal UI / fewest controls possible** is a hard design principle, not a nice-to-have — the audience is non-technical people in a ~1h workshop. Justify any new button, menu, or HUD element before adding it.
- **Don't invent a colorblind-accessibility fix** (palette change, new slider behavior) without checking with the user first — it's an open, personal topic for them, not a solved one.

---

## File organization

Top-level shape (see `docs/architecture.md` §3 for the full, current, verified file listing — it's kept accurate, this file isn't):

```
/server.js                  — Express + Socket.io entry
/server/                    — game-loop, lobby-manager, match-end, admin-routes
/config/                    — externalized tunables
/data/map-blocks/_seed/     — base map blocks (committed)
/data/map-blocks/generated/ — workshop-created blocks (gitignored, added manually)
/public/                    — static frontend
  /js/lib/                  — third-party libs (don't touch)
  /js/modules/              — project modules, organized by domain (scan/, voxel/, block/, game/, network/, storage/)
  /js/pages/                — entry scripts per HTML page
```

When adding a new module, place it in the right subdirectory. **Don't create new top-level dirs without asking.** A handful of modules are known dead stubs (`server/cohesion.js`, `game/cohesion.js`, `game/impact.js`) — see `architecture.md` §11 before assuming they do anything.

Test/dev pages (`test-*.html`, `test-*.js`) are a separate track from the workshop app — kept intentionally, never trimmed as "cleanup," but never wired into the real participant flow either.

---

## Code style

- ES modules: `import { foo } from './foo.js'` (always `.js` extension)
- camelCase for functions/variables, PascalCase for classes
- No TypeScript, no JSX, no preprocessors
- Comments in **French** (project audience is French-speaking) — but variable/function names in English
- Keep functions short; if a function exceeds 50 lines, consider splitting
- Always `delete()` OpenCV `Mat` objects after use (memory leaks otherwise)
- Three.js: dispose geometries and materials when removing meshes

---

## What NOT to do

- ❌ **Don't add a build step** (no Webpack, no Vite, no Babel). Project must run with just `node server.js`.
- ❌ **Don't add new npm dependencies without asking.** Current deps: `express`, `socket.io`. That's it.
- ❌ **Don't use CDNs** for third-party libs. Project must work offline in workshop networks.
- ❌ **Don't write tests** unless explicitly asked.
- ❌ **Don't add accounts/auth.** No login, no password storage. Just pseudo + localStorage.
- ❌ **Don't store user images.** Camera frames are processed live, never written to disk.
- ❌ **Don't change the coordinate convention** (see above). Subtle to debug if broken.
- ❌ **Don't add network/remote-hosting features.** Local Wi-Fi only, for the foreseeable future.

---

## Workflow expectations

There's no more atomic per-story breakdown (the old `stories.md` workflow, one story = one narrowly-scoped AI session). The user now prefers **broad, exploratory sessions** that tackle a whole chantier at once (e.g. "fix the driving feel") rather than tightly pre-sliced tasks — don't over-fragment proposed work by default.

When picking up work:
1. **Read `docs/prd.md` §2 and §5** to know the current priority before assuming scope.
2. **Check existing modules first.** This codebase already has more built than a fresh read of the older docs suggests — verify in the actual files before reimplementing something (e.g. the shield's damage absorption already exists; check before rebuilding).
3. **Respect the JSON contracts** documented in `architecture.md` §6.
4. **Implement the debug view** if it's a scan-pipeline module.
5. **Update `/config/*.json`** if you introduce a tunable value, don't hardcode it.
6. **Flag it** before creating files outside the existing module layout, or before touching `docs/prd.md` / `docs/architecture.md` themselves.
7. **Proactively flag inconsistencies** you notice — between two docs, or between a doc and the code — even if not asked. Don't silently pick one and move on.
8. **When two implementations of similar logic have diverged** (this has happened between `game-page.js` and the test pages), the most recently and cleanly modified one is the reference, unless told otherwise.

When asked to debug or modify existing code:
- Read the file first; don't assume what's there.
- Check git diff / git log to understand recent changes (the repo has real history now — use it).
- Preserve the module pattern (one responsibility per file).

---

## French / English

- All user-facing UI text: **French** (target audience: Mille Trois Cents workshops in France)
- All code identifiers (variables, functions, classes): **English**
- All code comments: **French**
- All commit messages: **French**
- All documentation in `/docs/`: **French**

---

## Workshop context (why decisions matter)

When making design or UX choices, remember:
- The end user is often a **child or a non-tech-literate adult** in a French community workshop.
- The workshop facilitator (`animateur·trice`) is **not a developer** but is technically capable — they're the one who uses `block-editor.html`, not participants.
- The session lasts **~1h-1h15** for 5 participants. Speed of iteration matters.
- A failure during a scan **must show what went wrong** in a way that's pedagogically useful (e.g., "your orange was read as red because it bled outside the cell"). Failures are teaching moments, not bugs to hide.
- Color-blind users (**including the project author**) must be able to use the tool. This is unresolved and personal to the user, not a hypothetical — see the guardrail above.
- **No real workshop has been run yet.** Everything is validated by dev-driven playtesting so far. Don't treat any mechanic as field-proven.

---

## When in doubt

- Ask before adding dependencies, build tools, or restructuring directories.
- Default to **simplicity over cleverness**. This is a workshop tool, not a portfolio piece.
- If a doc seems unclear or contradicts another doc (or the code), **flag it** rather than guessing — see `architecture.md` §11 for the list of known ones as of 2026-09-16.
- For complex algorithms (vision, voxel reconstruction, multi-client sync, physics), **show the plan before writing the code**.

---

## Quick reference

- Start dev: `node server.js` then open `http://localhost:3000`
- All state pivots through JSON — see `@docs/architecture.md` §6 for schemas
- Config changes don't require restart for client code; do require restart for server.
- Vision, priorities, and product decisions: `@docs/prd.md`. Real file structure, data formats, network schema, known tech debt: `@docs/architecture.md`.

---

*This file is the project constitution. Detailed/temporary instructions go in `@docs/` and are loaded on demand.*
