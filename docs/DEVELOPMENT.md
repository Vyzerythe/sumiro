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

**Not yet verified:** gameplay progression beyond the title, audio output, realistic rendering, complete source-build reproducibility and cross-browser support. The opt-in New Game interaction probe is currently inconclusive on the *published reference* under headless software rendering. See [the development-build guide](SOURCE_BACKED_DEV_BUILD.md) and [manual release checks](RELEASE_CHECKLIST.md).

## Making changes safely

Documentation or validation changes can be made here directly by pull request. Avoid editing hashed bundle chunks: changes will be overwritten by the next published build and may break the module graph. For behavior changes, update recovered source only after determining the relevant compatibility contract, and do not promote the development copy to production without completed gameplay regression checks and provenance.

## Native WebGPU verification

The source runtime in `src/runtime/source-runtime.mts` composes the system host, asset service, simulation clock, optional audio mixer, and WebGPU renderer. The renderer owns the device, canvas configuration, scene pass, and TSL output graph. Callers own the scene and camera. Runtime teardown awaits systems before releasing audio, assets, and rendering. The default suite checks generated WGSL, startup rollback, and pass disposal.

To serve the native preview, run `npm run build:source` and serve the repository root. Open `http://localhost:8000/.local-build-source/` in a WebGPU-capable browser to inspect the Chapter One GLB. Use `?chapter=ch2_pass` or `?chapter=ch3_pines` to inspect later geometry. Add `?walk=1` to start traversal with WASD, arrow keys, and Space. The native route includes Chapter One's authored camera rail, gap leaps, shrine and scroll interactions, and ink-pool sequence. Chapter Two adds the court bells, door, moving slab, and crumble stones. Source activation can load Chapter Three's static world. Encounters and portions of later traversal still use the transitional build.

The traversal preview uses the supplied player model and its traversal clips. Use `?walk=1&continue=1` to read a Chapter One checkpoint from the same browser origin. The preview can resume the table and plateau shrines and leaves stored saves untouched. The native test injects a writable store to verify explicit shrine interaction saves.

For device execution, install the separate Dawn test dependency and run the offscreen check:

```sh
npm ci --ignore-scripts
npm --prefix tests/native ci --ignore-scripts
npm run test:gpu
```

On Windows, `npm run test:gpu -- backend=d3d12` explicitly selects the D3D12 backend. The fixture starts a source system, loads data, advances and pauses simulation, then compares center and corner pixels at two drawing-buffer sizes. It checks independently calculated highlight compression and falloff, with a tolerance of two 8-bit code values per channel for dithering and render-target precision. It also verifies normal encoding, surface IDs, depth, contour darkening, resize propagation, teardown, rendering of the Chapter One GLB and player rig, keyboard movement and jumping, and checkpoint resume. The Node fixture omits the player GLB's embedded JPEG binding in memory. The browser loads the original GLB.

## Toolchain policy

The reconstruction pins Three.js r187, matching types, and TypeScript in its own lockfile. The compiler checks new TypeScript modules and emits browser modules into the isolated development build. It also parses the published literal import graph for `npm run inventory`. Existing JavaScript source modules still participate in the transitional build. The browser CI job installs its driver separately.

