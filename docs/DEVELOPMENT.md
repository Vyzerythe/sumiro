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

## Distribution checks

```sh
node --test tests/static-build.test.mjs
```

The tests ensure that:

- `sumiro/index.html` is present, with a local script entry and existing relative HTML references;
- local static JavaScript module imports resolve within the distributed tree;
- checked-in JSON configuration files have valid syntax;
- files identified by the audio index and audio manifests actually exist.

**Not tested:** successful page boot, 3D rendering, asset decoding, gameplay progression, audio output, controls, browser compatibility, or rebuild reproducibility. Run the [manual release checks](RELEASE_CHECKLIST.md) for those areas.

## Making changes safely

Documentation or validation changes can be made here directly by pull request. Avoid editing hashed bundle chunks: changes will be overwritten by the next published build and may break the module graph. If a game behavior change is required, first locate the source project, establish a documented build, and include generated artifacts and provenance together as one auditable release.

## What not to bootstrap yet

Do not add a placeholder `package.json`, guessed build commands, copied framework configuration, or empty source directories solely to resemble a typical JavaScript repository. The proper toolchain must be recovered from the originating project.

