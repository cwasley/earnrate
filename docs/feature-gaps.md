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
- `usbank-smartly`: whether the Smartly Earning Bonus also applies to the 4 extra points on Travel Center hotels and car rentals is unstated. Modeled at 6% for every tier.
- `venmo-credit-card`: an extra 1% on dining and entertainment when the purchase is split with another Venmo user in the app.

### Choice options that mix kinds

A choice option is a list of categories, a list of merchants, or "any online purchase except". Some issuers' options also need MCCs or a mix.

- `citi-custom-cash`: select travel includes travel agencies (MCC 4722).
- `bilt-obsidian`: the dining pick includes bakeries (MCC 5462), which earnrate's dining category doesn't cover, so bakery purchases earn 1x.

### Time-of-day rules

- `citi-strata-elite`: Citi Nights 6x at restaurants depends on the authorization time. Modeled at 3x.

### Offer-wide caps and minimum purchases

- `chase-sapphire-reserve`: the Peloton $5,000 limit runs across the whole offer (2025-04-01 to 2027-12-31), and each purchase must be at least $150.
- `chase-sapphire-preferred`: the same Peloton offer and limits.

### Payment-method exclusions

A purchase can say how it's paid (`card`, `apple-pay`, `google-pay` or `paypal`), and a rule can require one (`requires: { payment: apple-pay }`) or exclude some (`exclude: { payment: [paypal] }`). Apple Card and PayPal Cashback use it. What's left are exclusions the issuers word too loosely to model, or that the source check can't re-read:

- `capital-one-savor`, `bank-of-america-customized-cash-rewards`, `bank-of-america-premium-rewards`, `barclays-jetblue-plus`, `discover-it-cash-back`: purchases through third-party payment accounts, mobile card readers or digital wallets "may not" earn the bonus, depending on how the merchant codes them. Not a rule earnrate can apply.
- `amex-hilton-honors-surpass`: online retail at 4x excludes purchases "through a third-party payment account". PayPal is the usual one, but Amex doesn't name it.
- `td-bank-nordstrom-credit-card`, `td-bank-nordstrom-visa`: through PayPal or another third-party processor, Nordstrom purchases earn only the member's 1 point, and the Rack discount excludes Apple Pay and PayPal. Nordstrom's pages block the source check, and on the Visa an excluded Nordstrom purchase would fall back to the card's 1x base rate, which the terms don't say it earns.
- `venmo-credit-card`: 3% when the card is the linked payment method in Venmo (Venmo checkout, a business profile or a goods-and-services payment). Venmo isn't one of the payment methods a purchase can name, so it's modeled at each purchase's category rate.

### Category taxonomy

Merchant types some cards name that have no earnrate category, so they fall to `other`.

- `bank-of-america-customized-cash-rewards`: Online Shopping excludes doctors and hospitals, government services and taxes, insurance and schools.
- `capital-one-savor`: amusement parks, tourist attractions, aquariums, zoos, record stores, pool halls and bowling alleys earn 3% as entertainment; golf courses and collegiate sporting events are excluded.
- `amex-business-gold`, `amex-business-platinum`: software and cloud system providers count with electronics stores.
- `citi-strata`: the Self-Select Category's Cosmetic Stores/Barber Shops/Hair Salons and Pet Supply Stores options.
- `bank-of-america-premium-rewards`: travel includes tourist attractions, galleries, amusement parks, aquariums and zoos.
- `usbank-smartly`: education, gift cards, insurance, tax, business-to-business merchants and third-party bill payment earn 2% at every Smartly tier and don't count toward the $10,000.
- `venmo-credit-card`: cable, satellite and pay TV earn 3% as entertainment, but earnrate's `tv_internet` also covers internet service, which earns 1%.

### Housing payments and second currencies

- `bilt-obsidian`, `bilt-blue`, `bilt-palladium`: rent and mortgage points depend on the cycle's everyday spend as a share of the housing payment. The `housing` category's note states the tiers; answers for rent and mortgage give only that note, with no ranking or pick. Bilt Cash is a second currency (the Flexible option, Point Accelerator and the welcome offer all use it).

### Tiered and repeating sign-up bonuses

A welcome offer has one spend threshold and one bonus.

- `capital-one-venture-x-business`: a second 150,000 miles (and a $1,000 travel credit) at $120,000 in the same first 4 months. Only the first tier is modeled.
- `capital-one-spark-cash-plus`: $2,000 for every $500,000 spent in the first 12 months, on top of the $2,000 welcome offer.
- `capital-one-rei-co-op-mastercard`: the $100 REI gift card needs a purchase outside REI; welcome-offer progress counts every purchase.

### Per-card fees

- `bank-of-america-atmos-rewards-business`: $25 a year per card on top of the $70 per-company fee.

### Memberships without a yearly price

`requires_membership` needs a membership with an `annual_fee`. Some cards need a membership you qualify for, or a service you already pay for, rather than one you buy each year, so these have `annual_fee: 0` and answers can't say who may join.

- `caltech-efcu-platinum-mastercard`: Caltech EFCU membership (Caltech, JPL and affiliate employees, students, alumni and family; a one-time $5 fee).
- `navy-federal-cash-rewards`, `navy-federal-cash-rewards-plus`, `navy-federal-more-rewards-amex`: Navy Federal membership (the armed forces, veterans, DoD civilians and their families).
- `verizon-visa-card`: a Verizon wireless or Fios account.
- `capital-one-rei-co-op-mastercard`: an REI Co-op membership, whose price isn't on file.

### One application, two cards

- `navy-federal-cash-rewards`, `navy-federal-cash-rewards-plus`: one cashRewards application issues cashRewards (1.5%) below a $5,000 credit limit or cashRewards Plus (2%) at $5,000 or more, on Visa or Mastercard. earnrate lists two Visa cards and can't say an applicant may get either.

### Milestone years on billing cycles

A `cardmember_year` milestone runs from the account anniversary date. Citi counts AAdvantage spend milestones over a cardmembership year from the billing cycle after the anniversary month, so the wallet would need the statement date as well.

- `citi-aadvantage-business`: $30,000 for the Companion Certificate.
- `citi-aadvantage-platinum-select`: $20,000 for the $125 Flight Discount.

### Perks that offset the annual fee

Merchant credits (`credits:`) and yearly free nights (`free_nights:`, one after each account anniversary, valued at the night's point cap times the person's point value, or at what the cardholder says it's worth to them) count against a held card's fee once the cardholder says they use them, and are shown apart for cards not held. A night with no point cap (`amex-hilton-honors-aspire`'s Annual Free Night Reward) counts only at the cardholder's own value, and isn't counted for cards not held. Points every cardholder gets after each account anniversary with nothing to enroll in (`yearly_points:`, a fixed amount or a percent of the year's purchases or points) count in every yearly figure without being marked used, and from year two in a welcome-offer comparison. Other perks that aren't dollars at a store don't count anywhere.

- Free nights earned by spending (milestone `rewards` on the Hilton, Marriott and IHG cards) are shown, not valued.
- Yearly points that depend on holding another card: `chase-united-business` and `chase-united-club-business` give 5,000 miles a year only beside a personal Chase United card. `yearly_points` has no condition on the wallet's other cards, so they aren't entered.

### Merchant credits the schema can't express

A credit (`credits:`) is a fixed dollar amount each period at named merchants or a category, counted on top of the card's rate. A credit earnrate can't match to a purchase is listed instead (`listed`, with a name and what it pays on): it's shown wherever a card's credits are and counted against the annual fee once the cardholder says they use it, but never applied to a purchase, so what's used of it is only what the cardholder marks. Listed so far: the airline fee and hotel credits on `amex-platinum` and `amex-business-platinum` (Fine Hotels + Resorts, The Hotel Collection and Airbnb Luxe through Amex Travel), `chase-sapphire-reserve`'s Exclusive Tables dining credit, United FareLock (`chase-united-business`, `-club-business`), `citi-aadvantage-executive`'s inKind and inflight and Admirals Club credits, `citi-aadvantage-globe`'s inflight credit, and the Splurge credits on `citi-aadvantage-globe` and `citi-strata-elite`. These credits still don't fit:

- Starting a while after the account opens. `amex-delta-skymiles-gold`'s rideshare credit opens 12 months after the account does; the note says so.
- Purchases the credit pays for earning nothing. earnrate counts the card's rate on the whole purchase: `chase-sapphire-reserve` ($300 travel credit, and The Edit, not entered), `capital-one-venture-x` and `capital-one-venture-x-business` (travel credits), `citi-strata-premier` (the $100 Annual Hotel Benefit).
- Excluding part of a category. `chase-sapphire-reserve`'s travel credit covers Chase's travel category, which includes trains, buses, taxis, tolls and parking but not rideshare; earnrate's `transit` includes rideshare, so the credit matches `travel` only.
- After a spending total or another purchase. Listing one would count it before it's earned. Not entered: `amex-business-platinum` Adobe ($250 after $600), Dell's extra $1,000 (after $5,000) and Airbnb Experiences ($250 after an Airbnb Luxe booking through Amex Travel), `amex-delta-skymiles-gold` Delta flight credit (after $10,000 in a year), `chase-marriott-bonvoy-boundless` airline credit (after $500), `chase-ihg-one-rewards-premier` and `-business` airline credit (after $250), `chase-united-business` $125 (after five flights of $100 or more), `citi-aadvantage-executive` Lyft (after three rides a month), `usbank-altitude-go` (after 11 months of streaming).
- A limit per purchase, booking or stay rather than per period, so there's no period total to list. Not entered: `chase-sapphire-reserve` The Edit ($250 a booking), `chase-united-explorer` and `chase-united-business` United Hotels ($50 on each of the first two stays), the Capital One Premier and Lifestyle Collection experience credits, `amex-hilton-honors-aspire` and `amex-marriott-bonvoy-brilliant` property credits (per stay), `citi-aadvantage-globe` Turo ($30 a trip). The Instacart credits on `chase-united-quest`, `chase-united-club` and `chase-united-club-business` are two credits a month, one per order; they're entered as one monthly amount.
- Merchants and a category together. Not entered: `amex-business-gold`'s $20 a month at Grubhub, UPS.com and office supply stores.
- Only some of a merchant's sales, or a merchant you choose first: listed (above), except `bank-of-america-premium-rewards`' airline incidental credit, whose pages refused the source check; it waits for a reading in a browser.
- A percentage back rather than dollars. Not entered: the Amex Venue Collection (10% back at select stadiums and arenas).

## Not planned

Out of scope per the project's non-goals, or too variable to model as a rate.

- Statement credits once every several years (Global Entry, TSA PreCheck), and benefits that aren't spending (lounges, memberships). Merchant credits (dollars back at named merchants up to a limit per period, like Amex Platinum's lululemon credit) are modeled as card `credits:` (Collin's call, 2026-11-04), credits for a merchant you choose first or on only some of a merchant's sales are listed credits (Collin's call, 2026-11-11), and yearly free nights with a point cap are `free_nights:`.
- Store discounts and coupons (Kohl's, Target, Nordstrom cardholder offers).
- Per-item and limited-time promotions (Prime Card Bonus, Prime Visa's 6% with select delivery, Nordstrom bonus points events, Bilt Neighborhood Dining).
