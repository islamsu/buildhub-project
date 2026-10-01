-- ── A PRICE SNAPSHOT MUST SAY WHAT CURRENCY IT IS IN ──────────────────────
--
-- Owner directive, Phase 0 item 4. `rfqItems.unitPriceSnapshot` held money
-- with no denomination anywhere on the row.
--
-- It is written as `unitPriceSnapshot: product.price`, copied straight out of
-- the catalogue - and `products` carries its OWN `currency` column, set
-- independently of the RFQ's. So the number on an RFQ line and the currency a
-- reader would naturally attribute to it (the RFQ's transaction currency) come
-- from two different places that nothing kept in agreement. Today every row of
-- both is EGP, which is exactly why this was invisible: a product priced in AED
-- added to an Omani RFQ would render as an OMR figure, and no column would be
-- wrong - the currency simply was never recorded.
--
-- WHY THE COLUMN IS NOT CALLED `currency`
--
-- 0061 gave `serviceOfferings` a plain `currency`, and that is the convention
-- where a table's money is its own. Here it would be ambiguous in a way that
-- matters: an RFQ line sits under an RFQ that HAS a transaction currency, so
-- `rfqItems.currency` would read as that, and a reader would not know whether a
-- disagreement with the parent was a bug or a deliberate record. The name says
-- precisely which figure it denominates and nothing else.
--
-- BACKFILL IS EVIDENCE-ONLY, WHICH IS WHY IT IS NOT A SINGLE `SET`
--
-- The owner's rule: backfill only where the parent establishes denomination
-- with sufficient certainty, and where it cannot be proven, do not guess.
--
-- A snapshot's currency is PROVEN when the parent RFQ and the source product
-- agree - then both names for the figure are the same name, and there is
-- nothing to infer. It is NOT proven when they disagree: one of the two is
-- wrong and the migration cannot know which, so the row keeps a NULL currency
-- and reads as an undenominated historical figure, which is what it honestly
-- is. A `SET unitPriceSnapshotCurrency = 'EGP'` across the table would have
-- turned every such row into a confident Egyptian claim that no evidence
-- supports - the precise failure this whole workstream exists to prevent.
--
-- Lines with no snapshot (free-text requirements, `productId IS NULL`) need no
-- currency and are left NULL: there is no amount to denominate.
--
-- Scale matches the column it denominates: 0063 widened `unitPriceSnapshot` to
-- DECIMAL(13,3) so a three-digit currency survives storage.

ALTER TABLE `rfqItems`
  ADD COLUMN `unitPriceSnapshotCurrency` VARCHAR(3) NULL AFTER `unitPriceSnapshot`;
--> statement-breakpoint

-- PROVEN ONLY: the parent RFQ and the source product name the same currency.
UPDATE `rfqItems` AS ri
  JOIN `rfqs`     AS r ON r.id = ri.rfqId
  JOIN `products` AS p ON p.id = ri.productId
SET ri.`unitPriceSnapshotCurrency` = r.`currency`
WHERE ri.`unitPriceSnapshot` IS NOT NULL
  AND ri.`productId` IS NOT NULL
  AND p.`currency` IS NOT NULL
  AND r.`currency` = p.`currency`;
