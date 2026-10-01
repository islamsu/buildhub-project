# BuildHub — Money Scale Migration Plan

**`GCC_SCALE_READINESS.md` §53A · `CLAUDE.md` §88**

> database precision must support the maximum enabled currency scale before
> those markets are enabled

This document is that plan, and **it has been executed** — see
`drizzle/0063_money_scale.sql`. It was required before Kuwait, Bahrain or Oman
could be enabled in `shared/markets.ts`, and `server/marketReadiness.test.ts`
still fails the build if one of them is enabled while any money column is
two-scale, so the guard remains live rather than retired on completion.

Widening the columns clears the storage gate ONLY. Those three markets remain
`enabled: false`, behind the full multi-market readiness gate in
`GCC_SCALE_READINESS.md` §54.

---

## The problem, precisely

Three of the six GCC currencies have **three** minor digits, not two:

| currency | market | minor unit | digits |
|---|---|---|---|
| KWD | Kuwait | fils | **3** |
| BHD | Bahrain | fils | **3** |
| OMR | Oman | baisa | **3** |
| EGP, SAR, AED, QAR | Egypt, Saudi Arabia, UAE, Qatar | piastre / halala / fils / dirham | 2 |

Every money column in BuildHub is `DECIMAL(n, 2)`.

MySQL does not refuse an over-scaled insert into a `DECIMAL(12,2)` column. It
**rounds it and carries on**. A quotation of `1,234.567 KWD` is stored as
`1234.57`, and the third digit is gone — not displayed wrongly, *gone*. No
formatter fix recovers it, and the supplier's signed commercial document and
BuildHub's record of it no longer agree.

That is why this is a migration and not a display change, and why the guard is
on **enablement** rather than on rendering.

---

## Columns to migrate

**STATUS: EXECUTED as `drizzle/0063_money_scale.sql`.** This section records
what was done; the list below was re-derived from the live schema at the time
of writing rather than copied from the earlier draft of this document, which
had already gone stale — it listed `quotations.price` as `DECIMAL(12,2)` when
migration 0062 had widened it to `(14,3)`.

Scale `2 -> 3`; **precision rises by one so integer capacity is unchanged**.
`DECIMAL(12,2)` holds ten integer digits and so does `DECIMAL(13,3)`. Raising
scale alone would have cost every column a factor of ten of headroom, turning a
precision fix into a range regression that surfaces as a large legitimate
budget being refused.

| table.column | before | after |
|---|---|---|
| `projects.budget` | `DECIMAL(14,2)` | `DECIMAL(15,3)` |
| `projects.spent` | `DECIMAL(14,2)` | `DECIMAL(15,3)` |
| `products.price` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `rfqs.budget` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `rfqItems.unitPriceSnapshot` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `serviceOfferings.priceMin` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `serviceOfferings.priceMax` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `expenses.amount` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |

### Already three-scale before 0063

Migration 0062, in the finishing release, wrote the quotation pricing tables at
scale 3 from the start: `quotations.price`, `baseAmount`, `discountAmount`,
`vatAmount`, `materialBaseAmount`, `packageRate`, and `quotationItems.rate` and
`lineTotal`. They need nothing here.

### Deliberately NOT widened

Mechanically widening every `DECIMAL(n,2)` would be a change with no reason
behind it. Five columns stay at scale 2, each for a stated reason:

| column | why |
|---|---|
| `users.rating`, `products.rating` | a 0.00-5.00 rating, not an amount |
| `rfqItems.quantity` | a quantity (pieces, m2), not an amount |
| `quotations.packageQuantity` | an area or quantity, not an amount |
| `vendorSubscriptions.priceAmount` | money, but billing-domain and EGP-only |

The last one is money and is still not widened: subscription billing is a
separate domain whose currency set is EGP alone, so a three-digit billing
currency is something no code can currently produce. The assumption is
**enforced rather than remembered** — `server/moneyScale.test.ts` fails if
`SUPPORTED_CURRENCIES` ever gains a currency needing more digits than that
column holds.

Re-derive before any future change — a column added after this was written
would be missed:

```sql
SELECT TABLE_NAME, COLUMN_NAME, NUMERIC_PRECISION, NUMERIC_SCALE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'decimal' AND NUMERIC_SCALE = 2;
```

`server/moneyScale.test.ts` performs the equivalent census over
`drizzle/schema.ts` on every run, so a new scale-2 money column fails the build
rather than waiting to be noticed.

---

## Why this is safe, and what makes it not

**Widening a DECIMAL is lossless.** `1234.57` in a `DECIMAL(13,3)` column is
`1234.570`. Every existing row keeps its exact value; no row is rewritten in a
way that changes what it means, and every existing two-digit currency still
formats to two digits because the scale a figure is *displayed* at comes from
`CURRENCY_FRACTION_DIGITS`, not from the column.

**It is not reversible in place.** Narrowing `3 → 2` afterwards would round
every three-digit amount, so this runs once, forward, and the rollback for a
failed deploy is the deployment rollback rather than a down-migration.

**It rewrites the table.** `ALTER TABLE … MODIFY` on a DECIMAL is a full table
copy in InnoDB. On a large `quotations` or `expenses` table that is a
maintenance window, or an online-DDL tool. Size the tables first:

```sql
SELECT TABLE_NAME, TABLE_ROWS, ROUND(DATA_LENGTH/1024/1024) AS mb
FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE();
```

---

## Order of operations

1. **Migrate the columns.** One additive migration, `MODIFY` only — nothing
   dropped, nothing renamed, no row rewritten by a `SET`.
2. **Verify.** Re-run the `information_schema` query; no money column should
   report scale 2. Spot-check a known row's value before and after.
3. **Check the arithmetic paths.** `server/projectSpend.ts` sums expenses and
   the quotation comparison finds a lowest price. Both read DECIMAL as a
   string and parse it — confirm nothing rounds to two digits on the way
   through, and that a comparison between a two-digit and three-digit currency
   is never attempted (it must not be: an RFQ has one currency, by rule).
4. **Check validation bounds.** `submitQuotation` caps price at
   `9_999_999_999.99`. That literal is a two-digit bound and should follow the
   column.
5. **Only then** flip `enabled: true` for the market, behind the full
   readiness gate — which also requires a service-area vocabulary, a confirmed
   compliance requirement set and an approved price catalogue for that market.

---

## What this release delivers

The migration IS now written and applied (0063). What remains deliberately
separate is **market activation**: widening the columns removes one gate, not
the gate.

Also in place:

- the scale table (`CURRENCY_FRACTION_DIGITS`) so no code assumes two
- a formatter that uses each currency's own scale, with `null` for an unknown
  currency rather than an imposed Egyptian two
- `MAX_CURRENCY_FRACTION_DIGITS`, so the schema requirement is a number rather
  than a memory
- a test that **fails the build** if a three-digit market is enabled while the
  columns cannot hold it

The last one is the point. The plan does not have to be remembered, because
enabling Kuwait against two-digit columns does not compile.

### Verified, not assumed

Against a real MariaDB instance, before and after 0063:

- writing `1234.567` into the old `DECIMAL(12,2)` column returned `1234.57` —
  the defect, reproduced
- after the migration, `1234.567` returns `1234.567`
- a legacy `1450.00` row returns `1450.000` — the same amount, losslessly
- integer capacity confirmed at ten digits (`9999999999.999` fits)
- the full chain applies from empty: 65 migrations, no error

### Validation bounds followed the columns

`submitQuotation` capped `price` at `9_999_999_999.99` while every sibling
component already allowed `.999`. Leaving the authoritative total capped a
hundredth short of its own components would surface only on a three-digit
currency, as a refused quotation whose line items each validated fine. Corrected
with the column.
