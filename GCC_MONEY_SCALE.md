# BuildHub — Money Scale Migration Plan

**`GCC_SCALE_READINESS.md` §53A · `CLAUDE.md` §88**

> database precision must support the maximum enabled currency scale before
> those markets are enabled

This document is that plan. It must be executed **before** Kuwait, Bahrain or
Oman is enabled in `shared/markets.ts`, and
`server/marketReadiness.test.ts` fails the build if one of them is enabled
while the columns are still two-scale.

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

Every column that holds a currency amount. Scale `2 → 3`; precision rises by
one so the integer range is unchanged.

| table.column | today | after |
|---|---|---|
| `projects.budget` | `DECIMAL(14,2)` | `DECIMAL(15,3)` |
| `projects.spent` | `DECIMAL(14,2)` | `DECIMAL(15,3)` |
| `products.price` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `rfqs.budget` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `rfqItems.unitPriceSnapshot` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `quotations.price` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `serviceOfferings.priceMin` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `serviceOfferings.priceMax` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `expenses.amount` | `DECIMAL(12,2)` | `DECIMAL(13,3)` |
| `vendorSubscriptions.priceAmount` | `DECIMAL(10,2)` | `DECIMAL(11,3)` |

Re-derive the list before writing the migration — a column added after this
document was written would be missed:

```sql
SELECT TABLE_NAME, COLUMN_NAME, NUMERIC_PRECISION, NUMERIC_SCALE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'decimal' AND NUMERIC_SCALE = 2;
```

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

## What is deliberately NOT done now

The migration is **not** written or applied in this release candidate.

Running a full-table-copy ALTER across ten tables to support markets that are
disabled, on a release whose own migrations are still local-only, is risk
without benefit. What this release delivers instead is:

- the scale table (`CURRENCY_FRACTION_DIGITS`) so no code assumes two
- a formatter that uses each currency's own scale
- `MAX_CURRENCY_FRACTION_DIGITS`, published so the schema requirement is a
  number rather than a memory
- a test that **fails the build** if a three-digit market is enabled while the
  columns cannot hold it

The last one is the point. The plan does not have to be remembered, because
enabling Kuwait without executing it does not compile.
