-- Referral code and attribution ledger. Rewards are non-cash and resolved
-- through the existing entitlement/promotion engines, never a payment table.
ALTER TABLE `users` ADD `referralCode` varchar(32) NULL;
ALTER TABLE `users` ADD UNIQUE KEY `users_referralCode_unique` (`referralCode`);

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
