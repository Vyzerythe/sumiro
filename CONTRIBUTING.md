# Contributing to Sumiro

Thank you for helping improve Sumiro. This repository is currently a **published build**, so the most useful changes here are documentation, validation, accessibility/testing notes, and deployment reliability.

## Before making a change

1. Read [the architecture notes](docs/ARCHITECTURE.md) and [development guide](docs/DEVELOPMENT.md).
2. Open an issue describing the problem and expected behavior, or link an existing issue in the pull request.
3. Prefer small, reviewable pull requests. Do not modify, reformat, or regenerate bundled JS, WASM, and binary assets without the actual build inputs and a documented release process.
4. If the work requires game source code, first coordinate with the maintainers to obtain the corresponding editable source and build instructions. Do not reconstruct or invent project dependencies based only on the minified output.

## Review requirements

- Explain **what changed, why, and how it was checked**, including any manual browser testing.
- Run `node --test tests/static-build.test.mjs` using Node.js 22 or newer.
- Keep the existing game entry path (`sumiro/index.html`) and relative asset references intact unless a separately reviewed deployment migration is intended.
- Update nearby documentation and add validation coverage when behavior or asset layout changes.
- Do not commit credentials, private data, generated caches, or unapproved third-party assets.
- Record asset authorship, tools, source, and permitted uses for any new media. See [asset provenance](docs/ASSET_PROVENANCE.md).

## Scope and licensing

This repository does not yet include a declared license. Do not assume external contributions or assets can be redistributed under a particular license. Maintainers should agree on contribution and licensing terms before accepting substantial third-party code or media.

## Reporting problems

Use the issue templates for ordinary bugs and improvements. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

