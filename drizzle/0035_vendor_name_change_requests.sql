-- Vendor-controlled name change requests and admin direct name corrections.
-- One table for both, distinguished by `adminCorrection`, so the audit shape
-- is identical and no name change can bypass review when it must not.
CREATE TABLE `vendorNameChangeRequests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `field` enum('companyName', 'tradingName') NOT NULL,
  `currentValue` varchar(191) NULL,
  `requestedValue` varchar(191) NOT NULL,
  `reason` varchar(1000) NULL,
  `status` enum('pending', 'under_review', 'needs_information', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `reviewerId` int NULL,
  `reviewerNote` text NULL,
  `reviewedAt` timestamp NULL,
  `adminCorrection` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `vendorNameChangeRequests_userId_idx` (`userId`),
  KEY `vendorNameChangeRequests_status_idx` (`status`),
  CONSTRAINT `vendorNameChangeRequests_userId_users_id_fk`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `vendorNameChangeRequests_reviewerId_users_id_fk`
    FOREIGN KEY (`reviewerId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
);
