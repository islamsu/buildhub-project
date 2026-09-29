-- ── EVERY COMMERCIAL RECORD SAYS WHICH MARKET IT BELONGS TO ─────────────
--
-- Egypt-first, not Egypt-locked. CLAUDE.md §86-87, GCC_SCALE_READINESS.md
-- §32-52.
--
-- BuildHub had no concept of a market. It had 'EGP' written into eleven
-- places, a free-text `location` on every RFQ, and - the one the owner named
-- directly - a QUOTATION CURRENCY TAKEN FROM THE SUPPLIER'S SUBSCRIPTION
-- PLAN. Those are not a missing feature. They are assumptions that would each
-- have to be hunted down separately the day a second country mattered, and
-- the quotation one is a wrong number shown to somebody deciding a bid.
--
-- THE FIVE FACTS THESE COLUMNS KEEP APART:
--
--   authentication   who you are                    (unchanged; one account)
--   active market    which marketplace you browse   (a preference, not here)
--   project / RFQ    where the requirement is       marketCode below
--   RFQ currency     what quotations must be in     currency below
--   subscription     what the supplier pays US      billingMarketCode below
--
-- projects.marketCode / .currency
--   WHERE THE WORK IS, and the currency its sourcing is denominated in. Set
--   at creation from the chosen market and visible before save.
--
-- rfqs.marketCode / .currency
--   WHERE THE REQUIREMENT MUST BE SUPPLIED, snapshotted onto the RFQ rather
--   than read through the project every time - a project RFQ inherits it at
--   creation, a standalone RFQ states it, and neither is reinterpreted later
--   because the project was edited. `currency` is the explicit commercial
--   source of truth that quotations inherit (§38, §39).
--
-- quotations.currency ALREADY EXISTS and is NOT redefined here. What changes
--   is where it comes from: the RFQ, resolved server-side, instead of the
--   supplier's BILLING_CURRENCY.
--
-- vendorSubscriptions.billingMarketCode
--   WHICH MARKET BUILDHUB BILLS THIS CONTRACT IN. Separate from every column
--   above, deliberately: a supplier registered in Egypt, billed in EGP, may
--   quote a Saudi RFQ in SAR, and no column should make those agree.
--
-- vendorSubscriptions.entitlementScope / .entitlementMarkets
--   WHERE THE BENEFIT APPLIES (§44C). GLOBAL today because there is one
--   market, so every existing row is correct as GLOBAL and nothing is
--   claimed that was not true. MARKET_SET carries its codes in the JSON
--   column beside it; the enquiry allowance will read this rather than infer
--   scope from currency (§47).
--
-- ADDITIVE AND BACKFILLED HONESTLY. No column is dropped or retyped and no
-- row is rewritten. Every default is 'EG' / 'EGP' / 'GLOBAL', which is
-- exactly what every existing row already meant when BuildHub operated in one
-- market - this migration writes down an assumption, it does not change one.
--
-- A MARKET IN A COLUMN IS NOT A LAUNCHED MARKET. Which codes may be selected
-- is decided by `enabled` in shared/markets.ts, behind the readiness gate.

ALTER TABLE `projects`
  ADD COLUMN `marketCode` VARCHAR(2) NOT NULL DEFAULT 'EG';
--> statement-breakpoint
ALTER TABLE `projects`
  ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'EGP';
--> statement-breakpoint
ALTER TABLE `rfqs`
  ADD COLUMN `marketCode` VARCHAR(2) NOT NULL DEFAULT 'EG';
--> statement-breakpoint
ALTER TABLE `rfqs`
  ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'EGP';
--> statement-breakpoint
ALTER TABLE `vendorSubscriptions`
  ADD COLUMN `billingMarketCode` VARCHAR(2) NOT NULL DEFAULT 'EG';
--> statement-breakpoint
ALTER TABLE `vendorSubscriptions`
  ADD COLUMN `entitlementScope` ENUM('GLOBAL','MARKET_SET') NOT NULL DEFAULT 'GLOBAL';
--> statement-breakpoint
ALTER TABLE `vendorSubscriptions`
  ADD COLUMN `entitlementMarkets` JSON;
--> statement-breakpoint
-- Supplier matching for a cross-border RFQ asks "which providers serve this
-- market?" before it asks anything else, so the market leads the index.
CREATE INDEX `rfqs_market_status_idx` ON `rfqs` (`marketCode`, `status`);
--> statement-breakpoint
CREATE INDEX `projects_market_idx` ON `projects` (`marketCode`);
