# Source-backed transitional development build

**Status:** An integration experiment, not the final rebuild of Sumiro.

The repository's published game lives in `sumiro/`. The development builder assembles an isolated copy and loads reconstructed domain, collision, player, and render-sizing modules into the published runtime.

## Build and serve

```sh
npm ci
npm run build:dev
python3 -m http.server 8000 --directory .local-build
```

Open `http://localhost:8000/sumiro/`. Compare with the unmodified published game served from the repository root at `http://localhost:8000/sumiro/` using a separate server/root, port, or browser profile. **Save data is stored by browser origin**; do not run compatibility experiments against irreplaceable player saves. Back up localStorage or use a fresh browser profile.

## What the script does

1. Validates each chunk it will adapt against a pinned Git blob hash.
2. Compiles the readable TypeScript and legacy JavaScript modules before replacing the previous development output.
3. Copies the published distribution into `.local-build/` and writes the emitted browser modules alongside it.
4. Rebinds the copied chunks to readable source and writes their provenance to `reconstruction-build.json`.

The build adapts only the listed chunks in the isolated output. The rendering backend in this build is still the published WebGL implementation.

## Test

```sh
npm run typecheck
npm test
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

The browser driver installation is transient. The source compiler and Three.js r187 dependencies are pinned separately in the repository lockfile.

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

The development build compiles the moving-triangle body factory from `src/physics/moving-body.mts`. It preserves matrix transforms, velocities, bounds, triangle filtering, and carrying points on moving surfaces. Differential coverage includes empty bodies, repeated poses, and typed arrays with caller-visible metadata.

### Source-backed collision world

The isolated development build redirects the collision world factory to `src/physics/world.mts`. The typed interface covers grid indexing, group filtering, height queries, ray casts, capsule sweeps, disc contacts, and moving-body registration. The parity tests (`tests/world-parity.test.mjs`) execute both implementations on fixed geometry, dynamic bodies, and seeded random queries.

### Chapter transitions and HUD timing

The copied game delegates transition sequencing to `src/domain/scene-transition.mts`. The copied HUD delegates wash, reveal, and chapter-card timing to `src/runtime/hud-timeline.mts`. Tests compare the transition order and timing against the published functions and exercise failure recovery and teardown. The development build still requires a live chapter-transition check.

### Player cinematic timing

The original player module remains primarily compiled. The isolated development build now imports a source reconstruction of the **scripted player cinematic timeline** from `src/player/cinematic-timeline.mjs`: heading interpolation, animation-frame curves, sequence state labels, and surface classification. Differential tests cover boundary values, extrapolation, and seeded samples against the pinned compiled player bundle.

This does **not** reconstruct interactive locomotion, climbing, the animation skeleton, or player physics. These are separate, larger integration milestones.

### Player ledge-path integration

A second player subsystem is now source-backed: `src/player/ledge-path.mjs` reconstructs the X/Z arc-length sampling of ledge points, normalized outward directions, world-space transformations for attached moving bodies, and the published 0.1-unit nearest-grip lookup. Its differential test covers moving platforms, duplicate points, edge samples, and range restrictions. It does **not** replace the full climbing state machine, physics integration, or animation/IK solver.

### Interactive player steering

The source-backed development player calls `src/player/input-steering.mts` from its live input update function. This covers camera-relative movement direction, analog stick magnitude, scripted movement overrides, zone transition heading locks, gradual yaw correction, and jump buffering. Differential tests compare an extracted original player function against the readable implementation using stateful multi-frame sequences and edge cases. **The full walking/jumping/climbing controller remains compiled.** Title-screen browser parity is a necessary smoke gate, not proof of in-game movement behavior.

## Sandbox gameplay regression gate

The published game's own `?play=1` URL mode bypasses the title-card transition and enters a no-save sandbox. The Chromium workflow exercises this mode with `node scripts/browser-smoke.mjs --play`, waits for the public player debug state to report `PLAY`, presses W, and requires finite player telemetry with actual horizontal movement on both the published reference and source-backed development copy. It compares qualitative gameplay contracts instead of imposing identical frame timings on headless software-rendered WebGL. This is a **movement smoke test**, not a complete combat/climbing/visual-equivalence certification. It runs with isolated browser contexts and does not write production player saves.

### Gait, jump, and fall transitions

The source-backed development player calls `src/player/locomotion.mts` for grounded gait classification, movement-facing fallback, initial jump impulses, and fall transitions. The original player module continues to own its action state machine and passes its existing animation, footstep, carrier-detachment and state-change hooks into the reconstructed functions. `tests/player-locomotion-parity.test.mjs` evaluates both implementations against the published player function bodies using boundary-speed and seeded event/state fixtures.

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

The isolated development player delegates its ground sweep and support test, airborne control and ledge transitions, and landing effects to `src/player/motion-physics.mts`. The copied player retains runtime hooks for collision-world queries, HUD/audio, animation, damage, mantling, ledge acquisition and buffered jumps. `tests/player-motion-physics-parity.test.mjs` compares the extracted published functions with reconstructed behavior across support, wall, gravity, carriers, jump-cut, collision and landing cases (including deterministic randomized inputs).

The source traversal test drives the typed input sampler and grounded controller on the actual Chapter One terrain at 60 Hz. It checks the published spawn, running with keyboard input, and settling when input is released. The native gameplay camera accepts authored rail samplers and has separate obstacle, clearance, and teleport tests.

### Authored Chapter One leap diagnostic (reference-first)

The Chromium script now supports `node scripts/browser-smoke.mjs --play --gap-leap --reference-only` to exercise the published `gap_forward` link and `rim_front` ledge. It derives a ground-supported launch candidate from the level's actual trigger polygon, chooses direction from authored ledge points, and injects a buffered jump through the published player controller while recording frame-by-frame state. The enforced goal is the live `LEAP` → `GRAB`/`HANG` at `rim_front` → `CLIMB` entry, not a simulated direct state switch. **Completion to grounded `IDLE` is recorded when observed but is not yet enforced:** the published game reached `CLIMB` in headless Chromium, then stopped advancing its simulation clock for the duration of the timeout (diagnostic run 44034828395). This is an unresolved browser-environment/animation limitation, not evidence of a reconstructed regression. The test intentionally marks its scripted aiming and jump-buffer injection as test instrumentation, distinct from keyboard input. The published reference was confirmed to reach all three enforced states, so the CI gate now runs `node scripts/browser-smoke.mjs --play --gap-leap` against both the original and the source-backed development build. An optional `--reference-only` flag remains available for diagnosing baseline behavior in isolation.

### Typed frame resolution

The copied renderer delegates scale limits, pixel-budget clamping, full-resolution and reduced-resolution target sizes, and shader pixel scaling to `src/rendering/frame-resolution.mts`. The parity test runs the original resize methods on the same inputs and compares their target sizes and uniform values.

### Mesh visibility and geometry

The copied sight chunk loads `src/physics/sight.mts`, covering mesh extraction, triangle raycasts, line-of-sight checks, edge filtering, and in-place long-edge relaxation. Differential tests run the five source exports against the original chunk with indexed, mirrored, interleaved, and normalized meshes.

### System lifecycle

The copied entry delegates subsystem loading, updates, render callbacks, and chapter membership to `src/runtime/system-host.mts`. It preserves ordinary routing and tracks cleanup callbacks, abort signals, and scene roots. A failed system releases its resources while independent systems continue. Legacy modules can register roots implicitly during initialization. New systems can register resources explicitly through their lifetime to receive cleanup even after cancellation.

The entry also loads the typed fixed-step clock and registry. Simulation time is derived from the step index, and registry notifications preserve snapshot ordering. A listener that throws during initial replay is removed before the error is propagated.

The live frame loop uses a renderer-independent scheduler. It carries fractional time between frames, bounds simulation work after a hitch, and permits a redraw while paused after resize. The page teardown cancels its pending frame callback before disposing systems.

### Launch configuration and persistence

The typed launch parser preserves the original query modes and raw parameters. It rejects incomplete camera coordinates and zero or unsafe viewport dimensions. Save and chapter data use typed interfaces while preserving the shipped storage keys, load priority, transition identity, and permissive legacy fields. Storage access errors return the same failure values as the bundled game.

### Input sampling

Both runtime paths use `src/input/input-manager.mts` for keyboard, pointer, gamepad, and scripted-route input. A system update sees one consistent set of presses and deltas. Input arriving during an update waits for the next tick. Blur clears held and queued state, and teardown removes the registered listeners.
