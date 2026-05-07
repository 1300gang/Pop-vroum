# CLAUDE.md — Pop Vroum

This file is loaded automatically by Claude Code at the start of every session in this repo. Keep it lean: high-signal, project-specific instructions only.

---

## What Pop Vroum is

A phygital cooperative web game built for Collectif Mille Trois Cents workshops. Participants color a vehicle on a paper sheet (3 orthographic views), scan it via webcam (4 QR codes + OpenCV.js), the sheet is reconstructed as a 4×4×8 voxel vehicle in Three.js. Up to 5 participants then traverse a procedural map together as a cohesive group, with color-based individual stats and shared powers.

This is **not a game studio project**. It's a **workshop device**: robustness in non-controlled lighting and clarity for non-technical users matter more than gameplay polish.

Detailed context lives in:
- `@docs/brainstorming-session.md` — initial brainstorm, personas, analogies
- `@docs/prd.md` — features prioritized P0/P1/P2
- `@docs/architecture.md` — file structure, JSON formats, Socket.io schema, configs
- `@docs/stories.md` — atomic stories for code sessions

**Always read the relevant story from `@docs/stories.md` before implementing any module.**

---

## Stack & versions

- Backend: **Node.js 20+** + Express 4 + Socket.io 4
- Frontend: **vanilla JS (ES modules), no bundler, no framework**
- 3D: **Three.js r150+** (loaded as ES module from `/public/js/lib/`)
- Vision: **OpenCV.js 4.x** + **jsQR 1.4** (loaded from `/public/js/lib/`, no CDN)
- Storage: **JSON files** (`/data/`) and **localStorage** (client). No database.

---

## Critical conventions

### Coordinate system (DO NOT BREAK)

Voxel grid is **`grid[x][z][y]`** where:
- `x ∈ [0, 7]` = front-back axis (length, 8 cells)
- `z ∈ [0, 3]` = left-right axis (width, 4 cells)
- `y ∈ [0, 3]` = bottom-top axis (height, 4 cells)

The 3 sheet views project as:
- **Face view (4×4)**: shows `(z, y)` for the front of vehicle
- **Profile view (8×4)**: shows `(x, y)` for the side
- **Top view (8×4)**: shows `(x, z)` for above

**A voxel exists if at least 2 of these 3 views confirm it (union 2-of-3).** This rule is in `voxel/builder.js`. Never use strict intersection (3-of-3).

### Module pattern

Every module follows this contract:
1. **One responsibility per file**, named after the responsibility.
2. **JSON in, JSON out** when possible. Modules should be testable with mocked JSON.
3. **No side effects in the module body** — export functions, don't run on import.
4. **Debug mode hooks**: every module in the scan pipeline must expose its intermediate output for `debug-view.js` to render.

### Configuration externalization

Three config files in `/config/` hold all tunable values:
- `gameplay.json` — speed, grip, power magnitudes, cohesion radius
- `scan.json` — HSL color targets, tolerances, sample ratios
- `layout.json` — sheet dimensions, region coordinates, grid sizes

**Never hardcode values that belong in these configs.** When in doubt, externalize.

---

## File organization

```
/server.js                  — Express + Socket.io entry
/config/                    — externalized tunables
/data/map-blocks/_seed/     — base map blocks (committed)
/data/map-blocks/generated/ — workshop-created blocks (added manually)
/public/                    — static frontend
  /js/lib/                  — third-party libs (don't touch)
  /js/modules/              — project modules, organized by domain
    /scan/                  — capture, qr-detect, perspective, segmenter, color-reader, calibration, debug-view, symbol-reader
    /voxel/                 — builder, wheel-detector, stats, renderer
    /block/                 — builder, renderer
    /game/                  — controls, physics, camera, powers, cohesion, impact, particles, skid, offscreen, map-generator
    /network/               — client, lobby, sync
    /storage/               — local, gallery
  /js/pages/                — entry scripts per HTML page
```

When adding a new module, place it in the right subdirectory. **Don't create new top-level dirs without asking.**

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
- ❌ **Don't write tests** unless explicitly asked. V1 is exploratory; tests will come in V1.x.
- ❌ **Don't add accounts/auth.** No login, no password storage. Just pseudo + localStorage.
- ❌ **Don't store user images.** Camera frames are processed live, never written to disk.
- ❌ **Don't change the coordinate convention** (see above). Subtle to debug if broken.

---

## Workflow expectations

When implementing a story from `@docs/stories.md`:

1. **Read the story first**, including its dependencies.
2. **Check existing modules** that the story builds on. Don't reimplement what exists.
3. **Respect the JSON contract** specified in the story's "Contrat I/O" section.
4. **Implement the debug view** if it's a scan-pipeline module.
5. **Update `/config/*.json`** if you introduce a tunable value, don't hardcode it.
6. **Don't create files outside the story's "Fichiers" list** without flagging it.

When asked to debug or modify existing code:
- Read the file first; don't assume what's there.
- Check git diff to understand recent changes.
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
- The workshop facilitator (`animateur·trice`) is **not a developer** but is technically capable.
- The session lasts **~1h-1h15** for 5 participants. Speed of iteration matters.
- A failure during a scan **must show what went wrong** in a way that's pedagogically useful (e.g., "your orange was read as red because it bled outside the cell"). Failures are teaching moments, not bugs to hide.
- Color-blind users (including the project author) must be able to use the tool. The HSL slider is a **feature**, not an edge case.

---

## When in doubt

- Ask before adding dependencies, build tools, or restructuring directories.
- Default to **simplicity over cleverness**. This is a workshop tool, not a portfolio piece.
- If a story seems unclear or contradicts another doc, **flag it** rather than guessing.
- For complex algorithms (vision, voxel reconstruction, multi-client sync), **show the plan before writing the code**.

---

## Quick reference

- Start dev: `node server.js` then open `http://localhost:3000`
- All state pivots through JSON — see `@docs/architecture.md` section 4 for schemas
- Config changes don't require restart for client code; do require restart for server.

---

*This file is the project constitution. Detailed/temporary instructions go in `@docs/` and are loaded on demand.*
