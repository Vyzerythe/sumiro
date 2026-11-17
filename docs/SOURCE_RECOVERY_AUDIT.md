# Source recovery audit

**Audit date:** 2026-11-16 (US Eastern). **Scope:** reachable GitHub repositories and the published artifacts; not a forensic audit of private workstations, unpublished repos, backup archives, or the development environment.

## Evidence

| Finding | Evidence | Interpretation |
| --- | --- | --- |
| Latest published commit | `290cd0d4` on `Vyzerythe/sumiro` (`main`) says `Publish Sumiro build from sumiro@ccba6cf`. | The publisher records a seven-character source revision, but not a repository URL or accessible source checkout. |
| Earlier publication | `09eb40bf` says `Publish Sumiro build from sumiro@db75dae`. | There were at least two referenced upstream source states, but they are not source commits in this distribution repository. |
| Referenced source commit | GitHub's commit lookup for `ccba6cf` in `Vyzerythe/sumiro` returned `No commit found for SHA`. | **Do not** present `ccba6cf` as a locally recoverable revision. It may exist in another repository or an unpushed local checkout. |
| Published repository history | At inspection, `main` had two commits; neither includes an editable source tree. | The repository is an artifact publication channel at present. |
| Other public repositories with the Sumiro name | `1anc6/Sumiro`, `iceosng/Sumiro`, and `fredatgithub/Sumiro-game` had the same inspected tree SHA `0e26e6a70f088833e38b77a4ba2399ccb5ff5d7f`, containing compiled `bundle/` files rather than a `src/` project. | These are **not evidence of recovered original sources**. Do not import them merely because they share the name. |
| Existing build integrity | Ten JSON files parsed; the central audio index's music, voice, effect and ambience references resolved against the published tree. | These checks protect only a limited part of distribution integrity, not overall game behavior. |
| Repository CI | GitHub Actions run [44006820190](https://github.com/Vyzerythe/sumiro/actions/runs/44006820190) completed its static integrity job successfully on foundation PR #1. | A useful baseline, but not an original-source build or gameplay test. |

## Public creator and rights context

Public sources identify Shikhar (`@xikhar`) as the creator of the original Sumiro game and describe development with Claude Code, Three.js, Blender, AI-assisted image/model generation, and other tools. This is consistent with the published commit's author account but **does not prove** that the editable source is available or that this repository owner has permission to redistribute or relicense reconstructed derivatives.

References:
- [Creator's published game discussion (indexed)](https://www.xitter.cf/xikhar)
- [Creator workflow summary](https://amusehall.com/games/sumiro/)
- [Another distribution's project description](https://github.com/1anc6/Sumiro/blob/main/README.md)

Before substantial reconstruction for public distribution, confirm the original author(s)' licensing/permissions and whether they can supply the source checkout. The repository's public visibility is not a license grant.

## Binary/module reconstruction baseline

The inspected published distribution contains **57 compiled JavaScript modules, 2 WASM modules, 28 GLB assets, 25 OGG files, 10 JSON files**, and raster textures. The largest JavaScript modules include `index-DnHRwVtn.js` (~859 kB), `draco_decoder-fzg4nYZr.js` (~719 kB), `combat-Dp_zXhrv.js` (~75 kB), and `ink_material-CrFtRYQr.js` (~73 kB).

Subsystem names visible in generated chunks include `player`, `camera_rig`, `collision`, `combat`, `audio`, `music`, `render_pipeline`, `ink_material`, `cutscene`, `hud`, `game`, six `ch*` chapter modules, and environment/fx modules. These names are **clues**, not proof of the original source layout. The entry bundle mixes library/runtime and game logic.

The existing release contains compressed or hashed artifacts, so reconstructing readable modules is a *new implementation effort* rather than retrieving exact original comments, typings, or build configuration.

## Highest-value source recovery sequence

1. **Ask the originating producer/maintainer for the working tree** corresponding to `ccba6cf`, plus `db75dae`. Search local and remote Git clones, bare repositories, worktrees, reflogs, backup snapshots, unpushed branches, and CI/build logs. Avoid publishing private files or secrets accidentally.
2. Preserve a copy of the recovered repository **with Git history, LFS pointers/objects, manifests, build scripts, lockfiles, source maps, asset authoring sources, and provenance notes**. Verify hashes and ownership before import.
3. Execute the recovered build in an isolated, pinned environment and compare its distribution output with the exact published commit. Diff hashed artifacts, file inventory, asset paths and behavior; record legitimate nondeterminism before calling the build reproducible.
4. If the source is incomplete or unavailable, map every compiled chunk into subsystem groups and dependency edges. Capture existing browser behavior, save data, chapters, controls, assets and error conditions as a compatibility specification.
5. Reconstruct in small, testable source modules under a *separate work branch or repository*, with static and browser regression tests. Treat the shipped distribution as the reference, not as editable long-term source.
6. Promote reconstructed source only after parity gates pass. Retain the last known-good published build and a rollback path throughout migration.

## Gate criteria

**Gate A — source authenticity:** Provenance of source history and tools is documented; no imported code or media has unresolved ownership claims.

**Gate B — build reproducibility:** A fresh checkout using pinned versions builds without undocumented local inputs, and published output differences are explained.

**Gate C — behavioral parity:** Boot/loading, rendering, audio, inputs, every chapter transition, save migration/reload and representative failure cases pass controlled browser tests on supported environments.

**Gate D — operational maturity:** Security/licensing notices, CI, documented release procedure, regression suite, rollback and ownership are in place.

## Uncertainties and explicit non-claims

- No public search or reachable repository inspection proves the upstream source is lost, nor that it is available.
- Modern bundling/minification can erase original names, comments, source files and tool-specific project state. A functionally equivalent replacement is possible in principle but **not guaranteed in advance**.
- A complete reconstruction of Blender project files, procedural asset tooling, audio generation workflows or exact original commits cannot be inferred solely from the shipped binary assets.
- The source code, source license, and rights to redistribute/relicense third-party media must be verified separately.

**Current decision:** prioritize obtaining the actual source project; do not begin a disruptive rewrite of the shipped artifacts or fabricate a source scaffold before the source recovery gate is resolved.
