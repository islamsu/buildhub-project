-- MIGRATION DELIMITERS. drizzle-kit hands each migration file to the driver as
-- ONE query unless its statements are separated by the breakpoint marker used
-- throughout this directory, and MySQL/MariaDB reject a multi-statement query
-- outright. Without those markers this file failed on its SECOND statement and
-- never applied - taking the migrations after it down too, since the runner
-- stops at the first failure. Adding them is not rewriting applied history:
-- this file had never successfully run anywhere, so there is nothing applied
-- to rewrite.
--
-- (The marker itself is deliberately not quoted in this comment: the splitter
-- matches that text ANYWHERE in the file, comments included, and naming it
-- here cut this very note in half.)
-- Referral campaigns and a proper reward ledger. Forward-only; does not
-- rewrite 0037_referrals.sql.
CREATE TABLE `referralCampaigns` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `status` enum('draft', 'active', 'paused', 'ended') NOT NULL DEFAULT 'draft',
  `startsAt` timestamp NULL,
  `endsAt` timestamp NULL,
  `eligibleInviterRoles` text NOT NULL,
  `eligibleReferredRoles` text NOT NULL,
  `qualificationType` enum('ACCOUNT_VERIFIED', 'PROVIDER_APPROVED', 'PROFILE_COMPLETED', 'FIRST_VALID_RFQ', 'FIRST_VALID_QUOTATION_RESPONSE') NOT NULL,
  `rewardType` enum('EXTRA_QUALIFIED_ENQUIRIES', 'TEMPORARY_FEATURED', 'SUBSCRIPTION_EXTENSION') NOT NULL,
  `rewardValue` varchar(100) NOT NULL,
  `rewardDurationDays` int NULL,
  `perInviterCap` int NOT NULL DEFAULT 1,
  `campaignCap` int NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `referralCampaigns_status_idx` (`status`),
  KEY `referralCampaigns_createdBy_idx` (`createdBy`),
  CONSTRAINT `referralCampaigns_createdBy_users_id_fk`
    FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `referralRewards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `referralId` int NOT NULL,
  `campaignId` int NOT NULL,
  `recipientUserId` int NOT NULL,
  `rewardType` enum('EXTRA_QUALIFIED_ENQUIRIES', 'TEMPORARY_FEATURED', 'SUBSCRIPTION_EXTENSION') NOT NULL,
  `rewardValue` varchar(100) NOT NULL,
  `source` varchar(40) NOT NULL DEFAULT 'REFERRAL_REWARD',
  `status` enum('PENDING', 'GRANTED', 'EXPIRED', 'REVERSED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `effectiveFrom` timestamp NULL,
  `expiresAt` timestamp NULL,
  `grantedAt` timestamp NULL,
  `reversedAt` timestamp NULL,
  `reversalReason` varchar(500) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `referralRewards_referral_campaign_unique` (`referralId`, `campaignId`),
  KEY `referralRewards_recipient_idx` (`recipientUserId`),
  KEY `referralRewards_status_idx` (`status`),
  CONSTRAINT `referralRewards_referralId_referrals_id_fk`
    FOREIGN KEY (`referralId`) REFERENCES `referrals` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `referralRewards_campaignId_referralCampaigns_id_fk`
    FOREIGN KEY (`campaignId`) REFERENCES `referralCampaigns` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `referralRewards_recipientUserId_users_id_fk`
    FOREIGN KEY (`recipientUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
);
--> statement-breakpoint
ALTER TABLE `referrals`
  ADD `campaignId` int NULL,
  ADD `qualificationType` enum('ACCOUNT_VERIFIED', 'PROVIDER_APPROVED', 'PROFILE_COMPLETED', 'FIRST_VALID_RFQ', 'FIRST_VALID_QUOTATION_RESPONSE') NULL,
  ADD `qualificationEventKey` varchar(191) NULL,
  ADD `qualifiedAt` timestamp NULL,
  ADD `qualificationNote` varchar(500) NULL,
  ADD UNIQUE KEY `referrals_qualification_event_unique` (`qualificationEventKey`),
  ADD KEY `referrals_campaign_idx` (`campaignId`),
  ADD CONSTRAINT `referrals_campaignId_referralCampaigns_id_fk`
    FOREIGN KEY (`campaignId`) REFERENCES `referralCampaigns` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
