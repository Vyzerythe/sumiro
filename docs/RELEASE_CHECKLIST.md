# Release and smoke-test checklist

This is a manual checklist for the **published build**. A successful static integrity check is not a substitute for playing through the game.

## Pre-release

- [ ] Identify the originating source revision, artifact producer, and change summary.
- [ ] Confirm that the intended published `sumiro/` tree includes all hashed chunks, WASM, and assets.
- [ ] Run `node --test tests/static-build.test.mjs` and review CI status.
- [ ] Confirm any newly shipped media/dependencies have documented rights and required notices.
- [ ] Record the previously deployed commit SHA for rollback.

## Browser smoke test

- [ ] Serve over HTTP, then open `/sumiro/` at the target host prefix.
- [ ] Confirm the initial loading screen transitions into the application without an uncaught console error.
- [ ] Confirm WebGL rendering, pointer/keyboard input, and camera controls on a representative desktop browser.
- [ ] Check network requests for missing assets, cross-origin failures, and incorrect MIME types (especially modules and WASM).
- [ ] Confirm music, effects, and voice behave as intended after a user interaction (browser audio policies may require a gesture).
- [ ] Start a new game, verify progress and chapter transitions, and test restoring an existing save where possible.
- [ ] Exercise options and verify they persist appropriately after reload.
- [ ] Test chapter transitions through all six chapters where feasible; log any parts not covered.
- [ ] Test at least one additional browser or device profile and note graphics/performance limitations.

## Publication

- [ ] Verify the configured Pages/static-host publishing source and final URL.
- [ ] Deploy the exact audited artifact and test the live entry point.
- [ ] Capture the shipped commit, testing results, known limitations, and rollback reference.

## Post-release

- [ ] Monitor user reports and browser-console failures.
- [ ] If critical issues occur, restore the recorded prior artifact and re-verify path and save compatibility.

