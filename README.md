# Sumiro

Sumiro is a browser-based 3D game spanning six chapters. **The production game in `sumiro/` is a compiled distribution.** The `work/source-reconstruction` branch contains an incremental, independently tested **reconstruction** of selected source modules, but not the original, complete upstream source project.

> **Development status:** This branch can build a separate source-backed development copy using readable chapter, save, scroll and reconstructed collision-world modules. Most game systems are still compiled artifacts. The original authoring project, source-build toolchain, and complete gameplay parity are **not** recovered or verified. Nothing under the published `sumiro/` directory is modified.

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
| `src/domain/` | Reconstructed chapter, save, and scroll game logic |
| `src/physics/` | Reconstructed collision world, raycasts, capsule sweeps, spatial grid and moving-body logic |
| `src/player/` | Source-backed player input steering, cinematic timing and ledge-path interpolation (not full locomotion) |
| `scripts/build-reconstructed-dev.mjs` | Guarded, isolated source-backed development build |
| `scripts/browser-smoke.mjs` | Chromium boot/title comparison against the published game |
| `.nojekyll` | Bypasses Jekyll processing on compatible static hosting |
| `tests/` | Distribution integrity, differential behavioral parity and development-build checks (not full gameplay tests) |
| `.github/workflows/` | Automated repository validation |
| `docs/` | Architecture, development, deployment, licensing, and release guidance |

**Important:** `sumiro/` is a deployment directory, not a source-code package. Its location matters to relative asset paths; do not move it or rename hashed bundle files without testing and updating all references.

## Validate changes

Use Node.js 22.18 or newer for source development.

```sh
npm ci
npm run typecheck
npm test
npm run build:dev
```

Serve `.local-build/` over HTTP and visit `/sumiro/` to run the transitional build. It compiles recovered TypeScript and uses adapters to load recovered modules into the published runtime. Keep production deployments on the published distribution while reconstruction is in progress.

The target source stack is strict TypeScript and Three.js r187 with WebGPU and TSL. The development build currently uses the shipped WebGL renderer for compatibility while the types and application modules are recovered.

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

