# Source-backed transitional development build

**Status:** An integration experiment, not the final rebuild of Sumiro.

The repository's published game still lives in `sumiro/`. The source-backed development build assembles an isolated copy that **loads the reconstructed chapter and save modules into the actual original game runtime**.

## Build and serve

```sh
node scripts/build-reconstructed-dev.mjs
python3 -m http.server 8000 --directory .local-build
```

Open `http://localhost:8000/sumiro/`. Compare with the unmodified published game served from the repository root at `http://localhost:8000/sumiro/` using a separate server/root, port, or browser profile. **Save data is stored by browser origin**; do not run compatibility experiments against irreplaceable player saves. Back up localStorage or use a fresh browser profile.

## What the script does

1. Validates the original immutable compiled chapter and game chunks using pinned Git blob hashes; fails if source artifacts changed.
2. Copies `sumiro/` and `src/` into `.local-build/`.
3. Replaces the **copied** chapter chunk with an ES module adapter mapping the original minified export names to `src/domain/chapters.mjs`.
4. Replaces the **copied** game save prelude with imports bound to `src/domain/save.mjs`.
5. Writes a JSON provenance report listing exactly which source modules are used.

Only the **development copy** is modified; tracked artifacts in `sumiro/` are untouched. This does not introduce a package manager or attempt to recompile unrelated generated modules.

## Test

```sh
node --test tests/*.test.mjs
```

The integration test builds the copied tree, confirms the original file contents did not change, verifies the new adapter can import the readable chapter module, and checks that save references are redirected. CI runs this test.

## Limits and safety gates

- The other JavaScript chunks, third-party library code, WASM, models, textures, and audio are **still compiled distribution artifacts**.
- Automated coverage is **structural and domain-level**. A real-browser playthrough of the generated development build has not been completed. Do not deploy it as production.
- Bundler/minifier output can change when the game is updated; pinned hashes intentionally prevent blindly applying transformations to a new build.
- This stage deliberately retains original save semantics, including legacy validation shortcomings. Do not test against important personal progress without backup.
- A full clean source build will need reconstructed entry composition, rendering, physics, scene, audio, user input, and third-party dependencies, plus browser gameplay and licensing verification.

## Next milestone

Introduce an automated browser smoke test for both original and source-backed builds (boot, menu, new game, save/reload, and chapter flow) and compare observable behavior. Continue subsystem reconstruction only when the integration harness can detect regressions.
