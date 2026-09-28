-- ── FINISHING REQUESTS AND THE THREE QUOTATION PRICING STRATEGIES ─────────
--
-- FINISHING_AND_AI_CONTEXT.md is the authoritative behaviour; this is the
-- storage it needs. Additive throughout: one new child table, and new nullable
-- columns on two existing ones.
--
-- ── THE BACKFILL IS DELIBERATELY POOR, AND THAT IS THE HONEST ANSWER ──────
--
-- Every quotation written before this migration is a single stated number with
-- no recorded derivation. Nobody knows whether VAT was inside it, whether a
-- discount had been applied, or what the contractor was pricing per square
-- metre. So those rows are backfilled as method 'custom' - which is exactly
-- what they are, a quoted total - with every new component left NULL or zero.
--
-- The tempting alternative is to assume a VAT rate, or to infer a base from the
-- total. That would write invented commercial history into signed bids. A NULL
-- that reads "not stated" is worth more than a number nobody agreed to.
--
-- ── WIDENING quotations.price ─────────────────────────────────────────────
--
-- decimal(12,2) cannot represent a Kuwaiti dinar, a Bahraini dinar or an Omani
-- rial, all of which have three minor digits (shared/markets.ts). Those markets
-- are `enabled: false` and this migration does not change that - but the column
-- would have silently rounded the day one was enabled, which is the kind of
-- defect that is free to fix now and expensive to find later.
--
-- MySQL widening a DECIMAL's precision and scale is lossless: every existing
-- value is representable in the wider type unchanged. `price` REMAINS the one
-- authoritative payable total; no second total column is added, because two
-- totals is how they disagree.

-- ── The quotation's pricing strategy and its shared commercial fields ─────
ALTER TABLE `quotations`
  MODIFY `price` decimal(14,3) NOT NULL;

--> statement-breakpoint

ALTER TABLE `quotations`
  ADD COLUMN `pricingMethod` varchar(20) NOT NULL DEFAULT 'custom',
  -- The computed base, before discount, contingency, overhead and VAT. Stored
  -- so the total is explainable without recomputing it from parts that may
  -- have been edited since.
  ADD COLUMN `baseAmount` decimal(14,3) NULL,
  ADD COLUMN `discountAmount` decimal(14,3) NOT NULL DEFAULT 0,
  -- RATES, not amounts. Both apply to (base - discount) and never to each
  -- other; one column each means a figure cannot be stated two ways and
  -- disagree with itself.
  ADD COLUMN `contingencyRate` decimal(6,3) NULL,
  ADD COLUMN `overheadRate` decimal(6,3) NULL,
  -- NULL means "no VAT rate was stated". It is NOT 0, which is the different
  -- claim that the rate is zero.
  ADD COLUMN `vatRate` decimal(6,3) NULL,
  ADD COLUMN `vatAmount` decimal(14,3) NOT NULL DEFAULT 0,
  -- ── percentage: نسبة من تكلفة المواد ────────────────────────────────────
  ADD COLUMN `percentageRate` decimal(6,3) NULL,
  ADD COLUMN `materialBaseAmount` decimal(14,3) NULL,
  -- Which material values participate in the base, and what is excluded from
  -- it. Required disclosure: a percentage of an unstated base is not a price.
  ADD COLUMN `percentageBasisNote` text NULL,
  -- ── package: باقة تشطيب ─────────────────────────────────────────────────
  -- Free text, not an enum: the four suggested tiers are labels, not the only
  -- packages a contractor may ever sell.
  ADD COLUMN `packageTier` varchar(60) NULL,
  -- One of shared/serviceCatalogue.ts SERVICE_PRICING_BASES. A fixed-project
  -- package stores its amount as the rate with quantity 1, so the stored inputs
  -- always reproduce the displayed total.
  ADD COLUMN `packageBasis` varchar(30) NULL,
  ADD COLUMN `packageRate` decimal(14,3) NULL,
  ADD COLUMN `packageQuantity` decimal(12,2) NULL,
  -- Inclusions, exclusions, allowances, upgrades, assumptions, milestones,
  -- specifications, material level, included trades, labour inclusion. JSON
  -- because they are lists of the quoter's own words, of legitimately variable
  -- length, and are never computed on - only displayed and diffed.
  ADD COLUMN `scopeDetail` json NULL;

-- ── Detailed / BOQ lines ──────────────────────────────────────────────────
--
-- The QUOTATION side. `rfqItems` is the REQUEST side and is not duplicated
-- here: what a customer asked to be priced and what a contractor priced are
-- different records, and a contractor regularly prices work the customer did
-- not itemize.
--
-- Authorization is the quotation's, exactly: cascade on delete, and every read
-- goes through the same guard that returns the quotation.
--> statement-breakpoint

CREATE TABLE `quotationItems` (
  `id` int AUTO_INCREMENT NOT NULL,
  `quotationId` int NOT NULL,
  -- material | labor | equipment | subcontract | other. Direct costs only:
  -- overhead and profit are a rate on the whole, never a line, because a markup
  -- inside the lines and again on the total is the same markup charged twice.
  `component` varchar(20) NOT NULL DEFAULT 'material',
  -- The trade or category this line groups under, in the contractor's words.
  `tradeGroup` varchar(80) NULL,
  `description` varchar(255) NOT NULL,
  `quantity` decimal(12,3) NOT NULL,
  `unit` varchar(40) NULL,
  `rate` decimal(14,3) NOT NULL,
  -- quantity x rate, rounded to the currency's scale. Persisted so the printed
  -- lines add up to the printed subtotal; recomputed server-side on every
  -- write, never accepted from a client.
  `lineTotal` decimal(14,3) NOT NULL,
  `position` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `quotationItems_id` PRIMARY KEY(`id`)
);

--> statement-breakpoint

ALTER TABLE `quotationItems`
  ADD CONSTRAINT `quotationItems_quotationId_quotations_id_fk`
  FOREIGN KEY (`quotationId`) REFERENCES `quotations`(`id`)
  ON DELETE cascade ON UPDATE restrict;

--> statement-breakpoint

CREATE INDEX `quotationItems_quotationId_idx` ON `quotationItems` (`quotationId`);

-- ── The request side ──────────────────────────────────────────────────────
--> statement-breakpoint

ALTER TABLE `rfqs`
  -- percentage | package | detailed | provider_choice. NULL is a real and
  -- distinct state: "nothing was said" is not the same decision as "let the
  -- contractor propose", and publication never requires either.
  ADD COLUMN `pricingPreference` varchar(20) NULL,
  -- The structured finishing brief. JSON because it is progressive disclosure:
  -- a homeowner answers what they know, every field is optional, and several
  -- of them legitimately hold the explicit 'unknown' sentinel rather than a
  -- value. Validated against shared/finishing.ts on write.
  ADD COLUMN `finishingBrief` json NULL;
