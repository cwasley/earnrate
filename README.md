# earnrate

[![CI](https://github.com/cwasley/earnrate/actions/workflows/ci.yml/badge.svg)](https://github.com/cwasley/earnrate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/earnrate)](https://www.npmjs.com/package/earnrate)
[![Code: MIT](https://img.shields.io/badge/code-MIT-blue)](LICENSE)
[![Data: CC BY-NC 4.0](https://img.shields.io/badge/data-CC%20BY--NC%204.0-lightgrey)](data/LICENSE)

I wanted a ghost card: one card that always charges the best of my cards. The card networks won't allow one, so I built the next best thing.

**earnrate is the best-card decision layer for people and AI agents.** Give it a merchant, and it tells you which card in your wallet earns the most there, and why. It's stateful (it knows your caps and chosen categories), valuation-aware, and transparent about its assumptions. It never sees a card number.

- Runs on your machine. No account, no telemetry, no affiliate links. See the [privacy page](https://earnrate.dev/privacy).
- US cards and US merchants, for now.

> **Status:** early, and it works: the engine, CLI, optional Claude merchant lookup and MCP server. See [the benchmark](docs/benchmark.md) for how it compares to an existing card-picking MCP server.

## Try it

Needs Node 24 or later.

```sh
npm install -g earnrate
earnrate cards sapphire            # find your cards' ids
earnrate add chase-sapphire-preferred
earnrate add amex-gold
earnrate whole foods 80
```

Adding a card tells you anything else it needs to earn correctly, such as the categories you picked on Cash+, Amazon Prime for Prime Visa's 5%, or which rotating categories you've activated. `earnrate update` sets those. Using an AI assistant instead? [Add the MCP server](#use-it-from-an-ai-agent-mcp) and tell it which cards you have.

With the [example wallet](wallet.example.yaml), it prints:

```
Whole Foods Market · $80

Use Blue Cash Preferred: 6% back, about $4.80. High confidence.

  1. Blue Cash Preferred  6%  $4.80
     6% cash back from its "us-supermarkets" rule. ...
  2. Prime Visa           5%  $4.00
     5% cash back from its "whole-foods" rule. Online or in-store.
  3. Amex Gold            4%  $3.20
     4x Amex Membership Rewards from its "us-supermarkets" rule. ...
     Valued at 1¢ per point: 4% back.
  + 6 more cards (--all lists them)

Amex Gold beats Blue Cash Preferred here if Amex Membership Rewards (MR) points are worth 1.5¢ or more (you value them at 1¢).

Assumes Whole Foods Market codes as supermarkets (MCC 5411).
```

Options: `--online` or `--in-store`, `--valuation flat|points-heavy`, `--all`, `--json`, `--date`, `--country`. Run `earnrate --help` for details. To keep the wallet somewhere else, set `EARNRATE_WALLET` to its path.

### Your wallet

The wallet is a YAML file (`~/.earnrate/wallet.yaml`) listing your cards by ID, which is each card's file name in [`data/cards/`](data/cards). `earnrate add`, `update`, `remove` and `memberships` write it for you and keep your comments, or you can edit it by hand. Only the cards are required:

```yaml
valuations:
  UR: 1.5 # cents per point; leave out to use earnrate's defaults
memberships: [amazon-prime] # unlocks Prime Visa's 5%
cards:
  - id: chase-sapphire-preferred
  - id: chase-prime-visa
  - id: chase-freedom-flex
    activated: [q4-2026-grocery] # rotating 5% categories you've activated
  - id: usbank-cash-plus
    chosen: # categories you picked for the quarter
      period: 2026-Q4
      picks:
        five-percent: [tv-internet-streaming, movie-theaters]
        two-percent: [gas-ev-charging]
```

Rule IDs for `activated`, the choice slots for `chosen` and the membership IDs that unlock bonuses (such as `bofa-rewards-premier` for a BofA Rewards tier) are in each card's file. Currencies and their default values are in [`data/currencies.yaml`](data/currencies.yaml). Spending caps fill up as you record purchases from an AI agent or import a statement with `--apply`, and reset with each period.

### Merchants earnrate doesn't know

earnrate ships with a curated list of merchants. For anything else it falls back to each card's base rate and says so. Pass `--llm` (or set `EARNRATE_LLM=on`) to have Claude guess the category instead:

- It uses your own `ANTHROPIC_API_KEY` and sends only the merchant text you typed. Amounts, cards and wallet contents never leave your machine.
- Each answer is saved in `~/.earnrate/merchant-cache.json`, so a merchant is only looked up once.
- The answer is labeled as Claude's guess, shows its reasoning, and is never higher than medium confidence.
- Curated merchants never reach Claude.

### Welcome bonuses

When you're working toward a card's sign-up bonus, add it to that card in your wallet:

```yaml
- id: chase-sapphire-preferred
  bonus: { opened: 2026-10-01, spend: 5000, by: 2026-12-31, points: 75000 }
```

While the bonus is open, that card wins wherever it's accepted, and the answer says how much is left, the weekly pace to finish on time, what the bonus is worth at your point values, and what using it costs compared with your best earner. Spend counts up as you record purchases from an AI agent or import a statement with `--apply`; refunds count down. Once it's met or the deadline passes, the card goes back to the normal ranking. With two open bonuses, the one needing more spend per day comes first.

`spend`, `by` and the reward (`points`, or `dollars` for cash back) default to the card's published offer once earnrate has one; set them when your offer was different.

### Which new card?

```sh
earnrate offers --cash
```

Ranks the welcome offers on cards you don't have by first-year value: the bonus at your point values minus the first year's annual fee. `--points`, `--no-fee` and `--business` narrow it down. Each offer is the public one on the issuer's page, checked weekly like the earning rules, with the issuer's eligibility rules in its note. Offers can differ by person and by how you apply, and it covers only the cards earnrate knows. There are no affiliate or apply links.

### Import a statement

See what your purchases would have earned on earnrate's picks, using your cards' activity downloads:

```sh
earnrate import activity.csv --card amex-gold
earnrate import gold.csv:amex-gold sapphire.csv:chase-sapphire-preferred
```

It totals what each card earned against the best card in your wallet for each purchase, lists the merchants where another card would have earned the most, and flags merchants your issuer codes differently than earnrate assumes. Name several statements, each with its card, to get one report across them. It reads Amex and Chase activity CSVs. Download the CSV rather than a PDF statement: Chase's PDFs print the full card number in the payment coupon, and earnrate never handles card numbers.

- It's a dry run unless you pass `--apply`, which records cap usage for the current period in your wallet. Refunds lower it.
- Only the date, description, amount, category and (for Chase) transaction type columns are read. The statements themselves are never stored: `--apply` writes cap totals plus a hash of each recorded purchase to `~/.earnrate/imported.json`, so importing the same file twice never counts twice.
- For a merchant earnrate doesn't know, it uses the statement's category and marks the row, since another issuer may code it differently.
- `--valuation points-heavy` values points at transfer rates instead of your wallet's values, which can change which card wins.

## Supported cards

57 cards, each modeled from the issuer's own terms and checked weekly against them:

- **American Express:** Gold, Platinum, Blue Cash Preferred, Blue Cash Everyday, Blue Business Plus
- **Chase:** Sapphire Preferred, Sapphire Reserve, Freedom Unlimited, Freedom Flex, Ink Business Cash, Ink Business Preferred, Prime Visa
- **Chase airline and hotel:** United Gateway, Explorer, Quest, Club, Business, Club Business; Southwest Plus, Premier, Priority, Premier Business, Performance Business; Aeroplan; IHG One Rewards, Premier, Premier Select, Business
- **Citi:** Strata Elite, Strata Premier, Double Cash, Custom Cash, My Best Buy Visa, Costco Anywhere Visa (personal and business); AAdvantage MileUp, Platinum Select, Globe, Executive, Business
- **Capital One:** Venture X, Venture, Savor, Kohl's Card, Kohl's Rewards Visa
- **Wells Fargo:** Active Cash, Autograph
- **Bank of America:** Atmos Rewards Ascent, Summit, Business; Customized Cash Rewards
- **TD Bank:** Target Circle Card, Nordstrom card, Nordstrom Visa
- **Others:** U.S. Bank Cash+, Bilt Obsidian, SoFi Unlimited 2%

Store cards (Target, Kohl's, Nordstrom) only come up at their own stores. Airline and hotel cards count only what the card itself earns, not the points a program gives members however they pay, and their perks (bags, free nights, lounges) aren't counted.

Something the format can't express yet (Bilt's rent earning, Citi Nights) is listed as a `todo:` in that card's file rather than guessed.

Spotted a wrong rate, or want a card added? [Open an issue](https://github.com/cwasley/earnrate/issues) with a link to the issuer's own page.

## Use it from an AI agent (MCP)

`earnrate mcp` runs earnrate as a local MCP server over stdio, with ten tools:

- `best_card_for_purchase`: which card to use, with reasons
- `resolve_merchant`: how a merchant was identified
- `list_wallet`: your cards, caps left this period, chosen categories and welcome-bonus progress
- `compare_welcome_offers`: the best public sign-up offers on cards you don't have
- `record_purchase`: books a purchase against its cap and any open welcome bonus in your wallet file, keeping your comments
- `search_cards`, `add_card`, `update_card`, `remove_card` and `set_memberships`: set up the wallet in conversation

There's no wallet to write first: tell the assistant which cards you have, and it finds them, adds them, and asks about anything a card needs, like this quarter's Cash+ picks.

For a merchant earnrate doesn't know, the calling model can pass a `category` (e.g. `grocery.supermarket`). It's used only for unknown merchants and is labeled in the answer. The command line takes the same thing as `--category`.

To add it to Claude Code:

```sh
claude mcp add --scope user earnrate -- npx -y earnrate mcp
```

Other MCP clients take the same command in their config:

```json
{
  "mcpServers": {
    "earnrate": { "command": "npx", "args": ["-y", "earnrate", "mcp"] }
  }
}
```

It reads the same wallet as the command line (`~/.earnrate/wallet.yaml`, or `EARNRATE_WALLET` set in the server's `env`).

## How it works

```
merchant text
  → resolve    category, channel, and the assumption behind them
  → evaluate   every rule on every card: network, dates, caps, picks, activations
  → value      your cents per point, with pooling
  → rank       winner, runner-ups, flip points, warnings, confidence
```

- **Card terms are data, not code.** Each card is a YAML file of rules (category, rate, cap, channel, dates, activation, required membership), validated with Zod. Every rule carries a short quote from the issuer's own page, and a test fails if one is missing. The engine has no card-specific branches.
- **Merchants resolve to a category plus the assumption behind it.** "Whole Foods codes as a supermarket (MCC 5411)" is stated in the answer, and venues that can code more than one way (a restaurant inside a stadium or hotel) come back at medium confidence with the alternative spelled out. Unknown merchants fall back to base rates, or to an opt-in, cached and labeled Claude guess.
- **The engine is pure and deterministic.** Given a purchase, a date and a wallet, it checks every rule against network acceptance, the date window, caps already used (split when a purchase straddles one), quarterly picks and activations, then values points at your cents-per-point, including pooling (Freedom Unlimited points are worth Sapphire points when you hold both). Ties, the valuation at which the runner-up would win, and stale data all show up in the answer.
- **Wallet edits keep your file intact.** Recording a purchase rewrites only the numbers that changed, so comments and formatting in your YAML survive.
- **Drift detection.** A weekly GitHub Action opens each issuer page in a headless browser, checks every quote is still there, and opens an issue when terms move. It stores only hashes of issuer text.
- **Tested end to end.** Golden cases written from issuer terms, CLI snapshot tests, an MCP round trip over real stdio, an install test that packs and installs the npm package, and a check that no committed file contains a card number. CI runs all of it on every push.

The code is TypeScript run directly by Node 24 (`src/`), with the engine in `src/engine/`, merchant resolution in `src/merchants/`, and the CLI and MCP server as thin layers over them.

## Keeping card data current

Every rule in `data/cards/` carries a short quote from the issuer's own page. In a clone of this repo, `yarn check-sources` opens each issuer page in a headless browser and reports:

- rules whose quote is no longer on the page, which usually means the rule changed
- earning lines that appeared or disappeared since the last baseline, such as a new perk

A GitHub Action runs it every Monday and opens a "Card source changes" issue when something moved. After updating a card file, run `yarn check-sources --update` to record the new baseline. Some issuers block headless browsers on shared servers; those pages are listed as "couldn't check", and running the command locally covers them. The first run needs `yarn playwright install chromium`.

## Working on earnrate

```sh
git clone https://github.com/cwasley/earnrate.git && cd earnrate
yarn install
yarn earnrate whole foods 80   # runs src/ directly, no build
yarn validate                  # typecheck, lint, format check and tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Licensing

- **Code** (everything outside `data/`) is [MIT](LICENSE).
- **Data** (card rules, merchants, categories and currencies under `data/`) is [CC BY-NC 4.0](data/LICENSE). It's free for personal and non-commercial use, with attribution.
- **Commercial use of the data needs a license.** That includes serving it through your own API or MCP server, or using it in a paid product. Contact licensing@earnrate.dev.

Not legal advice; this is a good-faith structure.

earnrate isn't financial advice. Issuers change their terms, and every answer names the rule it used, so check the card's issuer page (linked in its file) before a big purchase.
