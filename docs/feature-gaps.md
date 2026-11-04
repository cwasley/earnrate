# Feature gaps

Card terms the engine or schema can't express yet, collected from the `todo:` lists in `data/cards/`. Each entry is a possible feature, with the cards it would fix. Data gaps (an unconfirmed network, an issuer page that didn't render, a missing merchant) stay in the card's own `todo:` and aren't listed here.

When a card's `todo:` says the schema or engine can't model something, add it here or add the card to an existing entry. Remove an entry once the feature ships.

## Candidates

### Activation that isn't retroactive

`activate_by` treats an activated bonus as covering its whole period. Some issuers pay the bonus only on purchases from the day you activate.

- `discover-it-cash-back`: 5% applies "from 10/1/26 (or the date on which you activate 5%, whichever is later)". Activation is allowed through the quarter's last day, so `activate_by` is set to that day and the rule notes explain the rest.

### Rate after a shared cap that differs by rule

Past a cap, spending earns the higher of the cap's `then_rate` and the card's best uncapped rate for that purchase (so Freedom Flex dining falls back to 3%, and a BofA Rewards tier's boosted base rate applies). What's left is a cap that changes a rule's own rate afterward:

- `chase-ink-business-preferred`: Lyft should drop to 3x once the $150,000 cap is used. Modeled at 5x uncapped.

### Membership tiers as multipliers

A tier that scales every rate on a card is written today as one membership-gated rule per rate. A multiplier on the card would cut that to one line per tier and fix the cap case above.

- `bank-of-america-customized-cash-rewards`: 12 rules for the four BofA Rewards tiers.

### Rate increase after a spend threshold

- `citi-aadvantage-executive`: 5x on American Airlines after $150,000 in calendar-year spend.

### Stacking bonuses

The engine picks the single best rule per purchase. Some bonuses add on top of another rule.

- `chase-aeroplan`: 500 bonus points per $2,000 spent in a calendar month, up to 1,500 a month, through 2026-12-31.
- `citi-custom-cash`: whether the extra 4% on Citi Travel hotels stacks on the 5% top category is unconfirmed.

### Choice options that mix kinds

A choice option is a list of categories, a list of merchants, or "any online purchase except". Some issuers' options also need MCCs or a mix.

- `citi-custom-cash`: select travel includes travel agencies (MCC 4722).
- `bilt-obsidian`: the dining pick includes bakeries (MCC 5462), which earnrate's dining category doesn't cover, so bakery purchases earn 1x.

### Time-of-day rules

- `citi-strata-elite`: Citi Nights 6x at restaurants depends on the authorization time. Modeled at 3x.

### Offer-wide caps and minimum purchases

- `chase-sapphire-reserve`: the Peloton $5,000 limit runs across the whole offer (2025-04-01 to 2027-12-31), and each purchase must be at least $150.
- `chase-sapphire-preferred`: the same Peloton offer and limits.

### Minimum purchase size

A rule that applies only to purchases above an amount. The engine has the purchase amount when one is given, but no rule condition on it.

- `amex-business-platinum`: 2X on any eligible purchase of $5,000 or more, inside the $2 million yearly cap shared with its 2X categories.

### Payment-method exclusions

A purchase can say how it's paid (`card`, `apple-pay`, `google-pay` or `paypal`), and a rule can require one (`requires: { payment: apple-pay }`) or exclude some (`exclude: { payment: [paypal] }`). Apple Card and PayPal Cashback use it. What's left are exclusions the issuers word too loosely to model, or that the source check can't re-read:

- `capital-one-savor`, `bank-of-america-customized-cash-rewards`, `bank-of-america-premium-rewards`, `barclays-jetblue-plus`, `discover-it-cash-back`: purchases through third-party payment accounts, mobile card readers or digital wallets "may not" earn the bonus, depending on how the merchant codes them. Not a rule earnrate can apply.
- `amex-hilton-honors-surpass`: online retail at 4x excludes purchases "through a third-party payment account". PayPal is the usual one, but Amex doesn't name it.
- `td-bank-nordstrom-credit-card`, `td-bank-nordstrom-visa`: through PayPal or another third-party processor, Nordstrom purchases earn only the member's 1 point, and the Rack discount excludes Apple Pay and PayPal. Nordstrom's pages block the source check, and on the Visa an excluded Nordstrom purchase would fall back to the card's 1x base rate, which the terms don't say it earns.

### Category taxonomy

Merchant types some cards name that have no earnrate category, so they fall to `other`.

- `bank-of-america-customized-cash-rewards`: Online Shopping excludes doctors and hospitals, government services and taxes, insurance and schools.
- `capital-one-savor`: amusement parks, tourist attractions, aquariums, zoos, record stores, pool halls and bowling alleys earn 3% as entertainment; golf courses and collegiate sporting events are excluded.
- `amex-business-gold`, `amex-business-platinum`: software and cloud system providers count with electronics stores.
- `citi-strata`: the Self-Select Category's Cosmetic Stores/Barber Shops/Hair Salons and Pet Supply Stores options.
- `bank-of-america-premium-rewards`: travel includes tourist attractions, galleries, amusement parks, aquariums and zoos.

### Housing payments and second currencies

- `bilt-obsidian`, `bilt-blue`, `bilt-palladium`: rent and mortgage points depend on the cycle's everyday spend as a share of the housing payment. Bilt Cash is a second currency (the Flexible option, Point Accelerator and the welcome offer all use it).

### Tiered and repeating sign-up bonuses

A welcome offer has one spend threshold and one bonus.

- `capital-one-venture-x-business`: a second 150,000 miles (and a $1,000 travel credit) at $120,000 in the same first 4 months. Only the first tier is modeled.
- `capital-one-spark-cash-plus`: $2,000 for every $500,000 spent in the first 12 months, on top of the $2,000 welcome offer.

### Per-card fees

- `bank-of-america-atmos-rewards-business`: $25 a year per card on top of the $70 per-company fee.

### Memberships a card implies

Holding some cards means holding a membership, but the wallet asks for memberships separately, so a rate gated on one stays off until the user adds it.

- `chase-prime-visa`: needs Amazon Prime for its Amazon and Whole Foods rates.

### Spend milestones that start later

Spend milestones (`milestones:`) have no start date, so one the issuer announces ahead of time isn't listed until it begins.

- `chase-ihg-one-rewards`: starting in 2027, $5,000 of purchases in a calendar year unlocks the 4th Reward Night free benefit.
- `chase-ihg-one-rewards-business`: starting January 1, 2027, $50,000 of purchases in a calendar year earns Diamond Elite status.

### Milestone years on billing cycles

A `cardmember_year` milestone runs from the account anniversary date. Citi counts AAdvantage spend milestones over a cardmembership year from the billing cycle after the anniversary month, so the wallet would need the statement date as well.

- `citi-aadvantage-business`: $30,000 for the Companion Certificate.
- `citi-aadvantage-platinum-select`: $20,000 for the $125 Flight Discount.

### Credits that offset the annual fee

Welcome-offer comparisons subtract the whole first-year fee. Cards with fixed yearly credits look worse than they are to someone who uses them. It would need a per-card credit value with evidence, kept apart from earn rates (credits as rewards stay out of scope, below).

- `amex-hilton-honors-surpass`: up to $200 a year in Hilton credits ($50 a quarter).
- `amex-hilton-honors-aspire`: Hilton resort, flight, CLEAR+ and Waldorf Astoria or Conrad property credits, plus an Annual Free Night Reward with no spending needed.

## Not planned

Out of scope per the project's non-goals, or too variable to model as a rate.

- Statement credits other than merchant credits (airline fee credits you choose an airline for, Global Entry and TSA PreCheck, free nights). Merchant credits (dollars back at a named merchant up to a limit per period, like Amex Platinum's Lululemon credit) are planned (Collin's call, 2026-11-04).
- Store discounts and coupons (Kohl's, Target, Nordstrom cardholder offers).
- Per-item and limited-time promotions (Prime Card Bonus, Prime Visa's 6% with select delivery, Nordstrom bonus points events, Bilt Neighborhood Dining).
