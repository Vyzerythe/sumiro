# Reconstruction phase 2 — save-data domain

This change reconstructs the **save-data prelude** of the published `sumiro/bundle/game-B5zfa1fm.js` into readable `src/domain/save.mjs`. The original compiled game remains deployed, unchanged.

## Surface area

- Save keys: `sumiro.save.v1` and legacy fallback `ink_wanderer.save.v1`.
- Default run, option values, and volume-schema migration.
- Legacy chapter alias `ch2_stub` and unlock canonicalization.
- Existing permissive validation predicate.
- Local storage read/write behavior and catch-all failure paths.

## Differential parity testing

`tests/save-parity.test.mjs` extracts the original self-contained save-function prelude from the immutable compiled game file and evaluates it in an isolated Node VM context with stubbed chapter lookups and mock storage. It compares its outputs to the reconstructed module using representative valid/invalid data, option migrations, chapter aliases, fallback keys, and storage errors.

```sh
node --test tests/save-parity.test.mjs
node --test tests/*.test.mjs
```

The oracle is version-specific. If the compiled game is regenerated or minifier identifiers change, the extraction **must fail closed** and be reviewed against the new generated output; do not silently adjust tests to mask drift.

## Important caveats

- Permissive validation is deliberately retained for compatibility. Passing `isSupportedSave` does **not** imply that a save satisfies a safe schema.
- A malformed save in the newer key can suppress valid legacy data due to first-key priority. This behavior is faithfully retained and should be improved only with a separate migration plan.
- The source module accepts injected storage for testing. Production default behavior still targets `globalThis.localStorage`.
- No claim of browser/whole-game parity, safe save migration across future versions, or origin of the upstream editable source is made.

## Next gate

Test the reconstructed domain in a controlled source-powered integration harness, recover the relevant game-state consumers, and establish repeatable browser smoke tests before changing any published `sumiro/` artifact.
