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

## Tooling

- Node >= 24 runs `.ts` files directly (type stripping), so development has no build step. Use only erasable TS syntax: no `enum`, `namespace` or parameter properties. Import local files with the `.ts` extension.
- The npm package is built JS: Node won't strip types inside `node_modules`. It supports Node 22 and up (`engines`), and CI smoke-tests the packed package on Node 22, so don't use newer Node APIs in `src/` without raising both. `yarn build` (`tsconfig.build.json`) emits `dist/` with `.ts` imports rewritten, and `yarn smoke:pack` installs the packed tarball in a temp dir and runs `earnrate`, `earnrate mcp` and `earnrate-mcp`. Paths built from `import.meta.url` must resolve the same from `src/` and `dist/`.
- TypeScript is pinned to `~6.0` because typescript-eslint doesn't support 7.x yet.
- `yarn validate` runs typecheck, lint, format check and tests. Run it before committing.
- `yarn earnrate <merchant> [amount]` runs the CLI (`src/cli/bin.ts`) against `$EARNRATE_WALLET` or `~/.earnrate/wallet.yaml`. CLI output is snapshot-tested against `wallet.example.yaml`, so a data or wording change shows up as a snapshot diff: review it, then `yarn vitest run -u`.
- `earnrate import` (`src/cli/import.ts`, `src/import/`) reads Amex and Chase activity CSVs. Don't add PDF statement parsing: Chase PDFs carry the full card number. Never copy a real statement into the repo, tests or fixtures; `tests/import.test.ts` uses synthetic CSVs, and its privacy test checks that only cap totals and hashes are written.
- `yarn mcp` runs the MCP server (`src/mcp/bin.ts`, stdio; never write to stdout there). `tests/mcp.test.ts` drives it with an in-process client plus one real stdio round trip.
- The Claude merchant fallback is tested only with fake classifiers (`tests/llm.test.ts`). Never call the real API from tests.
- When a card's `todo:` is something the engine or schema can't express (not a data gap), also add it to `docs/feature-gaps.md`.
- Every card rule needs an `evidence` quote (3–20 words) from one of the card's `source_urls`; integrity tests enforce it. After changing a card, run `yarn check-sources --update` to refresh `data/sources.lock.json`. `src/sources/` is the checker; it stores only hashes of issuer text.
- Tests: vitest, in `tests/` (golden cases in `tests/golden/`) or next to the source as `*.test.ts`.

## Releasing

1. Bump `version` in `package.json` and both versions in `server.json` (a test keeps them in step), commit and push.
2. Create a GitHub release tagged `v<version>`. `.github/workflows/release.yml` validates, checks the tag, and runs `npm stage publish --provenance` through npm trusted publishing (no npm token in the repo).
3. Collin approves the staged version on npmjs.com (Staged Packages) with 2FA. Nothing is live until then.
4. Once `npm view earnrate version` shows it, `mcp-publisher publish` updates the MCP registry entry.

## Working agreement

- Start each milestone with a short plan and wait for an OK before large changes.
- Keep `private/PROJECT_CONTEXT.md` current: when a decision lands or research changes the plan, update it and add a changelog line.
- Write the golden tests (spec §8) before the engine logic.
- Flag any issuer terms page that contradicts the seed table (spec §7).
- Prefer work that widens the differentiation gaps (spec §14) over features competitors already have.
