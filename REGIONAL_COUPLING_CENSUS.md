# BuildHub — Regional Coupling Census

**CLAUDE.md §86–87 · `GCC_SCALE_READINESS.md` §32–52**

> Egypt-first, not Egypt-locked.

The owner's requirement is not that BuildHub launch in the GCC. It is that the
day it does, the work is a **configuration change rather than an archaeology
project**. That means the assumptions have to stop accumulating now, while
there is one market and every one of them is still harmless.

This is the flagging pass the owner asked for: what is coupled to Egypt today,
what it would cost to unpick later, and what was fixed additively in this
release.

Re-derive the currency half with `pnpm exec vitest run server/marketReadiness.test.ts`.
It fails on a **new** hard-coded currency, so this document cannot silently go
stale.

---

## The five facts that must never be confused

The owner's policy, and the axis every finding below is sorted on:

| fact | answers | where it lives now |
|---|---|---|
| authentication | who you are | one global account, unchanged |
| active market | which marketplace you are browsing | a preference — not yet built, and correctly not a transaction source |
| project / RFQ | where the requirement actually is | `projects.marketCode`, `rfqs.marketCode` |
| RFQ currency | what quotations must be in | `rfqs.currency`, inherited by every bid |
| subscription | what the supplier pays BuildHub | `vendorSubscriptions.billingMarketCode` / `.currency` |

---

## FIXED — the coupling the owner named

**Quotation currency came from the supplier's subscription plan.**

`submitQuotation` accepted `z.literal(BILLING_CURRENCY)` — the currency of the
amount a supplier pays BuildHub every month — and wrote it onto the bid as
though it were the currency of the work. The respond form showed the same value
in a read-only field labelled "Currency".

A supplier billed in EGP under an Egypt contract, quoting a Saudi RFQ, bids in
**SAR**. What they pay BuildHub has nothing to do with it.

The procedure now accepts **no currency at all** — not validated, absent — and
reads the RFQ's. Proved by changing an RFQ's currency to SAR and watching the
next bid follow while `BILLING_CURRENCY` stays EGP
(`evidence/zg-marketcurrency.mjs`, check 7–8).

**Cost if left:** every historical quotation would carry a currency that is a
statement about the seller's billing rather than about the bid. Un-picking it
after real cross-border bids exist means deciding, per row, which of the two it
was meant to be.

---

## FIXED — additive foundations

| what | where | why it was expensive later |
|---|---|---|
| canonical market table | `shared/markets.ts` | Six GCC markets defined with real currencies, timezones and Arabic names, all `enabled: false`. A country in a dropdown is never a launched market. |
| one money formatter | `shared/money.ts` | Six spellings disagreed on placement, digit localisation and — the one that mattered — falling back to `'EGP'` for a record that did not say. On the quotation **comparison** screen that would have labelled a SAR bid in Egyptian pounds, on the exact screen a buyer picks a winner from. |
| market on every commercial record | migration `0058` | `projects`, `rfqs` and `vendorSubscriptions`. Backfilled `EG`/`EGP`/`GLOBAL`, which is what every existing row already meant. |
| RFQ market is snapshotted | `rfqs.marketCode` | Read through the project each time, editing a project would silently reinterpret an RFQ suppliers had already quoted against. |
| entitlement scope ≠ billing currency | `entitlementScope`, `entitlementMarkets` | §47: scope must never be inferred from currency. `GLOBAL` today, truthfully, because there is one market. |
| compliance keyed by market | `shared/compliance.ts` | "Engineering syndicate license" is نقابة المهندسين. A market with no confirmed set returns **empty**, never Egypt's — a wrong document list misdirects a professional, an empty one stops them. |
| form labels lost their currency | `LanguageContext` | `'Budget (EGP)'`, `'Your Price (EGP)'`, `'Indicative price from (EGP)'` are hard-codes in a place nobody greps. |
| regression guard | `server/marketReadiness.test.ts` | Fails on a new currency written into a string, including inside a template literal. |
| currency-specific fraction digits | `CURRENCY_FRACTION_DIGITS` | KWD, BHD and OMR have **three** minor digits. The first formatter capped every currency at two, which does not shorten a KWD figure — it changes it, by nearly a fil, on a document somebody signs. |
| an invalid market fails closed | `marketFor` returns `Market \| null` | Absence (a pre-0058 row) resolves through the documented Egypt backfill; an explicit `ZZ` resolves to **null**. Otherwise a corrupt code becomes an Egyptian RFQ, currency and compliance decision nobody made. |
| money-scale migration documented | `GCC_MONEY_SCALE.md` | Money columns are `DECIMAL(n,2)`. MySQL rounds an over-scaled insert rather than refusing it, so enabling Kuwait today would destroy the third digit at write time. A test fails the build if a three-digit market is enabled before the migration runs. |

---

## FLAGGED — still coupled, with the cost

### 1. Geography is free text — the largest remaining item

`projects.location`, `rfqs.location`, `users.location` and
`vendorProfiles.city` / `.country` are all unconstrained `varchar`. There is no
`serviceArea` table and no normalised admin-area vocabulary, so a supplier
cannot say "I serve Riyadh and Jeddah but not Dammam", and RFQ matching cannot
ask whether they do.

`server/_core/aiIntent.ts` carries a regex city list (`cairo|القاهرة`,
`giza|الجيزة`) for intent extraction only — not a business rule, but it is the
shape of the gap.

**Cost if left:** §40 and §41 — cross-border supplier eligibility — cannot be
implemented at all. Matching would fall back to string comparison across
languages and transliterations ("Jeddah" / "جدة" / "Jiddah"), which is the one
thing §25 forbids for stored business data.

**Release-safe next step:** an additive `serviceAreas` table keyed by
`(providerId, marketCode, adminArea)` plus a normalised admin-area list per
enabled market. Not attempted in this release: it changes how enquiry matching
selects suppliers, which is a live commercial path, and the owner's direction
is explicitly not to attempt a risky regional rewrite inside the RC.

### 2. No active-market context in the session

§33 describes a market switcher with a five-step resolution order. Nothing
exists today because there is one market and a chooser over one option is
noise.

**Cost if left:** low. The resolution order reads the record first
(`project`/`RFQ`), which is already true — the browsing preference is the last
piece and it is additive by construction.

### 3. Product prices have no market offer

`products.currency` exists per row, but a product has one price, not a price
per market. §42 describes a market-offer model: EGP 1,500 serving Cairo, SAR
120 serving Riyadh, not offered in the UAE.

**Cost if left:** moderate. It is a new table and a new read path, not a
rewrite of the existing one — a product's current price becomes its EG offer.

### 4. Billing is one market, correctly

`shared/billing.ts` holds `BILLING_CURRENCY = 'EGP'` and
`SUPPORTED_CURRENCIES = ['EGP']`. This is **not** debt: BuildHub bills in one
market and has no payment provider. It is now read by no sourcing surface,
which was the defect.

**Cost if left:** low, and §45 is explicit about the shape — each market price
must be an approved catalogue price, never an FX conversion of Egypt's.

### 5. Five declared currency hard-codes

Listed with reasons in `DECLARED_CURRENCY_HARDCODES`
(`server/marketReadiness.test.ts`). All are on indicative or non-commercial
surfaces. A second test fails if a declared file stops carrying one, so the
list cannot become fiction.

---

## Not done, and deliberately

Nothing here **enables** a GCC market. `enabled: false` on all six is the only
thing that decides, and flipping one is an owner decision behind the readiness
gate in `GCC_SCALE_READINESS.md`. A market with no service-area vocabulary, no
confirmed compliance set and no approved price catalogue would be a country in
a dropdown, which §86 says is never sufficient.
