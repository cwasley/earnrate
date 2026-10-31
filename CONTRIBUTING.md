# Contributing

## Code

Code contributions (anything outside `data/`) are accepted under the [MIT license](LICENSE): inbound = outbound.

Development needs Node 24 or later (`.node-version` has the version CI uses) and Yarn 1. Node runs the TypeScript directly, so there's no build step: `yarn install`, then `yarn earnrate whole foods 80` runs the CLI, `yarn mcp` the local MCP server, `yarn site:dev` the website and `yarn remote:check` bundles the hosted server. Run `yarn validate` (typecheck, lint, format check and tests) before opening a PR.

Report security problems privately: see [SECURITY.md](SECURITY.md).

## Data

Changes under `data/` (card rules, merchants, categories, currencies) need a signed Contributor License Agreement that lets the maintainer relicense the contribution, including commercially. The data is CC BY-NC 4.0, and without that grant a contribution couldn't be included in a commercial data license.

The CLA isn't set up yet, so **PRs that touch `data/` can't be merged for now.** Issues pointing out a wrong rate are welcome. Link the issuer's own terms page.

Every rule must come from the issuer's own terms page, cited in the card's `source_urls`. Don't copy rules from third-party datasets, review sites or blogs.
