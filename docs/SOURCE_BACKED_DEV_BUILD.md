# Source-backed transitional development build

**Status:** An integration experiment, not the final rebuild of Sumiro.

The repository's published game still lives in `sumiro/`. The source-backed development build assembles an isolated copy that **loads the reconstructed chapter, save, collectible-scroll and collision-geometry/moving-body modules into the actual original game runtime**.

## Build and serve

```sh
node scripts/build-reconstructed-dev.mjs
python3 -m http.server 8000 --directory .local-build
```

Open `http://localhost:8000/sumiro/`. Compare with the unmodified published game served from the repository root at `http://localhost:8000/sumiro/` using a separate server/root, port, or browser profile. **Save data is stored by browser origin**; do not run compatibility experiments against irreplaceable player saves. Back up localStorage or use a fresh browser profile.

## What the script does

1. Validates the original immutable compiled chapter and game chunks using pinned Git blob hashes; fails if source artifacts changed.
2. Copies `sumiro/` and `src/` into `.local-build/`.
3. Replaces the **copied** chapter chunk with an ES module adapter mapping the original minified export names to `src/domain/chapters.mjs`.
4. Replaces the **copied** game save prelude with imports bound to `src/domain/save.mjs`.
5. Rebinds the copied collision module's wall extrusion and polygon containment exports to readable `src/physics/geometry.mjs`, retaining the compiled collision-world runtime.
6. Writes a JSON provenance report listing exactly which source modules are used.

Only the **development copy** is modified; tracked artifacts in `sumiro/` are untouched. This does not introduce a package manager or attempt to recompile unrelated generated modules.

## Test

```sh
node --test tests/*.test.mjs
```

The integration test builds the copied tree, confirms the original file contents did not change, verifies the new adapter can import the readable chapter module, and checks that save references are redirected. CI runs this test.

## Automated browser smoke gate

The standalone [`scripts/browser-smoke.mjs`](../scripts/browser-smoke.mjs) runs in Chromium using Playwright. CI installs a pinned Playwright version (1.65.1) and its Chromium browser in a separate `Browser regression` workflow. To run it locally:

```sh
npm install --no-save --package-lock=false playwright@1.65.1
npx playwright install chromium
node scripts/browser-smoke.mjs
# Optional diagnostic only (not yet a required CI gate):
node scripts/browser-smoke.mjs --interaction
```

The script builds `.local-build-browser/` (ignored by Git), starts separate local HTTP servers for the original repository and the development copy, launches isolated browser contexts, waits for a nonzero-size canvas, for the loading overlay to disappear, and for the title menu to appear; it also records uncaught errors and failed network requests. It fails if the **published reference** cannot boot: a broken reference cannot establish parity. It then applies the same conditions to the development copy.

The required gate asserts browser boot, title-menu readiness and resource loading. It does **not** prove that the GPU renders the intended scene or that gameplay, audio, save reload and chapter transitions are equivalent.

**Observed issue (2026-11-16/17):** An opt-in New Game/PLAY/save diagnostic successfully reached the **original published** title menu and clicked New Game, but the original remained in `CHAPTER_CARD` for at least 45 seconds under headless software-rendered Chromium, with no saved game yet. No uncaught JS errors or HTTP failures were reported. The source-backed candidate was not reached in that failed run. This is an **inconclusive browser-environment/transition gate**, not a verified reconstruction regression or evidence of full gameplay parity. Run `node scripts/browser-smoke.mjs --interaction` for that stricter diagnostic; it is intentionally not a required CI check until its baseline behavior is understood. [Diagnostic run](https://github.com/Vyzerythe/sumiro/actions/runs/44013316723). Those require additional deterministic UI/playthrough probes.

The browser test's package installation is transient to avoid presenting Playwright as a dependency of the distributed game. Before a permanent automation stack is adopted, use a checked-in dependency manifest and lockfile for the developer/test toolchain.

## Limits and safety gates

- The other JavaScript chunks, third-party library code, WASM, models, textures, and audio are **still compiled distribution artifacts**.
- Automated coverage is **structural and domain-level**. A real-browser playthrough of the generated development build has not been completed. Do not deploy it as production.
- Bundler/minifier output can change when the game is updated; pinned hashes intentionally prevent blindly applying transformations to a new build.
- This stage deliberately retains original save semantics, including legacy validation shortcomings. Do not test against important personal progress without backup.
- A full clean source build will need reconstructed entry composition, rendering, physics, scene, audio, user input, and third-party dependencies, plus browser gameplay and licensing verification.

## Next milestone

Introduce an automated browser smoke test for both original and source-backed builds (boot, menu, new game, save/reload, and chapter flow) and compare observable behavior. Continue subsystem reconstruction only when the integration harness can detect regressions.

**Output safety:** The builder only accepts direct root-level scratch directories named `.local-build` or `.local-build-*`, and rejects other paths before deleting any output. It never writes to `sumiro/`.

## Collision geometry reconstruction

The exported polyline extrusion and polygon-containment routines have executable parity tests against the original generated collision chunk, using representative boundaries, winding order, deterministic seeded polygons, callback order and output identity. The collision-world engine, moving bodies, capsule sweeps, and raycasts remain compiled; only the two independently testable geometry helpers are source-backed at this stage.

### Moving collision body

The development build now sources the moving-triangle body factory from `src/physics/moving-body.mjs`. It preserves matrix transforms, velocities, bounds, triangle filtering, and carrying points on moving surfaces. Differential tests compare the readable source with `world.addBody(...)` from the unchanged published collision module, including empty bodies and repeated poses. Full world collision, raycasts, and capsule sweeps remain compiled.
