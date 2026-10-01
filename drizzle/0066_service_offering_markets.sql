-- ── ONE SERVICE, ONE OFFER PER MARKET ──────────────────────────────────────
--
-- Owner directive Phase 2. `serviceOfferings` held ONE price and ONE currency
-- per service, so the same provider offering the same work in three markets was
-- not representable at all - the owner's example (25.000 OMR/m2 alongside
-- 260.00 SAR/m2 alongside 250.00 AED/m2) had nowhere to go.
--
-- `serviceOfferingMarkets` is that place: one row per (service, market), each
-- an independently entered commercial offer. Changing the Saudi price cannot
-- touch the Omani one, because they are different rows.
--
-- ── WHY THERE IS NO CURRENCY COLUMN HERE ───────────────────────────────────
--
-- The owner's rule: prefer deriving currency server-side from authoritative
-- market where the architecture permits, and enforce consistency at writes only
-- if it must be stored. It does not have to be stored, so it is not.
--
-- A `currency` column beside `marketCode` can hold `OM` + `EGP`. Validation at
-- the write closes that in the paths that go through the validator and leaves it
-- open to every migration, admin script and future router that does not. With
-- no column there is no disagreement to prevent: the currency IS the market's,
-- read from the registry at the point of use, and `marketCode = 'OM', currency
-- = 'EGP'` is not a state the schema can represent.
--
-- The cost, recorded honestly: if a market ever redenominated its currency,
-- historical rows would re-read in the new one. That is a real but remote
-- concern, and it is the legacy column below - preserved, never rewritten -
-- that holds what the provider originally entered.
--
-- ── THE LEGACY CLASSIFICATION, AND WHY `currency = 'EGP'` PROVES NOTHING ───
--
-- Migration 0061 added `serviceOfferings.currency` with `DEFAULT 'EGP'`, and
-- reasoned that "every service offering in the database was created by a
-- provider in the one market BuildHub operates, priced in Egyptian pounds".
-- That blanket claim is false, and a real external user disproved it: a vendor
-- operating in Oman whose listing displayed EGP because the platform had no
-- other value to write. The column records what nobody contradicted, not what
-- anybody chose.
--
-- So `currency = 'EGP'` is NECESSARY and NEVER SUFFICIENT. Migrating every EGP
-- row into an authoritative Egypt offer would relabel that Omani vendor's
-- commercial intent - precisely what the owner forbade.
--
-- What CAN prove an Egypt offer is evidence that the business itself is
-- Egyptian. For an Egyptian business operating in BuildHub's only marketplace,
-- EGP was not a defaulted guess; it was the only thing the offer could have
-- meant, and the default happened to coincide with the fact. The available
-- evidence for that is a registration document of an EGYPTIAN instrument -
-- tax card, commercial registration, tax registration - that a human reviewer
-- APPROVED. Those legacy documents carry no market code because the column did
-- not exist, and Egypt is the only requirement set that has ever been
-- configured, so an approved one was approved against Egyptian requirements.
--
-- `vendorProfiles.country` is used only as a DISQUALIFIER, never as an
-- assertion. A free-text value naming somewhere other than Egypt removes a row
-- from the proven set; it is never read as establishing a market. Evidence here
-- can only ever shrink the proven set, which is the property that makes the
-- classifier safe to be wrong about.
--
--   PROVEN_EG              currency is EGP
--                      AND an approved legacy Egyptian registration document
--                      AND an approved Egypt row in providerMarkets
--                      AND the free-text country does not contradict Egypt
--
--   REMEDIATION_REQUIRED   everything else
--
-- A remediation row keeps its value and its original denomination in the
-- legacy columns, is never relabelled, never converted, and never published
-- into any market. The provider confirms or re-enters it before it becomes an
-- authoritative offer. The state is stored rather than recomputed so the
-- provider-facing prompt has something durable to read, and so the count can be
-- reported rather than re-derived differently by each caller.

CREATE TABLE `serviceOfferingMarkets` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `serviceOfferingId` INT NOT NULL,
  `marketCode` VARCHAR(2) NOT NULL,
  -- The offer's own commercial terms. Independent per market by construction:
  -- the basis may differ too, because "per square metre" in one market and
  -- "fixed project" in another are different offers, not one offer in two
  -- currencies.
  `pricingBasis` ENUM('quote_on_request','per_square_metre','per_linear_metre','per_unit','per_day','fixed_project')
    NOT NULL DEFAULT 'quote_on_request',
  `priceMin` DECIMAL(13,3) NULL,
  `priceMax` DECIMAL(13,3) NULL,
  -- A provider may hold an active Egypt offer and a draft Saudi one. Same
  -- vocabulary as the parent service's status, for the same reason the
  -- per-market approval reused the onboarding enum.
  `status` ENUM('draft','active','inactive','archived') NOT NULL DEFAULT 'draft',
  `statusChangedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `serviceOfferingMarkets_id` PRIMARY KEY(`id`),
  -- THE UNIQUENESS INVARIANT. One offer per service per market: a second row
  -- would mean two live prices for the same work in the same place, with
  -- nothing to say which one a buyer is being quoted.
  CONSTRAINT `serviceOfferingMarkets_service_market_unique` UNIQUE(`serviceOfferingId`,`marketCode`)
);
--> statement-breakpoint
ALTER TABLE `serviceOfferingMarkets`
  ADD CONSTRAINT `serviceOfferingMarkets_serviceOfferingId_fk`
  FOREIGN KEY (`serviceOfferingId`) REFERENCES `serviceOfferings`(`id`)
  ON DELETE cascade ON UPDATE restrict;
--> statement-breakpoint
-- Drives discovery in the market -> offer direction, which is what the
-- canonical eligibility predicate reads.
CREATE INDEX `serviceOfferingMarkets_market_status_idx`
  ON `serviceOfferingMarkets` (`marketCode`,`status`);
--> statement-breakpoint

-- THE DURABLE CLASSIFICATION. Default `remediation_required`: a row that the
-- classifier below does not positively prove is unproven, and the safe state is
-- the one a new column arrives in.
ALTER TABLE `serviceOfferings`
  ADD COLUMN `marketMigrationState` ENUM('proven_eg','remediation_required')
  NOT NULL DEFAULT 'remediation_required' AFTER `currency`;
--> statement-breakpoint

-- ── CLASSIFY ───────────────────────────────────────────────────────────────
UPDATE `serviceOfferings` so
SET so.`marketMigrationState` = 'proven_eg'
WHERE so.`currency` = 'EGP'
  AND EXISTS (
    SELECT 1 FROM `registrationDocuments` rd
    WHERE rd.`userId` = so.`providerId`
      AND rd.`status` = 'approved'
      AND rd.`marketCode` IS NULL
      AND rd.`documentType` IN ('tax_card','commercial_registration','tax_registration')
  )
  AND EXISTS (
    SELECT 1 FROM `providerMarkets` pm
    WHERE pm.`userId` = so.`providerId`
      AND pm.`marketCode` = 'EG'
      AND pm.`status` = 'approved'
  )
  AND NOT EXISTS (
    SELECT 1 FROM `vendorProfiles` vp
    WHERE vp.`userId` = so.`providerId`
      AND vp.`country` IS NOT NULL
      AND TRIM(vp.`country`) <> ''
      AND LOWER(TRIM(vp.`country`)) NOT IN ('egypt','eg','egy','مصر','arab republic of egypt','egypt arab republic')
  );
--> statement-breakpoint

-- ── CARRY THE PROVEN ROWS THROUGH ──────────────────────────────────────────
-- The owner's rule: the migration must not make valid existing Egypt services
-- disappear merely because the schema became multi-market. A proven row becomes
-- an authoritative Egypt offer carrying its own terms unchanged - the figures
-- are copied, not recomputed, and no currency is written because the market
-- determines it.
INSERT INTO `serviceOfferingMarkets`
  (`serviceOfferingId`, `marketCode`, `pricingBasis`, `priceMin`, `priceMax`, `status`, `statusChangedAt`)
SELECT so.`id`, 'EG', so.`pricingBasis`, so.`priceMin`, so.`priceMax`, so.`status`, so.`statusChangedAt`
FROM `serviceOfferings` so
WHERE so.`marketMigrationState` = 'proven_eg';
