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
-- Referral code and attribution ledger. Rewards are non-cash and resolved
-- through the existing entitlement/promotion engines, never a payment table.
ALTER TABLE `users` ADD `referralCode` varchar(32) NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD UNIQUE KEY `users_referralCode_unique` (`referralCode`);
--> statement-breakpoint
CREATE TABLE `referrals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `referrerId` int NOT NULL,
  `referredId` int NOT NULL,
  `code` varchar(32) NOT NULL,
  `status` enum('registered', 'qualified', 'rewarded', 'expired', 'revoked') NOT NULL DEFAULT 'registered',
  `rewardType` enum('qualified_enquiry_credit', 'featured_placement', 'subscription_extension') NULL,
  `rewardValue` varchar(100) NULL,
  `rewardExpiresAt` timestamp NULL,
  `revokedAt` timestamp NULL,
  `revokedReason` varchar(500) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `referrals_referred_unique` (`referredId`),
  KEY `referrals_referrer_idx` (`referrerId`),
  KEY `referrals_status_idx` (`status`),
  CONSTRAINT `referrals_referrerId_users_id_fk`
    FOREIGN KEY (`referrerId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `referrals_referredId_users_id_fk`
    FOREIGN KEY (`referredId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
);
