# Sumiro

Sumiro is a browser-based, 3D interactive game presented as six chapters. This repository currently publishes **a built web distribution**, not the editable development source.

> **Repository status:** The shipped game is under `sumiro/`. The checked-in JavaScript files are bundled, hashed outputs. No source project, dependency lockfile, build command, or source-level test suite is included here. Do not assume that changing a compiled chunk is an enduring development workflow.

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
| `.nojekyll` | Bypasses Jekyll processing on compatible static hosting |
| `tests/` | Distribution-level integrity tests, not gameplay tests |
| `.github/workflows/` | Automated repository validation |
| `docs/` | Architecture, development, deployment, licensing, and release guidance |

**Important:** `sumiro/` is a deployment directory, not a source-code package. Its location matters to relative asset paths; do not move it or rename hashed bundle files without testing and updating all references.

## Validate changes

Run `node --test tests/static-build.test.mjs` with Node.js 22 or later. The check validates the distributable entry point, local JavaScript imports, JSON syntax, and referenced audio assets. It does **not** build the game, simulate gameplay, or prove rendering and audio work in browsers. See [release checks](docs/RELEASE_CHECKLIST.md) for manual testing.

For a reproducible inventory of the generated JS module graph, run `node scripts/inventory-bundle.mjs > bundle-inventory.json`; the output is a local, read-only report, not recovered source.

## Documentation

- [Architecture and repository boundaries](docs/ARCHITECTURE.md)
- [Development and validation](docs/DEVELOPMENT.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Asset provenance and licensing](docs/ASSET_PROVENANCE.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Stabilization roadmap](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md)

## Licensing

**No project-wide software or asset license is present in the inspected repository.** Public GitHub visibility is not itself a reuse license. Do not presume redistribution, modification, or commercial-use permissions for code, audio, models, images, or other assets. See [asset provenance](docs/ASSET_PROVENANCE.md); maintainers must establish and publish appropriate rights and notices before inviting broader reuse.

