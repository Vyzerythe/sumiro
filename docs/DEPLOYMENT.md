# Deployment

## Distribution contract

The published site is the directory `sumiro/`, whose entry point is `sumiro/index.html`. The HTML refers to `./bundle/...` and the game loads assets relative to its served base. Preserve that relationship on any static host.

## Local preflight

1. Run `node --test tests/static-build.test.mjs`.
2. Serve the **repository root** using `python3 -m http.server 8000`.
3. Open `http://localhost:8000/sumiro/` and follow the [release checklist](RELEASE_CHECKLIST.md).
4. In browser developer tools, inspect Console and Network for failed module, `.wasm`, audio, texture, or model requests.

## Static-host publication

- Publish **the entire** `sumiro/` directory without changing generated file names.
- If serving the whole repository from its root, the application entry is `/sumiro/` relative to that site root. This is not a root-level `index.html` application.
- If serving `sumiro/` as the host's document root instead, use `/`; verify that relative URLs still resolve.
- If using GitHub Pages from the repository root, keep `.nojekyll` as needed to prevent Jekyll processing. Verify the real URL and publishing source in repository Pages settings; these settings have **not** been established by this documentation.
- Deploy to a preview or staging URL where possible, and smoke-test before promoting.

## Updating the build

Do not hand-edit compiled chunks. Prefer an upstream release that includes its source revision, build command, output manifest, and a tested copy of the resulting `sumiro/` tree. Validate the new hash references and asset filenames together. Document a rollback reference (commit SHA) before changing the published artifact.

## Rollback

Re-publish the last known-good artifact commit and verify the same served path. Check saved-game compatibility before reverting a release that changes the save schema.

