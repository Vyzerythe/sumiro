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

```sh
node --test tests/*.test.mjs
node scripts/build-reconstructed-dev.mjs
python3 -m http.server 8000 --directory .local-build
# Open http://localhost:8000/sumiro/
```

The development builder never edits published assets. Its output is isolated and ignored by Git. It rejects unsafe output paths and refuses to rewrite chunks when pinned reference hashes have changed.

The tests ensure that:

- `sumiro/index.html` is present, with a local script entry and existing relative HTML references;
- local static JavaScript module imports resolve within the distributed tree;
- checked-in JSON configuration files have valid syntax;
- files identified by the audio index and audio manifests actually exist.

**Additional test coverage:** chapter progression functions, save migration and storage behavior, collectible scroll data, collision geometry, and moving-body transforms are tested against the published compiled implementation. CI separately boots both builds in Chromium and verifies a visible title menu with no uncaught JS/network failures.

**Not yet verified:** gameplay progression beyond the title, audio output, realistic rendering, complete source-build reproducibility and cross-browser support. The opt-in New Game interaction probe is currently inconclusive on the *published reference* under headless software rendering. See [the development-build guide](SOURCE_BACKED_DEV_BUILD.md) and [manual release checks](RELEASE_CHECKLIST.md).

## Making changes safely

Documentation or validation changes can be made here directly by pull request. Avoid editing hashed bundle chunks: changes will be overwritten by the next published build and may break the module graph. For behavior changes, update recovered source only after determining the relevant compatibility contract, and do not promote the development copy to production without completed gameplay regression checks and provenance.

## Toolchain policy

No authoritative upstream package manifest or lockfile has been recovered. The current reconstruction uses built-in Node test facilities; Playwright is installed transiently only in the browser CI job. Do not add guessed runtime dependencies, a placeholder production package manifest, or a speculative bundler configuration before the actual source/build requirements are established.

