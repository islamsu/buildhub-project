-- ── MONEY COLUMNS MUST HOLD THREE FRACTIONAL DIGITS ────────────────────────
--
-- GCC_SCALE_READINESS.md §53A, CLAUDE.md §88, and the owner directive that
-- Egypt + the six registered GCC markets must be supportable.
--
-- Three of the six GCC currencies divide into 1,000 minor units, not 100:
-- the Kuwaiti dinar (fils), the Bahraini dinar (fils) and the Omani rial
-- (baisa). Every money column below was DECIMAL(n,2).
--
-- MySQL DOES NOT REFUSE AN OVER-SCALED INSERT. It rounds it and carries on.
-- A quotation of 1,234.567 OMR written into DECIMAL(12,2) is stored as
-- 1234.57 and the third digit is not mis-displayed, it is GONE. No formatter
-- recovers it, and the provider's commercial document and BuildHub's record of
-- it no longer agree. That is why this is a migration and not a display fix.
--
-- WHAT IS WIDENED, AND WHAT IS DELIBERATELY NOT
--
-- The column list was re-derived from the live schema rather than copied from
-- GCC_MONEY_SCALE.md, whose table had already gone stale: it listed
-- quotations.price as DECIMAL(12,2) when migration 0062 had widened it to
-- (14,3). Derivation query:
--
--   SELECT TABLE_NAME, COLUMN_NAME, NUMERIC_PRECISION, NUMERIC_SCALE
--   FROM information_schema.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'decimal'
--     AND NUMERIC_SCALE = 2;
--
-- That returns thirteen columns. Eight of them hold money and are widened
-- here. Five are not money and are LEFT ALONE, because mechanically widening
-- every DECIMAL(n,2) would be a change with no reason behind it:
--
--   users.rating, products.rating      a 0.00-5.00 rating, not an amount
--   rfqItems.quantity                  a quantity (pieces, m2), not an amount
--   quotations.packageQuantity         likewise an area or quantity
--   vendorSubscriptions.priceAmount    money, but see below
--
-- vendorSubscriptions.priceAmount IS money, and is still not widened. It is
-- what a supplier pays BuildHub, a domain whose currency is constrained to
-- EGP by shared/billing.ts (BILLING_CURRENCY, SUPPORTED_CURRENCIES), and the
-- owner's policy (§87) keeps subscription billing currency separate from
-- transaction currency on purpose. Widening it would imply a three-digit
-- billing currency that no code can produce. Instead the assumption is
-- ENFORCED rather than remembered: server/moneyScale.test.ts fails if
-- SUPPORTED_CURRENCIES ever gains a currency needing more than two digits
-- while this column holds two.
--
-- INTEGER CAPACITY IS PRESERVED, NOT JUST SCALE. Precision rises by one
-- alongside scale, so the number of digits available LEFT of the decimal point
-- is unchanged. DECIMAL(12,2) holds ten integer digits; DECIMAL(13,3) also
-- holds ten. Raising scale without raising precision would have silently cost
-- every one of these columns a factor of ten of headroom, turning a precision
-- fix into a range regression.
--
-- WIDENING A DECIMAL IS LOSSLESS. 1234.57 in DECIMAL(13,3) reads 1234.570 -
-- the same amount. No row is rewritten by a SET, nothing is dropped or
-- renamed, and every two-digit currency still DISPLAYS at two digits, because
-- display scale comes from CURRENCY_FRACTION_DIGITS and never from the column.
--
-- ROLLBACK IS THE DEPLOYMENT ROLLBACK, NOT A DOWN-MIGRATION. Narrowing 3 -> 2
-- afterwards would round away every third digit written in the meantime, so
-- this runs once, forward. It is backward compatible in the sense the deploy
-- requires: the previous release's code reads these columns as strings and
-- parses them, and "1234.570" parses exactly as "1234.57" did.
--
-- EACH ALTER REWRITES THE TABLE. MODIFY on a DECIMAL is a full table copy in
-- InnoDB. At current volumes that is seconds; after launch these same eight
-- statements are a maintenance window or an online-DDL tool.

ALTER TABLE `projects`         MODIFY `budget`            DECIMAL(15,3);
--> statement-breakpoint
ALTER TABLE `projects`         MODIFY `spent`             DECIMAL(15,3) DEFAULT '0.000';
--> statement-breakpoint
ALTER TABLE `products`         MODIFY `price`             DECIMAL(13,3);
--> statement-breakpoint
ALTER TABLE `rfqs`             MODIFY `budget`            DECIMAL(13,3);
--> statement-breakpoint
ALTER TABLE `rfqItems`         MODIFY `unitPriceSnapshot` DECIMAL(13,3);
--> statement-breakpoint
ALTER TABLE `serviceOfferings` MODIFY `priceMin`          DECIMAL(13,3);
--> statement-breakpoint
ALTER TABLE `serviceOfferings` MODIFY `priceMax`          DECIMAL(13,3);
--> statement-breakpoint
ALTER TABLE `expenses`         MODIFY `amount`            DECIMAL(13,3) NOT NULL;
