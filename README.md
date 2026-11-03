# earnrate

[![CI](https://github.com/cwasley/earnrate/actions/workflows/ci.yml/badge.svg)](https://github.com/cwasley/earnrate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/earnrate)](https://www.npmjs.com/package/earnrate)
[![Code: MIT](https://img.shields.io/badge/code-MIT-blue)](LICENSE)
[![Data: CC BY-NC 4.0](https://img.shields.io/badge/data-CC%20BY--NC%204.0-lightgrey)](data/LICENSE)

I wanted a ghost card: one card that always charges the best of my cards. The card networks won't allow one, so I built the next best thing.

**earnrate is the best-card decision layer for people and AI agents.** Give it a merchant, and it tells you which credit card earns the most there, from your own cards or from every card it knows, and why. Save your cards and it tracks your caps and chosen categories. It's valuation-aware and transparent about its assumptions. It never sees a card number.

- Runs on your machine, in your browser at [earnrate.dev](https://earnrate.dev) (which you can add to your phone's Home Screen and use offline), or in Claude as a connector at `https://mcp.earnrate.dev`, with nothing to install. No account and no affiliate links; the hosted server counts requests by tool name, nothing about what you ask. See the [privacy page](https://earnrate.dev/privacy).
- U.S. cards and U.S. merchants, for now.

> **Status:** early, and it works: the engine, CLI, optional Claude merchant lookup, MCP server and the hosted Claude connector. See [the benchmark](docs/benchmark.md) (run 2026-11-03) for how it compares to an existing card-picking MCP server.

## Try it

Needs Node 22 or later.

```sh
npm install -g earnrate
earnrate restaurants               # the best cards earnrate knows, no setup
earnrate trader joes --cards amex-gold,chase-prime-visa   # just these cards
earnrate whole foods 80            # add an amount to see the dollars back
```

You never have to enter your cards: with none, every answer covers every card earnrate knows. To have earnrate remember yours, track caps and welcome bonuses, and give a cheat sheet for your own wallet, save them:

```sh
earnrate cards sapphire            # find your cards' IDs
earnrate add chase-sapphire-preferred
earnrate add amex-gold
earnrate whole foods 80
```

Adding a card tells you anything else it needs to earn correctly, such as the categories you picked on Cash+, Amazon Prime for Prime Visa's 5%, or which rotating categories you've activated. `earnrate update` and `earnrate memberships` set those. Memberships and point values (`earnrate values`) can be saved without any cards, and every answer uses them. Using an AI assistant instead? [Add earnrate to it](#use-it-in-an-ai-assistant-mcp) and ask; name your cards or save them there.

With the [example wallet](wallet.example.yaml), it prints:

```
Whole Foods Market · $80

Use Blue Cash Preferred: 6% back, about $4.80. High confidence.

  1. Blue Cash Preferred  6%  $4.80
     6% cash back on supermarkets. ...
  2. Prime Visa           5%  $4.00
     5% cash back on Whole Foods Market, with Amazon Prime. ...
  3. Amex Gold            4%  $3.20
     4x Amex Membership Rewards on supermarkets. ...
     Valued at 1¢ per point: 4% back.
  + 6 more cards (--all lists them)

Amex Gold beats Blue Cash Preferred here if Amex Membership Rewards (MR) points are worth more than 1.5¢ (you value them at 1¢).

Assumes Whole Foods Market codes as supermarkets (MCC 5411).
Values points at: Amex Membership Rewards (MR) at 1¢, SoFi Member Rewards at 1¢, Chase Ultimate Rewards (UR) at 1¢.
```

Options: `--online` or `--in-store`, `--valuation flat|points-heavy`, `--all`, `--json`, `--date`, `--country`. Run `earnrate --help` for details. To keep the wallet somewhere else, set `EARNRATE_WALLET` to its path.

`earnrate cheatsheet` prints the card to use for each everyday kind of purchase this quarter (groceries, dining, gas, Amazon, Costco, travel, streaming, drugstores, everything else), with your caps, picks and activations as they are now. `--cards` uses cards you name instead, and `--every-card` picks from every card to show what's worth getting. It's also in the My wallet tab on [earnrate.dev](https://earnrate.dev).

`earnrate todo` lists what your saved cards need this quarter, soonest first: bonuses to activate (with Chase's deadline), categories to pick, caps running low and welcome bonuses to finish. `--ics earnrate.ics` also writes the dates as a calendar file with reminders. My wallet on earnrate.dev shows the same list as "To do now", with an "Add the dates to your calendar" button.

`earnrate missed` lists the stores earnrate didn't recognize when you asked here, most asked about first. They're kept only on your computer; [open an issue](https://github.com/cwasley/earnrate/issues) to suggest one for the data.

### Your wallet

The wallet is a YAML file (`~/.earnrate/wallet.yaml`) listing your cards by ID, which is each card's file name in [`data/cards/`](data/cards). `earnrate add`, `update`, `remove`, `memberships` and `values` write it for you and keep your comments, or you can edit it by hand. Only the cards are required:

```yaml
version: 1 # the file's format; earnrate writes it
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

Rule IDs for `activated` and the choice slots for `chosen` are in each card's file; membership IDs (such as `bofa-rewards-premier` for a BofA Rewards tier) are in [`data/memberships.yaml`](data/memberships.yaml), and `earnrate memberships` lists them. `earnrate values UR=1.5` saves what a program's points are worth to you; every answer uses it. Add `costco` if you have a Costco membership: Costco Anywhere needs one, and spending answers count its $65 a year unless you have it, hold the card or spend at Costco. Currencies and their default values are in [`data/currencies.yaml`](data/currencies.yaml). Spending caps fill up as you record purchases from an AI assistant or import a statement with `--apply`, and reset with each period.

### Merchants earnrate doesn't know

earnrate ships with a curated list of merchants. For anything else it falls back to each card's base rate and says so. Pass `--llm` (or set `EARNRATE_LLM=on`) to have Claude guess the category instead:

- It uses your own `ANTHROPIC_API_KEY` and sends only the merchant text you typed. Amounts, cards and wallet contents never leave your machine.
- Each answer is saved in `~/.earnrate/merchant-cache.json`, so a merchant is only looked up once.
- The answer is labeled as Claude's guess, shows its reasoning, and is never higher than medium confidence.
- Curated merchants never reach Claude.

### Welcome bonuses

When you're working toward a card's sign-up bonus, tell earnrate when the account opened:

```sh
earnrate update chase-sapphire-preferred --bonus-opened 2026-10-01 --bonus-spent 400
```

Or tell your AI assistant ("I opened my Sapphire Preferred on October 1"), or check "I'm working on this card's welcome bonus" in My wallet on earnrate.dev. `--no-bonus` stops tracking it. In the wallet file it looks like this:

```yaml
- id: chase-sapphire-preferred
  bonus: { opened: 2026-10-01, spend: 5000, by: 2026-12-31, points: 75000 }
```

While the bonus is open and you're behind an even pace to the deadline, that card wins wherever it's accepted, and the answer says how much is left, the weekly pace to finish on time, what the bonus is worth at your point values, and what using it costs compared with your best earner. On pace, it's the pick only where it earns as much as your best card, and it's mentioned where it comes within a point; otherwise your best card wins. Spend counts up as you record purchases from an AI assistant or import a statement with `--apply`; refunds count down. Once it's met or the deadline passes, the card goes back to the normal ranking. With two open bonuses, one behind pace comes first, then the one needing more spend per day.

`spend`, `by` and the reward (`points`, or `dollars` for cash back) default to the card's published offer once earnrate has one; set them when your offer was different.

### Paying abroad

Many cards charge a foreign transaction fee, often 3%, on every purchase outside the U.S., which can wipe out what they earn. Give the country with `--country` (two letters, like `FR`) and earnrate ranks each card after its fee, says what a card with a fee nets, and points out cards that earn extra abroad:

```sh
earnrate restaurants --country GB
earnrate best groceries --country JP   # every card earnrate knows
```

Each card's fee comes from its issuer's rates-and-fees table, and `earnrate cards` shows it. The cheat sheet has an "Abroad" line, on earnrate.dev a "Paying outside the U.S." box does the same, and in Claude, mention where you're paying.

### Spend bonuses

Some cards pay a bonus once a year after you spend a set amount on them, like the IHG One Rewards cards' "10,000 bonus points after you spend $15,000 on purchases each calendar year". `earnrate cards ihg` lists each card's, with what it pays besides points (status, Elite Night Credits, free nights). Only the points are valued.

Every purchase on the card counts. Once earnrate knows how much you've spent on the card this year, an answer adds the bonus points to the purchase that reaches the total and says so, and `earnrate todo` lists a bonus once you're at least 75% of the way there. Without that tracking, a spend bonus never changes an answer: earnrate doesn't guess at spending it wasn't told about. Spending counts up as you record purchases from an AI assistant or import a statement with `--apply`. You can also set it in the card's settings on earnrate.dev, or in the wallet file:

```yaml
- id: chase-ihg-one-rewards-premier
  milestone_usage:
    spend-15k: { period: '2026', spent: 11200 } # spend-40k counts the same purchases
```

`earnrate simulate` adds a bonus's points to a card's yearly rewards when the year's spending on it reaches the total.

### Which new card?

These compare every card earnrate knows that's open to new applicants:

```sh
earnrate best groceries                               # every card, ranked for one purchase
earnrate simulate groceries=600 dining=300 other=1000 # best cards and pairs for a year
earnrate simulate groceries=600 other=1000 --wallet   # what a new card would add to yours
```

`best` ranks every card earnrate knows for a merchant or a category, each set up at its best (the right category pick, activated, cap unused), with its annual fee and what earning the rate takes. Rates that need a membership like Amazon Prime are listed separately unless you've saved it (`earnrate memberships amazon-prime`) or pass `--member amazon-prime`, and a card that needs a membership to get (Costco Anywhere) says so. `simulate` spends your monthly amounts for a year, applying caps as they fill and reset, and ranks single cards and two-card pairs by rewards minus annual fees, counting the cost of a membership a card needs (Costco's, for Costco Anywhere) unless you have it or spend at Costco. Both take `--no-fee`, `--cash` or `--points`, `--issuer`, `--business` and `--valuation`. Welcome bonuses are left out of both; for those:

```sh
earnrate offers --cash
```

Ranks the welcome offers on cards you don't have by first-year value: the bonus at your point values minus the first year's annual fee (and a membership the card needs, if you don't have it). An offer the issuer rules out because of a card in your wallet (or one you name with `--cards`) is marked "likely not eligible" and listed last. `--points`, `--no-fee` and `--business` narrow it down. Each offer is the public one on the issuer's page, checked weekly like the earning rules, with the issuer's eligibility rules in its note. Offers can differ by person and by how you apply, and it covers only the cards earnrate knows. There are no affiliate or apply links.

### Import a statement

See what your purchases would have earned on earnrate's picks, using your cards' activity downloads:

```sh
earnrate import activity.csv --card amex-gold
earnrate import gold.csv:amex-gold sapphire.csv:chase-sapphire-preferred
```

It totals what each card earned against the best card in your wallet for each purchase, lists the merchants where another card would have earned the most, and flags merchants your issuer codes differently than earnrate assumes. Name several statements, each with its card, to get one report across them. It reads Amex and Chase activity CSVs. Download the CSV rather than a PDF statement: Chase's PDFs print the full card number in the payment coupon, and earnrate never handles card numbers.

- It's a dry run unless you pass `--apply`, which records cap usage for the current period and spending toward an open welcome bonus in your wallet. Refunds lower both.
- Only the date, description, amount, category and (for Chase) transaction type columns are read. The statements themselves are never stored: `--apply` writes cap, welcome-bonus and spend-bonus totals to your wallet, and a hash of each recorded purchase to `imported.json` beside it, so importing the same file twice never counts twice.
- For a merchant earnrate doesn't know, it uses the statement's category and marks the row, since another issuer may code it differently.
- `--valuation points-heavy` values Amex and Chase points at transfer rates instead of your wallet's values, which can change which card wins.

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

## Use it in an AI assistant (MCP)

**In Claude, nothing to install:** add a custom connector (Settings → Connectors) with the address `https://mcp.earnrate.dev`. It works in Claude on the web, desktop and phone. When you add it, an earnrate page opens once, where you start an anonymous wallet: no email, just a recovery code you keep. Then ask anything: with no cards saved it answers from every card. Name your cards for answers about yours, and save them to track caps and welcome bonuses across your Claude apps. From the chat you can export the wallet for the command line, switch to another one, or delete it. In Claude Code:

```sh
claude mcp add --transport http earnrate https://mcp.earnrate.dev
```

Or install it as a Claude Code plugin, which connects Claude Code and Cowork to the same server: `/plugin marketplace add cwasley/earnrate`, then `/plugin install earnrate@earnrate`.

Use the connector (or plugin) or the local extension, not both: each keeps its own wallet, and with both connected Claude may answer from either. Each one says which wallet it used.

**Or run it on your computer:** `earnrate mcp` runs earnrate as a local MCP server over stdio, with 14 tools (the connector has the same ones, plus `export_wallet`, `import_wallet`, `delete_wallet` and `switch_wallet` for its saved wallets):

- `best_card_for_purchase`: which card to use, with reasons
- `best_cards_for` and `simulate_spending`: compare every card earnrate knows, for one purchase or a year of spending, with no wallet needed
- `resolve_merchant`: how a merchant was identified
- `list_wallet`: a to-do list for your cards right now, then your cards, caps left this period, chosen categories, welcome-bonus and spend-bonus progress and the point values you've set
- `cheat_sheet`: the card to use for each everyday kind of purchase this quarter
- `compare_welcome_offers`: the best public sign-up offers on cards you don't have
- `record_purchase`: books a purchase against its cap, any open welcome bonus and the card's yearly spend bonuses in your wallet file, keeping your comments
- `search_cards`, `add_card`, `update_card`, `remove_card`, `set_memberships` and `set_point_values`: set up the wallet in conversation, including what your points are worth (memberships and point values need no cards)

Saving cards is optional: name them in the conversation for one answer, or ask the assistant to save them, and it finds them, adds them, and asks about anything a card needs, like this quarter's Cash+ picks.

For a merchant earnrate doesn't know, the calling model can pass a `category` (e.g. `grocery.supermarket`). It's used only for unknown merchants and is labeled in the answer. The command line takes the same thing as `--category`.

**Claude Desktop, running locally:** download [earnrate.mcpb](https://github.com/cwasley/earnrate/releases/latest/download/earnrate.mcpb) and open it; Claude Desktop installs it (Settings → Extensions). No terminal or Node install needed. Its one setting is where your wallet file lives, by default `~/.earnrate/wallet.yaml`, the same file the command line uses.

To run it locally in Claude Code:

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
- **The engine is pure and deterministic.** Given a purchase, a date and a set of cards (yours, or every card), it checks every rule against network acceptance, the date window, caps already used (split when a purchase straddles one), quarterly picks and activations, then values points at your cents-per-point, including pooling (Freedom Unlimited points are worth Sapphire points when you hold both). Ties, the valuation at which the runner-up would win, stale data, and a rotating card whose new quarter isn't in the data yet all show up in the answer.
- **Wallet edits keep your file intact.** Adding or changing a card, or recording a purchase, splices in only the lines that changed and checks the result before saving, so comments and formatting in your YAML survive.
- **Drift detection.** A weekly GitHub Action opens each issuer page in a headless browser, checks every quote is still there, and opens an issue when terms move. It stores only hashes of issuer text. An hourly check confirms earnrate.dev and the hosted server are up, and a daily one checks them end to end (a browser load of the site, sign in, ask, save a card, delete the wallet, and the server's error counts), opening an issue if anything fails.
- **Tested end to end.** Golden cases written from issuer terms, CLI snapshot tests, an MCP round trip over real stdio, an install test that packs and installs the npm package, and a check that no committed file contains a card number. CI runs all of it on every push.

The code is TypeScript run directly by Node 24 (`src/`), with the engine in `src/engine/`, merchant resolution in `src/merchants/`, and the CLI and MCP server as thin layers over them. `site/` is earnrate.dev, which runs the same engine in the browser, and `remote/` is the hosted server at mcp.earnrate.dev.

## Keeping card data current

Every rule in `data/cards/` carries a short quote from the issuer's own page. In a clone of this repo, `yarn check-sources` opens each issuer page in a headless browser and reports:

- rules whose quote is no longer on the page, which usually means the rule changed
- earning lines that appeared or disappeared since the last baseline, such as a new perk

A GitHub Action runs it every Monday and opens a "Card source changes" issue when something moved. After updating a card file, run `yarn check-sources --update` to record the new baseline. Some issuers block headless browsers on shared servers; those pages are listed as "couldn't check", and running the command locally covers them. The first run needs `yarn playwright install chromium`.

Rotating categories (Freedom Flex) are added each quarter once the issuer posts them. Until then, answers say that quarter's categories are missing rather than guessing.

## Privacy Policy

earnrate needs no account. The local version has no telemetry; the hosted server counts requests and errors by method, tool name or page only, never what was asked. The full policy is at [earnrate.dev/privacy](https://earnrate.dev/privacy); in short:

- **The Claude connector:** earnrate's server at mcp.earnrate.dev receives each question Claude asks it (a store or kind of purchase, and any amount, country, spending or cards you gave) and answers without keeping it; request logging is off. It counts requests and errors by method, tool name or page only. Connecting it starts an anonymous wallet (a recovery code, no email). It holds only what you save: card IDs and the details you gave, memberships and point values, never card numbers, and is encrypted with its own key that only your recovery code or your connected apps can unlock. Delete it any time; it's deleted automatically after 13 months unused, or a week if it's never used.
- **What it stores locally:** your wallet, a YAML file on your computer (`~/.earnrate/wallet.yaml` unless you set `EARNRATE_WALLET`). It lists cards by product ID, like `amex-gold`, plus your category picks, activations and how much you've spent toward caps. earnrate never asks for or stores card numbers, expiry dates, security codes or bank logins. When you ask about a store earnrate doesn't recognize, its name goes in `~/.earnrate/missed-merchants.json` (`earnrate missed` lists them; `EARNRATE_MISSED_MERCHANTS=off` keeps no list).
- **What the local version sends:** nothing, by default. The optional merchant lookup (off unless you turn it on with your own Anthropic API key) sends only the name of a store earnrate doesn't recognize to Anthropic's API, and saves the answer in `~/.earnrate/merchant-cache.json`.
- **AI assistants:** when you use earnrate through Claude or another assistant, that assistant's provider sees the conversation, including earnrate's answers, under its own privacy policy.
- **earnrate.dev:** everything you enter on the site stays in your browser. The site counts visits with Cloudflare Web Analytics, without cookies.
- **Retention:** locally, your data lives only in files you control, for as long as you keep them. Delete the wallet file, or clear the site's data in your browser, to remove it. A saved wallet on mcp.earnrate.dev lasts until you delete it or leave it unused for 13 months (a week, if it's never used); the record that an app is connected goes after 90 days unused.
- **Terms:** [earnrate.dev/terms](https://earnrate.dev/terms).
- **Contact:** [hello@earnrate.dev](mailto:hello@earnrate.dev).

## Working on earnrate

Development needs Node 24 or later.

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
