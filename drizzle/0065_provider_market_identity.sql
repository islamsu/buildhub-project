-- ── A PROVIDER'S MARKET IS FOUR FACTS, NOT ONE ─────────────────────────────
--
-- Owner directive Phase 1. Before this migration a provider's geography was
-- `vendorProfiles.country`: one free-text VARCHAR(120), public, and used for
-- display. Approval was `users.onboardingStatus`: one global flag. Between them
-- there was no way to say the thing the GCC rollout depends on - that this
-- business is registered in Oman, mainly works in Oman, is willing to work in
-- Saudi Arabia, and has been approved by BuildHub in neither.
--
-- So approval was all-or-nothing and implicitly Egyptian, because Egypt's
-- requirement set is the only one configured. An approved provider was
-- therefore approvable everywhere the moment a second market opened, which is
-- the exact outcome the owner ruled out: approval in Egypt must NOT imply
-- approval in Saudi Arabia, UAE, Qatar, Kuwait, Bahrain or Oman, and approval
-- in a GCC market must not imply approval in Egypt.
--
-- THE FOUR FACTS, AND WHERE EACH ONE LIVES
--
--   legal / home country      vendorProfiles.legalCountryCode
--   primary operating market  vendorProfiles.primaryMarketCode
--   additional served markets providerMarkets rows
--   per-market approval       providerMarkets.status
--
-- WHY LEGAL COUNTRY IS NOT A MARKET CODE. A business may be registered in a
-- country BuildHub does not operate in and still serve a market it does. ISO
-- 3166-1 alpha-2 is the vocabulary, deliberately wider than `MarketCode`, and
-- the two are not interchangeable even where the letters coincide.
--
-- WHY PRIMARY IS A COLUMN AND NOT A FLAG ON THE CHILD ROWS. A boolean
-- `isPrimary` on providerMarkets can hold two primaries, and MySQL has no
-- partial unique index to stop it - the invariant would live only in
-- application code. A single column cannot be ambiguous. The remaining rule,
-- that the primary market must also be a served market, is an application
-- invariant with a test, which is a weaker guarantee than the schema but
-- applied to the weaker claim.
--
-- NOTHING IS PARSED OUT OF THE FREE-TEXT COLUMN. `vendorProfiles.country`
-- stays exactly as it is, still rendered where it was. `legalCountryCode` is
-- left NULL rather than inferred from it: "Egypt", "EG", "egypt", "Cairo,
-- Egypt" and a blank are all in there, and guessing a legal jurisdiction from
-- a display string is how a compliance decision gets made by a regex.
--
-- THE ONE BACKFILL THAT IS EVIDENCE, NOT ASSUMPTION
--
-- Every provider whose global onboarding status is `approved` gets a single
-- Egypt row at `approved`. That is not a guess about where they work; it is a
-- record of what the approval they already hold actually MEANT. It was granted
-- while Egypt was the only market BuildHub operated in, against the only
-- compliance requirement set that exists - exactly the reasoning 0058 used to
-- backfill market context, and exactly as narrow.
--
-- It is deliberately narrow in both directions. A provider physically in Oman
-- who holds this approval gets an Egypt row and nothing else, because nobody
-- has ever assessed them against Omani requirements - the approval they have is
-- the one they were given. And no non-approved provider gains a row, because
-- `not_started`, `under_review`, `update_required` and `rejected` each mean
-- something specific that an Egypt row would overwrite.
--
-- `primaryMarketCode` is NOT backfilled from this. An Egypt approval proves
-- BuildHub approved them for Egypt. It does not prove Egypt is where they
-- mainly work, and the Omani vendor who opened this workstream is the standing
-- proof that those are different claims.

ALTER TABLE `vendorProfiles`
  ADD COLUMN `legalCountryCode` VARCHAR(2) NULL AFTER `country`;
--> statement-breakpoint
ALTER TABLE `vendorProfiles`
  ADD COLUMN `primaryMarketCode` VARCHAR(2) NULL AFTER `legalCountryCode`;
--> statement-breakpoint

CREATE TABLE `providerMarkets` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `userId` INT NOT NULL,
  `marketCode` VARCHAR(2) NOT NULL,
  -- THE SAME FIVE STATES AS `users.onboardingStatus`, on purpose. A per-market
  -- approval is the same kind of decision as the global one, reviewed by the
  -- same people through the same queue, so a second vocabulary would only
  -- create a mapping nobody maintains.
  `status` ENUM('not_started','under_review','update_required','approved','rejected')
    NOT NULL DEFAULT 'not_started',
  `reviewerNote` TEXT,
  `reviewedBy` INT,
  `reviewedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `providerMarkets_id` PRIMARY KEY(`id`),
  CONSTRAINT `providerMarkets_userId_marketCode_unique` UNIQUE(`userId`,`marketCode`)
);
--> statement-breakpoint
ALTER TABLE `providerMarkets` ADD CONSTRAINT `providerMarkets_userId_users_id_fk`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `providerMarkets` ADD CONSTRAINT `providerMarkets_reviewedBy_users_id_fk`
  FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
-- DRIVES DISCOVERY in the market -> provider direction, which is the hot path
-- the canonical eligibility predicate will read.
CREATE INDEX `providerMarkets_market_status_idx` ON `providerMarkets` (`marketCode`,`status`);
--> statement-breakpoint

-- MARKET-SCOPED COMPLIANCE EVIDENCE. Nullable, because every existing document
-- was filed against a platform that had one market and no concept of scoping -
-- and a NULL here reads as "not market-scoped", which is what those rows are.
-- A document filed for a specific market from now on carries that market, so a
-- Saudi trade licence cannot be read as satisfying an Omani requirement.
ALTER TABLE `registrationDocuments`
  ADD COLUMN `marketCode` VARCHAR(2) NULL AFTER `documentType`;
--> statement-breakpoint
CREATE INDEX `registrationDocuments_market_idx`
  ON `registrationDocuments` (`userId`,`marketCode`);
--> statement-breakpoint

-- EVIDENCE-ONLY BACKFILL. See the header: this records what an existing global
-- approval already meant, and nothing more.
INSERT INTO `providerMarkets` (`userId`, `marketCode`, `status`, `reviewedAt`)
SELECT u.`id`, 'EG', 'approved', u.`onboardingReviewedAt`
FROM `users` u
WHERE u.`onboardingStatus` = 'approved'
  AND u.`userRole` IN ('contractor','supplier','engineer','architect','project_manager');
