# Asset provenance and licensing

## Current inventory

The build includes `.glb` models, `.jpg`/`.png`/`.webp` textures, `.ogg` audio, WebAssembly runtime files, and JSON metadata. Audio manifests and the game's compiled credits describe some production tools and models; this metadata **does not establish distribution or reuse rights**.

The music index identifies several generation/model families and per-track technical properties, including loop boundaries and loudness. Some manifest notes refer to source-side scripts and art directories that are not present in this published repository.

## Unresolved licensing questions

- There is no root `LICENSE` file or comprehensive third-party notices document in the inspected tree.
- Ownership, exact licenses, redistribution terms, attribution obligations, and service-specific conditions for all media and compiled dependencies have not been verified.
- The inclusion of generated audio or artwork does not establish that all required permissions are satisfied.

Do **not** apply an arbitrary open-source license to the whole repository or claim that any media is public-domain until the maintainers verify ownership and terms.

## Required provenance record for future assets

Maintain a per-asset inventory including:

| Field | What to record |
| --- | --- |
| Repository path | Final shipped path and file hash where useful |
| Creator/source | Author or generator, URL/project, and acquisition date |
| Tool/model | Version and relevant generation process, if applicable |
| Rights | Exact license/contract terms and permitted distribution/use |
| Attribution | Required credits and where shown |
| Modifications | Transformations, compression, normalization, or derivatives |
| Verification | Person/date confirming evidence and any restrictions |

## Next steps

1. Recover provenance from the original source project and production records.
2. Audit compiled JavaScript/WebAssembly dependencies and their notices from actual lockfiles or vendor records.
3. Select a software license with the rightful owner(s), and publish distinct notices or exceptions for art, music, voice, and other assets as required.
4. Add a definitive rights inventory and update the README only after verification.

