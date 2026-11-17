# Architecture and repository boundaries

## What is actually versioned here

The default branch `main` remains the **static published distribution** rooted at `sumiro/`. The reconstruction working branch adds readable, selectively recovered modules under `src/` and tooling under `scripts/` while retaining the same published game bytes. `sumiro/index.html` loads a hashed JavaScript entry module from `sumiro/bundle/` using relative paths. Compiled code contains the game's six-chapter progression and a browser-local save key (`sumiro.save.v1`).

````text
.
├── .nojekyll
├── sumiro/
│   ├── index.html
│   ├── bundle/        # generated JS and Draco/WebAssembly runtime files
│   └── assets/        # 3D models, textures, audio, and JSON data
├── src/               # selected reconstructed domain/physics modules
├── scripts/           # immutable-output dev assembly and bundle inventory
├── tests/             # artifact, parity and integration checks
├── docs/              # maintainer documentation
└── .github/           # CI and contribution templates
````

The `assets/` hierarchy groups media by purpose (for example `audio/`, `backdrop/`, `player/`, and environment and chapter assets). `assets/audio/index.json` provides an audio index; neighboring manifests retain additional audio metadata.

## What is available versus still missing

- **Available on the reconstruction branch:** readable chapter/save/scroll code, collision geometry and moving-body code; executable parity comparisons with the compiled implementation; isolated development-build assembly; title-screen Chromium smoke coverage.
- **Still missing:** the original, complete editable game source, its canonical source architecture and historical authoring files, dependency/lockfile-based application build toolchain, and a **fully source-compiled** production build.
- **Still unverified:** representative gameplay, save/reload and chapter progression in the source-backed runtime; full browser/device compatibility; asset ownership, licenses and reproducible production output.

The release commit on `main` is labeled `Publish Sumiro build from sumiro@ccba6cf`. That string is **provenance information, not a reproducible-source link**: the referenced source tree and its workflow are not available in this repository.

## Stability boundaries

1. Treat all files under `sumiro/bundle/` as immutable generated outputs until the upstream build is available.
2. Keep `sumiro/index.html` and the `sumiro/` URL prefix consistent with relative module and asset paths.
3. Treat binary media as shipped artifacts. Preserve names and directory layout unless the consuming code and manifests are rebuilt together.
4. Preserve save compatibility when source work eventually resumes; existing saves are browser-local and may depend on keys and schema in the bundled code.
5. Keep quality checks honest: CI catches static integrity failures and compares selected domain behaviors; Chromium verifies boot/title availability, **not** complete gameplay parity.

## Reconstruction boundary

The recovered `src/` hierarchy is intentionally incremental: domain modules and selected physics operations use unambiguous public interfaces and are compared against the compiled reference. The development builder copies the artifact to an ignored scratch directory and rewires only pinned, audited chunk boundaries. This is **a transitional compatibility bridge**, not a finished authoring toolchain. Future production architecture must be selected after core engine modules, dependency ownership and browser-level gameplay gates are understood.

