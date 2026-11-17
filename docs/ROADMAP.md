# Repository stabilization roadmap

This plan separates what can be improved **in the published-artifact repository now** from work that depends on obtaining the original editable project. Priorities are planning guidance, not commitments or claims that work is complete.

## P0 — provenance, access, and reproducibility

- [ ] Locate the canonical editable Sumiro source repository and identify its owners and maintenance responsibilities.
- [ ] Record the exact relationship between published commits and source revisions; ensure release artifacts can be reproduced from documented commands and pinned dependencies.
- [ ] Audit software and media ownership, applicable permissions, third-party notices, and the appropriate project license.
- [ ] Confirm the actual GitHub Pages / hosting configuration and protected deployment process.

## P1 — engineering quality gates

- [x] Document the published build's current structure and operational boundaries.
- [x] Add a zero-install static-distribution integrity check and CI job.
- [x] Establish contribution, vulnerability-reporting, and release guidance.
- [x] Add differential tests for reconstructed chapter, save, scroll and initial collision physics behavior.
- [ ] Recover the complete source and add source-level type/lint coverage and lockfile-based dependency/security review.
- [x] Add browser-level automation for reference/development boot and title-menu comparison.
- [ ] Extend browser automation to reliable core input, save compatibility, representative chapter flows, and visual/performance regressions.
- [ ] Enable appropriate branch protections and required checks in GitHub repository settings.

## P1.5 — progressive engine reconstruction

- [x] Integrate chapter, save, scroll and the collision-world factory (spatial queries, raycasts, capsule sweeps, moving bodies) into a guarded, isolated development build, with differential tests.
- [x] Reconstruct and integrate bounded player input, gait, jump/fall, low-mantle, ledge grab, hang, shimmy and climb transitions with differential tests.
- [x] Integrate authored leap targeting, flight interpolation, interruption and landing into the source-backed development player, retaining differential parity checks.
- [ ] Recover the remaining player motion solver, combat, game state, HUD, audio, rendering and scene/engine dependencies with independent parity checks.
- [ ] Resolve the published game's headless `CHAPTER_CARD` transition diagnostic and establish an authoritative gameplay/browser test baseline.
- [ ] Replace the transitional chunk adapter with an explicit, versioned, reproducible source build only after application dependency and parity gates pass.

## P2 — release maturity

- [ ] Automate building, attaching provenance/SBOM where applicable, preview deployment, and promotion/rollback.
- [ ] Establish browser/device support targets and measurable performance budgets.
- [ ] Document architecture and module ownership from the **actual source tree**.
- [ ] Maintain a changelog and compatibility notes linked to each future release.

## Guiding rule

Never confuse a neat directory hierarchy with a reproducible software project. Recover the editable source, the build process, and the rights documentation before reorganization that could compromise the published game.

