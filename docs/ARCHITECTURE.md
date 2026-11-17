# Architecture and repository boundaries

## What is actually versioned here

The default branch currently contains a **static web distribution** rooted at `sumiro/`, plus `.nojekyll` at repository root. `sumiro/index.html` loads a hashed JavaScript entry module from `sumiro/bundle/` using relative paths. Compiled code contains the game's six-chapter progression and a browser-local save key (`sumiro.save.v1`).

````text
.
├── .nojekyll
├── sumiro/
│   ├── index.html
│   ├── bundle/        # generated JS and Draco/WebAssembly runtime files
│   └── assets/        # 3D models, textures, audio, and JSON data
├── tests/             # static-distribution checks
├── docs/              # maintainer documentation
└── .github/           # CI and contribution templates
````

The `assets/` hierarchy groups media by purpose (for example `audio/`, `backdrop/`, `player/`, and environment and chapter assets). `assets/audio/index.json` provides an audio index; neighboring manifests retain additional audio metadata.

## What is not present

- Editable source modules or a canonical application architecture document from the originating source project.
- A package manifest, lockfile, and documented version of the build toolchain.
- A verifiable build-from-source command or source maps.
- Source-level tests, browser automation, or published gameplay/performance benchmarks.

The release commit on `main` is labeled `Publish Sumiro build from sumiro@ccba6cf`. That string is **provenance information, not a reproducible-source link**: the referenced source tree and its workflow are not available in this repository.

## Stability boundaries

1. Treat all files under `sumiro/bundle/` as immutable generated outputs until the upstream build is available.
2. Keep `sumiro/index.html` and the `sumiro/` URL prefix consistent with relative module and asset paths.
3. Treat binary media as shipped artifacts. Preserve names and directory layout unless the consuming code and manifests are rebuilt together.
4. Preserve save compatibility when source work eventually resumes; existing saves are browser-local and may depend on keys and schema in the bundled code.
5. Keep quality checks honest: the CI check catches missing files and bad JSON, but it does not certify runtime behavior.

## Future source integration

When the editable project is available, evaluate either a separate source repository with an automated publication pipeline to this repository, **or** a source-and-distribution layout in one repository. Choose based on actual build requirements, ownership, deployment settings, and history. Do not pre-create a speculative `src/` tree.

