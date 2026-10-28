# Benchmark: earnrate vs RightCard

Golden cases from `tests/golden/`, run through RightCard's `best_card` tool and earnrate's `recommend()`.

## Setup (2026-10-24)

- **RightCard:** `rightcard-mcp@0.1.14`, local stdio, with its live public catalog. Re-run on 2026-10-24 after M2 with the same calls, and it gave identical answers.
- **earnrate:** engine at M2 plus the web-address fix below, data `2026.10.24.1`.
- **Wallet:** the same nine cards in both. RightCard ids: `amex_gold`, `amex_blue_cash_preferred`, `amex_platinum`, `chase_sapphire_preferred`, `chase_freedom_unlimited`, `amazon_prime_visa`, `usbank_cash_plus`, `citi_my_best_buy_visa_card`, `sofi_credit_card`. All nine are in its catalog and marked `verified`. The earnrate wallet is `tests/golden/fixtures.ts`: Prime membership, Cash+ Q4 picks of 5% on TV/internet/streaming and movie theaters and 2% on gas/EV, and SoFi redeemed into a SoFi account.
- **Valuation:** RightCard has two fixed modes. `cash` caps points at 1¢, which matches our `flat`. `points` uses a fixed 1.8¢ for MR and UR, close to our `points-heavy` at 1.7¢. RightCard doesn't let you pass your own values.
- **Inputs:** both got the same merchant strings, with no channel and no amount, except where a case needs state. RightCard has **no** input for amount, channel, cap usage or memberships, and returns a single winner. earnrate returns a ranked list.

## Results

Columns are cash / points for RightCard and flat / points-heavy for earnrate.

| #   | Case                                | RightCard                                                       | earnrate                                                            | Verdict                                                                                                                                                                                                                                                           |
| --- | ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Whole Foods                         | BCP 6% / Gold 7.2%                                              | BCP 6% / Gold 6.8%                                                  | Both ✅. earnrate also states the "codes as a supermarket (MCC 5411)" assumption and says Gold beats BCP once MR is worth 1.5¢.                                                                                                                                   |
| 2   | Whole Foods, BCP cap used up        | Can't be expressed                                              | Prime Visa 5% / Gold 6.8%                                           | RightCard ❌, earnrate ✅. earnrate warns that BCP's $6,000 cap is used up for 2026.                                                                                                                                                                              |
| 3   | Amazon.com without Prime            | Prime Visa 5% / 5%                                              | Prime Visa 3% / 3%                                                  | RightCard ⚠️: right card, wrong rate. Chase's terms give 3% without Prime, not 5%. earnrate ✅ (corrected in data 2026.10.24.6; it used to say 1%). With Prime, both pick Prime Visa at 5%.                                                                       |
| 4   | Costco, in-store                    | SoFi 2% / Freedom Unlimited 2.7%                                | Freedom Unlimited 1.5% / 2.55%                                      | RightCard ❌ in cash mode: it recommends SoFi, a Mastercard, at a Visa-only register. earnrate ✅: it assumes in-store, removes the three Amex cards and SoFi with reasons, and only ranks Visa cards. "Costco.com" is taken as online, where SoFi's 2% is right. |
| 5   | Walmart / Target                    | SoFi 2% / Freedom Unlimited 2.7%                                | SoFi 2% / Freedom Unlimited 2.55%                                   | Both ✅. Neither applies Amex grocery rates.                                                                                                                                                                                                                      |
| 6   | Restaurant (Chipotle)               | Gold 4% / Gold 7.2%                                             | Gold 4% / Gold 6.8%                                                 | Both ✅. Only earnrate gives the flip point: Freedom Unlimited wins if UR is worth 1.34¢ or more (flat), or if MR drops below 1.27¢ (points-heavy).                                                                                                               |
| 7   | Gas (Shell)                         | BCP 3% / BCP 3%                                                 | Sapphire Preferred 3% / 5.1%                                        | RightCard ❌ in points mode. Its Sapphire Preferred data has gas at 1x, while Chase's terms give 3x. earnrate ✅: a three-way tie at 3% in flat mode goes to Sapphire Preferred, with a note naming BCP and the Best Buy card. Cash+ earns 2% (your gas pick).    |
| 8   | Netflix                             | BCP 6% / BCP 6%                                                 | BCP 6% / BCP 6%                                                     | Both ✅. earnrate ranks Cash+ second at 5% from your streaming pick. RightCard doesn't model Cash+ picks at all.                                                                                                                                                  |
| 9   | Comcast / Xfinity                   | SoFi 2% / Freedom Unlimited 2.7%                                | Cash+ 5% / 5%                                                       | RightCard ❌: "Comcast" isn't in its directory and "Xfinity" has no category. earnrate ✅ for both names, from your TV/internet pick.                                                                                                                             |
| 10  | Unknown local business              | SoFi 2% / Freedom Unlimited 2.7%                                | SoFi 2% / Freedom Unlimited 2.55%                                   | RightCard ⚠️ (no warning), earnrate ✅: same fallback, marked low confidence with a "couldn't identify" warning.                                                                                                                                                  |
| 11  | Stadium / hotel restaurant          | Stadium: SoFi 2%. "Bellagio buffet": CSP 2% (resolved to hotel) | Stadium: SoFi 2% / FU 2.55%. Bellagio: Sapphire Preferred 2% / 3.4% | RightCard ❌, earnrate ✅. Both earnrate answers are medium confidence and warn about the other ways it may code: "If it codes as restaurants, Freedom Unlimited wins (3%)." Gold's terms exclude restaurants inside venues and hotels.                           |
| 12  | Airline site (Delta.com, United)    | Platinum 5% / 9%                                                | Platinum 5% / 8.5%                                                  | Both ✅. RightCard adds a note about the Amex Travel portal.                                                                                                                                                                                                      |
| 13  | Purchase that straddles a cap       | Can't be expressed                                              | Prime Visa 5% / Gold 6.8%                                           | RightCard ❌, earnrate ✅. With $5,950 used, a $100 Whole Foods purchase gets BCP at a blended 3.5% and a warning that only $50 of the cap is left.                                                                                                               |
| 14  | Stale card data                     | N/A                                                             | Warns with the date                                                 | RightCard ⚠️: it has a per-card `verify_status` but no date. earnrate ✅: "Card data last verified 2026-01-01 (296 days ago)", and confidence drops to medium when that card wins.                                                                                |
| x   | Best Buy (holding My Best Buy Visa) | SoFi 2% / Freedom Unlimited 2.7%                                | My Best Buy Visa 5% / 5%                                            | RightCard ❌: its data has no rate at Best Buy itself. Best Buy's own rewards page gives 2.5 points per dollar at 2¢, which is 5%.                                                                                                                                |

**RightCard: 5 right, 7 wrong or unsupported, 3 partial.** Its answers didn't change since the first run. Row 3 moved from wrong to partial when Chase's terms showed the card earns 3% without Prime, so RightCard picks the right card at the wrong rate. The Best Buy row, an open data question then, now counts against it. Row 7's verdict now gives the real cause: the gas miss comes from its 1x Sapphire Preferred data, not from Cash+.

**earnrate: 15 of 15.** Read that with care. The expected answers come from our own golden tests, which were written from the same issuer terms as our card files. All of those files still say `verified_by: claude`, so the score shows the engine does what the spec says, not that the data has been checked by a human.

## What the benchmark changed

Taking "Costco.com" as in-store was a real bug, and the benchmark caught it. The engine applied the in-store Visa-only rule and recommended Freedom Unlimited over SoFi. A merchant matched by one of its domains now defaults to online, and the answer says so: "Assumes an online purchase, since you gave a web address."

The wording for known merchants with no bonus category also changed. "Assumes Amazon codes as everything else" now reads "Assumes Amazon falls outside the usual bonus categories."

## Where RightCard is still ahead

- **Merchant directory breadth.** Its curated aliases and family collapsing, plus 3,100+ cases checked against its iOS app. Our table has 91 merchants. The M4 LLM fallback is our answer for the long tail, not a bigger table.
- **Portal notes.** It mentions the Amex Travel portal on airline purchases. earnrate doesn't model portals as a separate channel yet.
- **Distribution.** It has a hosted Streamable HTTP endpoint and is listed in the MCP registry. earnrate will be local stdio only at M5.

Things RightCard did well that earnrate now matches: the next-best card after a cap (from the ranked list), points pooling (Freedom Unlimited counts as UR when Sapphire Preferred is held), and explained tie-breaks.

## Known earnrate gaps the benchmark doesn't cover

These are TODOs in the card files. None of them change a benchmark answer.

- Airbnb booked through Amex Travel
- Prime Visa's 6% with select delivery methods, and the Prime Card Bonus
- Cash+ "select clothing stores" matches every clothing store
- Gas bought at supermarkets and superstores: "kroger gas" resolves to Kroger the supermarket, so BCP shows 6% instead of its 1% base

## Resolved data notes from the RightCard run

- **SoFi:** a Mastercard. The 2% only applies when rewards go into a SoFi account, which the wallet sets with `redemption: sofi-account`.
- **Cash+:** modeled from U.S. Bank's own terms, with chosen categories and one cap shared across both 5% picks.
- **My Best Buy Visa:** 5% at Best Buy, from Best Buy's rewards page (above).
