# Architecture and repository boundaries

## What is actually versioned here

The repository includes the static published distribution under `sumiro/` and the reconstructed implementation under `src/`. The published HTML entry loads hashed JavaScript from `sumiro/bundle/`. The published distribution is the compatibility reference for the six-chapter progression, browser-local saves, and procedural behavior.

````text
.
├── .nojekyll
├── sumiro/
│   ├── index.html
│   ├── bundle/        # generated JS and Draco/WebAssembly runtime files
│   └── assets/        # 3D models, textures, audio, and JSON data
├── src/               # readable domain, physics, player and rendering modules
├── scripts/           # immutable-output dev assembly and bundle inventory
├── tests/             # artifact, parity and integration checks
├── docs/              # maintainer documentation
└── .github/           # CI and contribution templates
````

The `assets/` hierarchy groups media by purpose (for example `audio/`, `backdrop/`, `player/`, and environment and chapter assets). `assets/audio/index.json` provides an audio index; neighboring manifests retain additional audio metadata.

## Execution paths

| Path | Role |
| --- | --- |
| `sumiro/` | Published reference and deployed entry point |
| `.local-build/` | Transitional gameplay build. Pinned adapters load readable domain, collision, player and frame-sizing code into the published runtime. |
| `src/rendering/` | Native Three.js r187 device lifecycle, TSL surface buffers and final grade. The opt-in Dawn harness renders through these modules and reads back GPU pixels. |
| `src/runtime/source-runtime.mts` | Composes native rendering, system hosting, assets, timing, and teardown. The Dawn harness drives this API using a fixture system. |

The target is a source-only TypeScript application that uses the native WebGPU renderer for gameplay. Application boot, complete scene composition, materials, remaining render effects, and end-to-end gameplay verification are still in progress.

## Stability boundaries

1. Preserve the generated files under `sumiro/bundle/` as the reference for differential verification.
2. Keep `sumiro/index.html` and the `sumiro/` URL prefix consistent with relative module and asset paths.
3. Treat binary media as shipped artifacts. Preserve names and directory layout unless the consuming code and manifests are rebuilt together.
4. Preserve the browser-local save keys and support stored legacy data through explicit migration.
5. Keep quality checks honest: CI catches static integrity failures and compares selected domain behaviors; Chromium verifies boot/title availability, **not** complete gameplay parity.

## Reconstruction boundary

Keep domain and physics code independent of browser and GPU state. The renderer owns its device, render targets, and passes. Application code owns scenes and cameras. Use published-runtime comparisons to protect gameplay contracts while replacing prototype internals with typed interfaces and explicit lifecycles. Retire compatibility adapters as source modules gain their own application entry points and verification.

