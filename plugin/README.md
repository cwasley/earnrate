# earnrate for Claude

Ask which credit card to use before you pay. earnrate checks each card against the issuer's own terms and explains its answer. With nothing set up it compares every card it knows; name your cards and it picks the best of yours; save them and it remembers the caps you've already spent and the bonus categories you've picked.

earnrate lists cards by product, like `amex-gold`, and never asks for card numbers, expiry dates, security codes or bank logins. There are no affiliate links: rankings depend only on the issuers' terms and your own cards.

## Install

In Claude Code:

```
/plugin marketplace add cwasley/earnrate
/plugin install earnrate@earnrate
```

## Try it

- "What's the best card for groceries if I don't want an annual fee?"
- "I have an Amex Gold, a Chase Sapphire Preferred and a Prime Visa. Which should I use for $80 at Whole Foods?"
- "Save my cards in earnrate."
- "Give me my cheat sheet for this quarter."
- "I spend about $600 a month on groceries, $300 on dining and $1,000 on everything else. Which card would add the most to my wallet?"

Claude asks about anything a card needs, such as this quarter's U.S. Bank Cash+ picks, Amazon Prime for Prime Visa's 5%, or Chase Freedom Flex activations.

## What the plugin runs

Nothing on your computer. It connects Claude to earnrate's hosted MCP server at `https://mcp.earnrate.dev` over HTTPS. The server's code is in [github.com/cwasley/earnrate](https://github.com/cwasley/earnrate) (`remote/`). The first time Claude Code uses it, earnrate's sign-in page opens in your browser: start an anonymous wallet (no email; you keep a recovery code) or reconnect one. It offers 18 tools:

- `best_card_for_purchase`, `best_cards_for`, `simulate_spending`, `compare_welcome_offers`, `cheat_sheet`, `resolve_merchant`, `search_cards`: answers, from your saved cards, the cards you name, or every card when there are none.
- `list_wallet`, `add_card`, `update_card`, `remove_card`, `set_memberships`, `set_point_values`, `record_purchase`, `export_wallet`, `import_wallet`, `delete_wallet`, `switch_wallet`: your saved wallet. It holds cards only if you save some. `remove_card` deletes only the card you name; `delete_wallet` deletes the whole wallet; `switch_wallet` disconnects so you can connect another one.

## What it reads, writes, sends and fetches

- **Reads and writes** nothing on your computer.
- **Sends** each question Claude asks earnrate to `mcp.earnrate.dev`: the store or kind of purchase, and anything else you gave for it, like an amount, your spending or the cards you named. The server answers without keeping the question; request logging is off.
- **Stores** an anonymous wallet, made when you connect. It holds your cards by product ID, if you save any, and what you've told earnrate about them (checkout names, picks, activations, memberships, anniversaries, point values, cap, welcome-bonus and yearly spend totals), encrypted with a key only your recovery code or your connected apps can unlock. It's deleted when you ask, after 13 months unused (any question counts as use), or a week after it's started if it's never used.
- **Fetches** nothing else.

## Privacy Policy

No email, name or password: the wallet is anonymous. earnrate counts requests by method and tool name only, never what was asked. Claude's provider sees your conversation, including earnrate's answers, under its own privacy policy. Full policy: [earnrate.dev/privacy](https://earnrate.dev/privacy). Terms: [earnrate.dev/terms](https://earnrate.dev/terms). Contact: [hello@earnrate.dev](mailto:hello@earnrate.dev).

## Prefer it on your computer?

earnrate also runs locally, with your wallet in a file you control (`~/.earnrate/wallet.yaml`): `npm install -g earnrate`, or [earnrate.mcpb](https://github.com/cwasley/earnrate/releases/latest/download/earnrate.mcpb) for Claude Desktop. Export a saved wallet with `export_wallet` and the local version reads it. See the [README](https://github.com/cwasley/earnrate#readme).

## Where it works

Claude Code and Cowork. In claude.ai and the Claude apps, add `https://mcp.earnrate.dev` as a custom connector instead. There's also a browser version at [earnrate.dev](https://earnrate.dev).

## Support

Report a wrong rate or a bug at [github.com/cwasley/earnrate/issues](https://github.com/cwasley/earnrate/issues), or email [hello@earnrate.dev](mailto:hello@earnrate.dev).
