# Source reconstruction: phase 1 — chapter domain

This is the first **readable source reconstruction** from the shipped distribution. The original pre-bundled source has not been recovered.

## Scope

- Readable module: [`src/domain/chapters.mjs`](../src/domain/chapters.mjs).
- Published oracle: `sumiro/bundle/chapters-B8aGs4KP.js`.
- Behavioral tests: [`tests/chapter-parity.test.mjs`](../tests/chapter-parity.test.mjs).

The reconstructed registry carries all six chapter records, lookup behavior, ability initialization/grants, and chapter-switch state cleanup.

## Why this is safe

1. The new source is **not wired into the shipped game**. The original artifact remains byte-identical.
2. The test imports the published module and the reconstruction side by side, comparing actual metadata and calls across valid and unknown chapter identifiers.
3. Run mutation and reference identity are checked explicitly.
4. Legacy quirks, including clearing `shrine` but retaining `abilities` when changing to an unknown chapter, are preserved rather than silently improved.

## Commands

```sh
node --test tests/chapter-parity.test.mjs
node --test tests/*.test.mjs
```

Node.js 22 or newer is recommended, consistent with the repository CI.

## Remaining limits

This proves only the tested chapter-domain behavior. It is **not** proof of a full source build, license clearance, save compatibility, or browser gameplay parity. The original source comments and authoring layout cannot be retrieved verbatim from this bundle.

## Next migration slices

- Identify and reconstruct the save-data defaults, normalization and migration functions from `bundle/game-B5zfa1fm.js`, with edge-case fixtures.
- Trace integration boundaries for game state, chapter transitions, and UI.
- Reconstruct pure functionality before scene or renderer subsystems.
- Introduce a reproducible source entry/build only after enough upstream dependencies have been mapped and browser behavior has a dependable regression suite.

**Deployment gate:** Never replace `sumiro/bundle/` until a reconstructed build passes artifact integrity and representative browser/playthrough comparisons, including save migration and chapter progression.
