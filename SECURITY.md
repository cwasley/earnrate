# Security

Please report a vulnerability privately, by email to [hello@earnrate.dev](mailto:hello@earnrate.dev), not in a public issue. Include what you found, how to reproduce it, and what it affects. I'll reply as soon as I can and keep you posted until it's fixed.

In scope:

- The hosted server at mcp.earnrate.dev: sign-in, saved wallets and their encryption, and anything that lets one person reach another's wallet.
- The `earnrate` npm package: the CLI and the local MCP server, including how they edit your wallet file.
- earnrate.dev, which runs in your browser.

earnrate never handles card numbers, bank logins or payments, so reports about those don't apply. The [privacy page](https://earnrate.dev/privacy) describes what each part keeps.
