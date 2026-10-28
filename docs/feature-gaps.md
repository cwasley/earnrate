# Feature gaps

Card terms the engine or schema can't express yet, collected from the `todo:` lists in `data/cards/`. Each entry is a possible feature, with the cards it would fix. Data gaps (an unconfirmed network, an issuer page that didn't render, a missing merchant) stay in the card's own `todo:` and aren't listed here.

When a card's `todo:` says the schema or engine can't model something, add it here or add the card to an existing entry. Remove an entry once the feature ships.

## Candidates

### Account-age offers

A rate that applies only for a stretch after account opening. The wallet would need an opening date per card; `bonus.opened` already records one while a welcome bonus is in progress.

- `bank-of-america-customized-cash-rewards`: 6% in the choice category for the first 365 days (an extra 3% inside the same $2,500 quarterly cap, with no BofA Rewards bonus on the extra 3%).

### Rate after a shared cap that differs by rule

A shared cap has one `then_rate`. Some cards drop to a different rate depending on which rule was capped or which membership the cardholder has.

- `bank-of-america-customized-cash-rewards`: with a BofA Rewards tier, the part of a purchase past the $2,500 cap should earn the tier's boosted base rate (1.1%–1.75%), not 1%. Understated only for a purchase that crosses the cap.
- `chase-ink-business-preferred`: Lyft should drop to 3x once the $150,000 cap is used. Modeled at 5x uncapped.

### Membership tiers as multipliers

A tier that scales every rate on a card is written today as one membership-gated rule per rate. A multiplier on the card would cut that to one line per tier and fix the cap case above.

- `bank-of-america-customized-cash-rewards`: 12 rules for the four BofA Rewards tiers.
- `bank-of-america-atmos-rewards-ascent`, `-summit`, `-business`: the 10% bonus for a Bank of America account. Bank of America's terms now say a BofA Rewards tier bonus replaces the 10% customer bonus on eligible cards; whether the Atmos cards are eligible is unchecked.

### Rate increase after a spend threshold

- `citi-aadvantage-executive`: 5x on American Airlines after $150,000 in calendar-year spend.

### Stacking bonuses

The engine picks the single best rule per purchase. Some bonuses add on top of another rule.

- `chase-aeroplan`: 500 bonus points per $2,000 spent in a calendar month, up to 1,500 a month, through 2026-12-31.
- `citi-custom-cash`: whether the extra 4% on Citi Travel hotels stacks on the 5% top category is unconfirmed.

### Foreign-transaction geography

Rules can be `us_only` or `worldwide`, not foreign-only.

- `bank-of-america-atmos-rewards-summit`: 3x on purchases in a foreign currency or processed abroad. It would make this card the pick for most purchases abroad.

### Choice options that mix kinds

A choice option is a list of categories, a list of merchants, or "any online purchase except". Some issuers' options also need MCCs or a mix.

- `citi-custom-cash`: select travel includes travel agencies (MCC 4722).

### Time-of-day rules

- `citi-strata-elite`: Citi Nights 6x at restaurants depends on the authorization time. Modeled at 3x.

### Offer-wide caps and minimum purchases

- `chase-sapphire-reserve`: the Peloton $5,000 limit runs across the whole offer (2025-04-01 to 2027-12-31), and each purchase must be at least $150.

### Payment-method exclusions

There's no input for how a purchase was paid beyond online or in store.

- `capital-one-savor`, `bank-of-america-customized-cash-rewards`: purchases through third-party payment accounts or unsupported digital wallets may not earn the bonus.

### Category taxonomy

Merchant types some cards name that have no earnrate category, so they fall to `other`.

- `bank-of-america-customized-cash-rewards`: Online Shopping excludes doctors and hospitals, government services and taxes, insurance and schools.
- `capital-one-savor`: amusement parks, tourist attractions, aquariums, zoos, record stores, pool halls and bowling alleys earn 3% as entertainment; golf courses and collegiate sporting events are excluded.

### Housing payments and second currencies

- `bilt-obsidian`: rent and mortgage points depend on the cycle's everyday spend as a share of the housing payment. Bilt Cash is a second currency (the Flexible option, Point Accelerator and the welcome offer all use it).

### Per-card fees

- `bank-of-america-atmos-rewards-business`: $25 a year per card on top of the $70 per-company fee.

## Not planned

Out of scope per the project's non-goals, or too variable to model as a rate.

- Statement credits (IHG Premier and Business airline and Expensify credits).
- Store discounts and coupons (Kohl's, Target, Nordstrom cardholder offers).
- Per-item and limited-time promotions (Prime Card Bonus, Prime Visa's 6% with select delivery, Nordstrom bonus points events, Bilt Neighborhood Dining).
