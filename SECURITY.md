# Security Policy

## Supported scope

This repository distributes a browser-based static application. Because the editable source and repeatable build process are not included, there is currently no published supported-version matrix or promised patch-response timeframe.

## Report a vulnerability privately

**Do not post exploit details, tokens, or private user information in a public issue.**

Use GitHub's **Report a vulnerability** / private vulnerability reporting feature on this repository if it is enabled. If it is unavailable, contact the repository owner privately using a contact method published on their GitHub profile. No dedicated security mailbox has been verified for this project.

Include the affected file or feature, reproduction steps, expected and actual behavior, browser/environment, and an estimate of impact. Avoid attaching other users' data.

## Operational notes

- A static distribution may still be affected by browser, dependency, supply-chain, and hosting issues.
- Third-party packages present inside compiled bundles cannot be reliably upgraded until the development source and dependency manifests are available.
- Validate proposed fixes against both the distribution integrity checks and manual browser smoke tests before publishing.

