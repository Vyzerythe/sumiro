# Sumiro

Sumiro is a browser-based 3D game spanning six chapters. The native reconstruction on `main` is written in **strict TypeScript with Three.js r187, WebGPU, and TSL**. Its playable build loads the supplied models, textures, and audio from `sumiro/assets/`. The original compiled distribution is still served from `sumiro/`.

## Run the native source build

```sh
npm ci
npm run build:source
python3 -m http.server 8000
```

Open [the native game](http://localhost:8000/.local-build-source/) in a WebGPU-capable browser. The title menu starts a new run, resumes a checkpoint, or replays an unlocked chapter. The title and pause menus expose controls and options. Native sessions use their own save slot and can read the shipped save formats. See [Development and validation](docs/DEVELOPMENT.md) for the hardware test.

The native application has all six chapter worlds, authored traversal and cameras, combat, shrines, collectible scrolls, and progression through the ending. The checks cover connected routes and separate checkpoint approaches. A continuous six-chapter run and detailed audiovisual parity are still open.

## Run the published build locally

1. Clone this repository.
2. From the repository root run `python3 -m http.server 8000` (or any static HTTP server).
3. Visit [http://localhost:8000/sumiro/](http://localhost:8000/sumiro/) in a modern browser with WebGL support.

Use HTTP rather than opening `index.html` via `file://`: module loading and asset requests are subject to browser security rules. The repository does not require `npm install` to serve the existing build.

## Repository layout

| Path | Purpose |
| --- | --- |
| `sumiro/index.html` | Game entry point and loading screen |
| `sumiro/bundle/` | Generated, content-hashed JavaScript and WASM runtime assets |
| `sumiro/assets/` | Game models, textures, audio, and JSON asset data |
| `src/application/` | Native browser entry, chapter assembly, mechanisms, interactions, and story presentation |
| `src/domain/` | Chapter, save, vitals, companion, and scroll logic |
| `src/physics/` | Reconstructed collision world, raycasts, capsule sweeps, spatial grid and moving-body logic |
| `src/player/` | Locomotion, ledge traversal, Ink Step, animation, and input steering |
| `src/combat/` | Player sword actions, encounter state, enemy behavior, and crow swarms |
| `src/rendering/` | Native WebGPU renderer, TSL ink passes, material adapters, and backdrop |
| `scripts/build-native-preview.mjs` | Compiles the source-only browser application |
| `scripts/build-reconstructed-dev.mjs` | Builds the separate transitional distribution |
| `scripts/browser-smoke.mjs` | Chromium boot/title comparison against the published game |
| `.nojekyll` | Bypasses Jekyll processing on compatible static hosting |
| `tests/` | Distribution integrity, source parity, gameplay route tests, and native WebGPU readbacks |
| `.github/workflows/` | Automated repository validation |
| `docs/` | Architecture, development, deployment, licensing, and release guidance |

**Important:** `sumiro/` is a deployment directory, not a source-code package. Its location matters to relative asset paths; do not move it or rename hashed bundle files without testing and updating all references.

## Validate changes

Use Node.js 22.18 or newer for source development.

```sh
npm ci
npm run typecheck
npm test
npm run build:source
npm run build:dev
```

Serve `.local-build/` over HTTP and visit `/sumiro/` to run the transitional build. It compiles recovered TypeScript and uses adapters to load recovered modules into the published runtime. Keep production deployments on the published distribution while reconstruction is in progress.

The transitional build uses the shipped WebGL renderer. The native source build initializes WebGPU directly and has a separate hardware-only verification command.

GitHub Actions also runs a Chromium comparison of the published and development builds through the title screen. It does **not** prove gameplay/save-reload parity; the New Game transition test remains a documented opt-in diagnostic. See [source-backed build and test limitations](docs/SOURCE_BACKED_DEV_BUILD.md) and [release checks](docs/RELEASE_CHECKLIST.md).

Run `npm run --silent inventory` for the published JavaScript import graph, adapter source paths, and coverage by chunk. The inventory checks each adapted chunk against its pinned Git blob.

## Documentation

- [Architecture and repository boundaries](docs/ARCHITECTURE.md)
- [Source-backed development build](docs/SOURCE_BACKED_DEV_BUILD.md)
- [Development and validation](docs/DEVELOPMENT.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Asset provenance and licensing](docs/ASSET_PROVENANCE.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Stabilization roadmap](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md)

## Licensing

**No project-wide software or asset license is present in the inspected repository.** Public GitHub visibility is not itself a reuse license. Do not presume redistribution, modification, or commercial-use permissions for code, audio, models, images, or other assets. See [asset provenance](docs/ASSET_PROVENANCE.md); maintainers must establish and publish appropriate rights and notices before inviting broader reuse.

