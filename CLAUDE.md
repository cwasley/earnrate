# earnrate

Rewards rules engine: given a merchant (plus optional amount and channel), pick the card in my wallet that earns the most and explain why. Exposed as a CLI and an MCP server.

The maintainer's full spec (data model, golden tests, milestones, competitive landscape) is `private/PROJECT_CONTEXT.md`, a separate private repo checked out inside this one and ignored by it. Read the relevant section before starting a milestone when it's there. This file is only the summary.

## Hard rules

- Never store or handle card numbers, CVVs, expiry dates or bank logins. Cards are product IDs only (`amex-gold`).
- No Plaid, no payments, no checkout automation, no browser extension in v1.
- Card earn rates live in data files with `last_verified` and `source_url`. Never hardcode a rate in engine code.
- Don't invent rates. If a rule is ambiguous, leave a TODO and ask. Wrong rates are worse than missing ones.
- Matching and math are pure and deterministic. The LLM is only a cached, labeled fallback for merchant → category.
- Every recommendation states its matched rule, assumptions and confidence.
- The wallet is optional. No command, MCP tool or page may require one: with no cards, answer from every card earnrate knows; with cards named for one answer (`--cards`, the MCP `cards` input), use only those; a saved wallet adds tracking. Spending is optional too (typical amounts, said so). Statements stay CLI-only.

## Tooling

- Node >= 24 runs `.ts` files directly (type stripping), so development has no build step. Use only erasable TS syntax: no `enum`, `namespace` or parameter properties. Import local files with the `.ts` extension.
- The npm package is built JS: Node won't strip types inside `node_modules`. It supports Node 22 and up (`engines`), and CI smoke-tests the packed package on Node 22, so don't use newer Node APIs in `src/` without raising both. `yarn build` (`tsconfig.build.json`) emits `dist/` with `.ts` imports rewritten, and `yarn smoke:pack` installs the packed tarball in a temp dir and runs `earnrate`, `earnrate mcp` and `earnrate-mcp`. Paths built from `import.meta.url` must resolve the same from `src/` and `dist/`.
- TypeScript is pinned to `~6.0` because typescript-eslint doesn't support 7.x yet.
- `yarn validate` runs typecheck, lint, format check and tests. Run it before committing.
- `yarn earnrate <merchant> [amount]` runs the CLI (`src/cli/bin.ts`) against `$EARNRATE_WALLET` or `~/.earnrate/wallet.yaml`. CLI output is snapshot-tested against `wallet.example.yaml`, so a data or wording change shows up as a snapshot diff: review it, then `yarn vitest run -u`.
- `earnrate import` (`src/cli/import.ts`, `src/import/`) reads Amex and Chase activity CSVs. Don't add PDF statement parsing: Chase PDFs carry the full card number. Never copy a real statement into the repo, tests or fixtures; `tests/import.test.ts` uses synthetic CSVs, and its privacy test checks that only cap totals and hashes are written.
- Wallet edits (`src/data/wallet-edit.ts` for setup, `wallet-write.ts` for purchases) splice lines into the user's YAML and must re-parse to exactly the expected wallet before the atomic rename. Never re-serialize the wallet: it drops the user's comments. The add/update/remove/memberships rules live in `src/engine/wallet-change.ts` (pure, also used by the browser wallet on earnrate.dev); `src/data/wallet-setup.ts` applies them to the wallet file for the CLI (`src/cli/wallet.ts`) and the MCP tools.
- Freedom Flex's quarterly cap is `rotating: true`. When Chase posts a quarter (about two weeks before it starts), add its rules on that cap with `valid_from`/`valid_to` and evidence; until then answers warn that the quarter is missing.
- `plugin/` is the Claude plugin (Claude Code and local Cowork; plugin MCP servers don't run in Desktop chat, which uses the `.mcpb`). Claude Code installs the pinned npm version from `plugin/package-lock.json` (npm's format, since Claude Code doesn't read yarn lockfiles) and runs it with `node`, and `.claude-plugin/marketplace.json` lets people install it from this repo. Check it with `claude plugin validate --strict ./plugin`. Its README must say everything the plugin runs, sends or fetches.
- `mcpb/manifest.json` describes the Claude Desktop bundle; its `tools` list must match the server's tools (`yarn smoke:mcpb` checks the built bundle). Keep new MCP tools in it.
- `yarn mcp` runs the MCP server (`src/mcp/bin.ts`, stdio; never write to stdout there). `tests/mcp.test.ts` drives it with an in-process client plus one real stdio round trip.
- The Claude merchant fallback is tested only with fake classifiers (`tests/llm.test.ts`). Never call the real API from tests.
- When a card's `todo:` is something the engine or schema can't express (not a data gap), also add it to `docs/feature-gaps.md`.
- Every card rule needs an `evidence` quote (3–20 words) from one of the card's `source_urls`; integrity tests enforce it. After changing a card, run `yarn check-sources --update` to refresh `data/sources.lock.json`. `src/sources/` is the checker; it stores only hashes of issuer text.
- earnrate.dev (`site/`) is a static Vite + Preact app that runs the engine in the browser. `site/vite.config.ts` builds the card data into the bundle as `virtual:catalog`, so engine code used by the site must stay free of Node imports (only `src/data/` and `src/merchants/cache.ts` may use them). `yarn site:dev` runs it locally, `yarn site:build` writes `site-dist/`, and `yarn site:deploy` builds and deploys to Cloudflare. Nothing the visitor types may leave the browser: no fetches, and searches go in the URL fragment only. `scripts/build-pages.ts` (run by `yarn site:build`) also renders static search pages, `/best/<store>`, `/best/<category>` and `/cards/<card>`, plus `sitemap.xml` and `robots.txt`. They state current rates and quarterly bonuses publicly, so redeploy the site after every data change and when a quarter turns over.
- Tests: vitest, in `tests/` (golden cases in `tests/golden/`) or next to the source as `*.test.ts`.

## Releasing

1. Bump `version` in `package.json`, both versions in `server.json` and the one in `mcpb/manifest.json` (a test keeps them in step), commit and push.
2. Create a GitHub release tagged `v<version>`. `.github/workflows/release.yml` validates, checks the tag, and runs `npm stage publish --provenance` through npm trusted publishing (no npm token in the repo), then builds `earnrate.mcpb` (the Claude Desktop one-click install, `yarn mcpb:pack`), smoke-tests it and attaches it to the release.
3. Collin approves the staged version on npmjs.com (Staged Packages) with 2FA. Nothing is live until then.
4. Once `npm view earnrate version` shows it, `mcp-publisher publish` updates the MCP registry entry.
5. Then `yarn plugin:lock` pins the Claude plugin to the new version (`plugin/package.json`, its npm `package-lock.json` and `plugin.json`'s version); commit and push, and the directory picks it up from the push.

## Working agreement

- Start each milestone with a short plan and wait for an OK before large changes.
- Keep `private/PROJECT_CONTEXT.md` current: when a decision lands or research changes the plan, update it and add a changelog line.
- Write the golden tests (spec §8) before the engine logic.
- Flag any issuer terms page that contradicts the seed table (spec §7).
- Prefer work that widens the differentiation gaps (spec §14) over features competitors already have.
