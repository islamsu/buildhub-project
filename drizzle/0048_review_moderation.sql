-- ── REVIEWS: RIGHT OF REPLY, REPORTING, AND MODERATION ──────────────────────
--
-- Forward-only. What already worked is untouched: eligibility from a real
-- BuildHub relationship, self-review refused, duplicates refused, and the
-- rating DERIVED live rather than stored.
--
-- What this adds is the half that was missing. A reputation system where the
-- subject cannot answer and the platform cannot moderate is not a reputation
-- system, it is a publishing channel pointed at one party.
--
-- HIDDEN, NEVER DELETED. Moderation sets hiddenAt; the row survives so the
-- reviewer keeps their record, the moderator's decision stays reviewable, and
-- an average never changes with no explanation behind it.
ALTER TABLE `reviews` ADD COLUMN `hiddenAt` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `reviews` ADD COLUMN `hiddenBy` int NULL;
--> statement-breakpoint
ALTER TABLE `reviews` ADD COLUMN `hiddenReason` varchar(500) NULL;
--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_hiddenBy_users_id_fk` FOREIGN KEY (`hiddenBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
CREATE TABLE `reviewResponses` (
  `id` int AUTO_INCREMENT NOT NULL,
  `reviewId` int NOT NULL,
  `authorId` int NOT NULL,
  `body` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `reviewResponses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviewResponses_review_unique` ON `reviewResponses` (`reviewId`);
--> statement-breakpoint
CREATE INDEX `reviewResponses_author_idx` ON `reviewResponses` (`authorId`);
--> statement-breakpoint
ALTER TABLE `reviewResponses` ADD CONSTRAINT `reviewResponses_reviewId_reviews_id_fk` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `reviewResponses` ADD CONSTRAINT `reviewResponses_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE TABLE `reviewReports` (
  `id` int AUTO_INCREMENT NOT NULL,
  `reviewId` int NOT NULL,
  `reporterId` int NOT NULL,
  `reason` enum('abusive','off_topic','personal_data','not_a_customer','spam','other') NOT NULL,
  `detail` varchar(1000),
  `status` enum('open','upheld','rejected') NOT NULL DEFAULT 'open',
  `resolutionNote` varchar(1000),
  `resolvedBy` int,
  `resolvedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `reviewReports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviewReports_review_reporter_unique` ON `reviewReports` (`reviewId`,`reporterId`);
--> statement-breakpoint
CREATE INDEX `reviewReports_status_idx` ON `reviewReports` (`status`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `reviewReports_review_idx` ON `reviewReports` (`reviewId`);
--> statement-breakpoint
ALTER TABLE `reviewReports` ADD CONSTRAINT `reviewReports_reviewId_reviews_id_fk` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `reviewReports` ADD CONSTRAINT `reviewReports_reporterId_users_id_fk` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `reviewReports` ADD CONSTRAINT `reviewReports_resolvedBy_users_id_fk` FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
