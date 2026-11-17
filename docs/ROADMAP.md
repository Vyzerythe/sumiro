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
- [ ] Once source is available, add source-level type/lint/unit checks and lockfile-based dependency/security review.
- [ ] Add browser-level automation for boot, core input, save compatibility, representative chapter flows, and visual/performance regressions.
- [ ] Enable appropriate branch protections and required checks in GitHub repository settings.

## P2 — release maturity

- [ ] Automate building, attaching provenance/SBOM where applicable, preview deployment, and promotion/rollback.
- [ ] Establish browser/device support targets and measurable performance budgets.
- [ ] Document architecture and module ownership from the **actual source tree**.
- [ ] Maintain a changelog and compatibility notes linked to each future release.

## Guiding rule

Never confuse a neat directory hierarchy with a reproducible software project. Recover the editable source, the build process, and the rights documentation before reorganization that could compromise the published game.

