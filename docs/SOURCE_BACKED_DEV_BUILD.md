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

### Source-backed collision world

The isolated development build now redirects the collision world's entire public factory to `src/physics/world.mjs`. This includes grid indexing, group filtering, height queries, ray casts, capsule sweeps, disc contacts, and moving-body registration. The parity tests (`tests/world-parity.test.mjs`) execute both implementations on fixed geometry, dynamic bodies, and seeded random queries. The resulting game build must also pass the Chromium title-screen smoke test; this still does not establish full gameplay or frame-by-frame movement equivalence.

### Player cinematic timing

The original player module remains primarily compiled. The isolated development build now imports a source reconstruction of the **scripted player cinematic timeline** from `src/player/cinematic-timeline.mjs`: heading interpolation, animation-frame curves, sequence state labels, and surface classification. Differential tests cover boundary values, extrapolation, and seeded samples against the pinned compiled player bundle.

This does **not** reconstruct interactive locomotion, climbing, the animation skeleton, or player physics. These are separate, larger integration milestones.

### Player ledge-path integration

A second player subsystem is now source-backed: `src/player/ledge-path.mjs` reconstructs the X/Z arc-length sampling of ledge points, normalized outward directions, world-space transformations for attached moving bodies, and the published 0.1-unit nearest-grip lookup. Its differential test covers moving platforms, duplicate points, edge samples, and range restrictions. It does **not** replace the full climbing state machine, physics integration, or animation/IK solver.

### Interactive player steering

The source-backed development player now also calls `src/player/input-steering.mjs` from its live input update function. This covers camera-relative movement direction, analog stick magnitude, scripted movement overrides, zone transition heading locks, gradual yaw correction, and jump buffering. Differential tests compare an extracted original player function against the readable implementation using stateful multi-frame sequences and edge cases. **The full walking/jumping/climbing controller remains compiled.** Title-screen browser parity is a necessary smoke gate, not proof of in-game movement behavior.

## Sandbox gameplay regression gate

The published game's own `?play=1` URL mode bypasses the title-card transition and enters a no-save sandbox. The Chromium workflow exercises this mode with `node scripts/browser-smoke.mjs --play`, waits for the public player debug state to report `PLAY`, presses W, and requires finite player telemetry with actual horizontal movement on both the published reference and source-backed development copy. It compares qualitative gameplay contracts instead of imposing identical frame timings on headless software-rendered WebGL. This is a **movement smoke test**, not a complete combat/climbing/visual-equivalence certification. It runs with isolated browser contexts and does not write production player saves.

### Gait, jump, and fall transitions

The source-backed development player now calls `src/player/locomotion.mjs` for grounded gait classification, movement-facing fallback, initial jump impulses, and fall transitions. The original player module continues to own its action state machine and passes its existing animation, footstep, carrier-detachment and state-change hooks into the reconstructed functions. `tests/player-locomotion-parity.test.mjs` evaluates both implementations against the published player function bodies using boundary-speed and seeded event/state fixtures. This is a bounded recovery of movement transitions, **not** a complete replacement of acceleration, gravity integration, landing, or climbing.

### Recovery: player movement tuning and jump browser regression

`src/player/movement-config.mjs` now holds the published movement speed, acceleration, gravity, jump, dash and capsule parameters and is imported by the **copied** player bundle. Its complete object structure and insertion order are checked against the immutable compiled reference in `tests/player-movement-config-parity.test.mjs`.

The required sandbox Chromium regression now runs `node scripts/browser-smoke.mjs --play --jump`. After the already verified W-key movement, it presses Space and records frame-sampled player debug states, requiring an upward `JUMP` and subsequent grounded `PLAY` state in **both** published and source-backed builds, without imposing frame-count or speed equality on headless software rendering. This extends coverage to a bounded real movement and landing scenario; climbing/combat/save progression are still not certified.

### Ledge grab, hang, shimmy and climb controller

The development build now replaces the original bundled `St`/`Ct`/`wt` ledge-grab and `kt`/`At`/`jt` hanging-climb code with delegation into `src/player/ledge-grab.mjs` and `src/player/ledge-controller.mjs`. The original callback environment (animation, state transitions, level-world lookups, camera rail and leap/drop helpers) remains wired from the player runtime. Differential tests `tests/player-ledge-grab-parity.test.mjs` and `tests/player-ledge-controller-parity.test.mjs` verify detection order, body enablement, movement-state initialization, input priorities, shimmy direction, and climb completion. Mantle animation and generic leap selection remain compiled pending separate tested integration.

### Source-backed low-mantle subsystem

The copied player runtime now delegates low-ledge probing, collision-normal mantle detection, mantle initiation, and clip-driven mantle completion to `src/player/mantle.mjs`. The original callbacks for animation, world queries, state changes, and falling are retained. Differential tests check query bounds, ground obstruction, carrier handling, animation progress, and the fallback when no landing surface is found. This complements the recovered ledge grab, hang, shimmy, and full climb transition, but does not yet recover the complete motion solver, player skeletal animation, scene routing, or combat.

### Leap routing and flight controller

The original player module's contiguous leap subsystem (target selection, rim index resolution, jump-link search, leap setup, in-flight trajectory, collision interruption, and landing) is now bridged into `src/player/leap.mjs`. The copied player retains only thin compatibility wrappers and passes its existing animation, collision, landing, GRAB and state-change callbacks to the source module. `tests/player-leap-parity.test.mjs` compares the recovered behavior with the original player function bodies for authored targets, flight progress, aborts, and landing transitions. Browser sandbox play is the next integration gate; the existing smoke test exercises walking and ordinary jumping, not authored gap leaps.

### Integrated player ground, air and landing physics

The isolated development player now delegates its ground sweep/support test, airborne control/gravity/ledge transitions and landing effects to `src/player/motion-physics.mjs`. The copied player retains runtime hooks for collision-world queries, HUD/audio, animation, damage, mantling, ledge acquisition and buffered jumps. `tests/player-motion-physics-parity.test.mjs` compares the extracted published functions with reconstructed behavior across support, wall, gravity, carriers, jump-cut, collision and landing cases (including deterministic randomized inputs). The Chromium sandbox checks walking and jumping on actual WebGL-loaded scenes; it does not establish complete climbing/combat/visual parity or source-only production bundling.

### Authored Chapter One leap diagnostic (reference-first)

The Chromium script now supports `node scripts/browser-smoke.mjs --play --gap-leap --reference-only` to exercise the published `gap_forward` link and `rim_front` ledge. It derives a ground-supported launch candidate from the level's actual trigger polygon, chooses direction from authored ledge points, and injects a buffered jump through the published player controller while recording frame-by-frame state. The goal is a real `LEAP` → `GRAB` → `CLIMB` → grounded `IDLE` transition, not a simulated direct state switch. The test intentionally marks its scripted aiming and jump-buffer injection as test instrumentation, distinct from keyboard input. It first runs only against the original game to establish feasibility; a reference failure cannot be represented as source-regression evidence. Once the reference is demonstrated and the source-backed build also passes, the full two-build command `node scripts/browser-smoke.mjs --play --gap-leap` becomes a candidate for the required gate.
