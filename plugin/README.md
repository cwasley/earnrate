# earnrate for Claude

Ask which of your credit cards to use before you pay. earnrate checks every card in your wallet against each issuer's own terms, remembers the caps you've already spent and the bonus categories you've picked, and explains its answer. It can also compare every card it knows for a store or a year of spending, before you've added any of yours.

Your cards stay on your computer. earnrate lists them by product, like `amex-gold`, and never asks for card numbers, expiry dates, security codes or bank logins. There are no affiliate links: rankings depend only on the issuers' terms and your own cards.

## Install

In Claude Code:

```
/plugin install earnrate --marketplace cwasley/earnrate
```

## Try it

- "I have an Amex Gold, a Chase Sapphire Preferred and a Prime Visa. Add them to earnrate."
- "Which card should I use for $80 at Whole Foods?"
- "Give me my cheat sheet for this quarter."
- "What's the best card for groceries if I don't want an annual fee?"
- "I spend about $600 a month on groceries, $300 on dining and $1,000 on everything else. Which card would add the most to my wallet?"

Claude asks about anything a card needs, such as this quarter's U.S. Bank Cash+ picks, Amazon Prime for Prime Visa's 5%, or Chase Freedom Flex activations.

## What the plugin runs

One local MCP server: `node ${CLAUDE_PLUGIN_ROOT}/node_modules/earnrate/dist/mcp/bin.js`, from the [earnrate package on npm](https://www.npmjs.com/package/earnrate) (source: [github.com/cwasley/earnrate](https://github.com/cwasley/earnrate)). Claude Code installs it when you install the plugin, from the included `package-lock.json`, which pins earnrate and each of its dependencies to an exact version with an integrity hash. No install scripts run. It needs Node.js 22 or later. The server talks to Claude over stdio and offers 13 tools:

- `best_card_for_purchase`, `resolve_merchant`, `list_wallet`, `cheat_sheet`: answers from your wallet.
- `best_cards_for`, `simulate_spending`, `compare_welcome_offers`: compare every card earnrate knows.
- `record_purchase`, `search_cards`, `add_card`, `update_card`, `remove_card`, `set_memberships`: change your wallet. Only `remove_card` deletes anything, and only the card you name.

## What it reads, writes, sends and fetches

- **Reads and writes** one file: your wallet, `~/.earnrate/wallet.yaml` (or the path in `EARNRATE_WALLET`). Edits keep your comments and formatting. The command line version uses the same file.
- **Sends** nothing. The card data ships inside the package; the server makes no network requests. An optional merchant lookup through Anthropic's API exists in the command line version, but it's off unless you set `EARNRATE_LLM=on` and your own `ANTHROPIC_API_KEY`, and it sends only the name of a store earnrate doesn't recognize.
- **Fetches** the packages in `package-lock.json` from the npm registry once, when Claude Code installs the plugin.

## Privacy Policy

earnrate collects nothing: no account, no server, no telemetry. Your wallet stays in a file you control for as long as you keep it; delete the file to remove it. Claude's provider sees your conversation, including earnrate's answers, under its own privacy policy. Full policy: [earnrate.dev/privacy](https://earnrate.dev/privacy). Contact: [hello@earnrate.dev](mailto:hello@earnrate.dev).

## Where it works

Claude Code, and Cowork sessions that run on your computer. In Claude Desktop chat, install the one-click extension instead: [earnrate.mcpb](https://github.com/cwasley/earnrate/releases/latest/download/earnrate.mcpb). There's also a browser version at [earnrate.dev](https://earnrate.dev).

## Support

Report a wrong rate or a bug at [github.com/cwasley/earnrate/issues](https://github.com/cwasley/earnrate/issues), or email [hello@earnrate.dev](mailto:hello@earnrate.dev).
