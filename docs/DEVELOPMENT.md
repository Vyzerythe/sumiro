# Development and validation

## Prerequisites for the published distribution

- A modern browser with suitable graphics support.
- Python 3 or any other static HTTP server for local playback.
- Node.js **22 or newer** for the repository's dependency-free integrity tests.

## Local quick start

From the repository root:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000/sumiro/` (not `/`).

## Distribution and reconstructed-source checks

Use Node.js 22.18 or newer for the source toolchain.

```sh
npm ci
npm run typecheck
npm test
npm run build:dev
python3 -m http.server 8000 --directory .local-build
# Open http://localhost:8000/sumiro/
```

The development builder never edits published assets. Its output is isolated and ignored by Git. It rejects unsafe output paths and refuses to rewrite chunks when pinned reference hashes have changed.

The tests ensure that:

- `sumiro/index.html` is present, with a local script entry and existing relative HTML references;
- local static JavaScript module imports resolve within the distributed tree;
- checked-in JSON configuration files have valid syntax;
- files identified by the audio index and audio manifests actually exist.

**Additional test coverage:** chapter progression, saves, collectible data, collision queries and player movement are compared against the shipped implementation. The movement-trail tests exercise walkable segments, interrupted movement, and absolute indexes after the history rolls over. The development-build test imports the emitted trail adapter and checks its five exports. CI separately checks both builds in Chromium.

The opt-in New Game interaction probe is inconclusive on the *published reference* under headless software rendering. See [the development-build guide](SOURCE_BACKED_DEV_BUILD.md) and [manual release checks](RELEASE_CHECKLIST.md). Native hardware coverage is described below.

## Making changes safely

Documentation or validation changes can be made here directly by pull request. Avoid editing hashed bundle chunks: changes will be overwritten by the next published build and may break the module graph. For behavior changes, update recovered source only after determining the relevant compatibility contract, and do not promote the development copy to production without completed gameplay regression checks and provenance.

## Native WebGPU verification

The source runtime in `src/runtime/source-runtime.mts` composes the system host, asset service, simulation clock, optional audio mixer, and WebGPU renderer. The renderer owns the device, canvas configuration, scene pass, and TSL output graph. Callers own the scene and camera. Runtime teardown awaits systems before releasing audio, assets, and rendering. The default suite checks generated WGSL, startup rollback, and pass disposal.

To serve the native application, run `npm run build:source` and serve the repository root. Open `http://localhost:8000/.local-build-source/` in a WebGPU-capable browser for the title menu. Use `?geometry=1` or `?chapter=<chapter-id>` to inspect geometry, or `?walk=1` to start traversal directly. WASD and arrow keys move, Space jumps, and P or Escape pauses. Enter or Escape skips the opening cat scene or the Summit reunion. Chapter One uses the authored environment models, camera rail, gap leaps, shrine and scroll interactions, and ink-pool sequence. Chapter Two includes authored ledges and leaps, the court sword-wraith encounter, bells, door, moving slab, and crumble stones. All six chapters have native static collision and source-managed scene loading.

The title-menu game writes to `sumiro.native.save.v1`. Continue can read either shipped save format from the same browser origin. Use `?walk=1&continue=1` for a read-only preview that resolves the authored shrine stand. The native tests inject a writable store to verify explicit shrine interaction saves in Chapters One and Five.

The native runtime advances the Pines bridges, crumbles, tilting platforms and gusts, the Temple bells and lifts, the Sea tide, veils and floating carriers, and the Summit lift, ice holds and wind. Sea water uses a TSL shoreline pass and an isolated reflection pass that samples the completed land depth. Chapters Two through Six use their authored camera zones. The native encounter controller plays the authored wraith, archer and ronin waves. All six chapters have their shrine models and collectible scrolls. F picks up or sets down the cat, which follows the recorded ground trail when set down. The opening and reunion scenes use the supplied actor rigs and dialogue. The credits display the run's scrolls and time on the road. Detailed pose and material parity, several chapter-specific effects, and a continuous end-to-end playthrough remain open.

For device execution, install the separate Dawn test dependency and run the offscreen check:

```sh
npm ci --ignore-scripts
npm --prefix tests/native ci --ignore-scripts
npm run test:gpu
```

On Windows, `npm run test:gpu -- backend=d3d12` explicitly selects the D3D12 backend. The fixture requires a hardware adapter. It verifies resize and teardown, compares rendered pixels against an independent grade calculation, and checks normal encoding, surface IDs, depth, contour darkening, the Chapter Two terrain palette, and Sea reflection occlusion. It also exercises walking and jumping, checkpoint writes, pickup and carry, the first court and Pines encounters, transactional chapter swaps, and readback from every chapter. It plays the Chapter One cat scene, learns Ink Step from the pool, and walks through the gate into Chapter Two. It walks from the Summit arena checkpoint to the reunion, skips the scene, and checks that the game saves completion and enters the credits state. The fixture uses the installed Three.js Draco decoder through a Node worker. On Windows it decodes the actual textures through System.Drawing in PowerShell. On other platforms the fixture supplies flat textures, so it does not establish image fidelity there.

## Toolchain policy

The reconstruction pins Three.js r187, matching types, and TypeScript in its own lockfile. The compiler checks all application modules under `src/` with strict TypeScript and emits browser JavaScript. An integration test resolves the emitted native import map and literal module graph without depending on a published game chunk. `npm run inventory` reports coverage in the separate transitional build.

