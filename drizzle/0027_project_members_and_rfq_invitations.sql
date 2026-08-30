-- ── Project membership, project creator, and RFQ supplier invitations ──────
--
-- Three structural additions. None of them rewrites or deletes an existing row.
--
-- WHY: `projects` had exactly one person column, `ownerId`, and nothing else in
-- the schema connected a user to a project. Creator, owner, manager and
-- participant were not conflated - only one of them existed. `rfqs` likewise
-- had no way for a requester to ask a NAMED supplier to quote.
--
-- BACKFILL POLICY, stated because a backfill is an assertion about history:
--   * every existing project gets ONE membership row, its owner, as 'owner'.
--     That is not an invention - it is the only relationship the old schema
--     could express, restated in the new one.
--   * createdBy is set to ownerId for existing rows ONLY. Homeowner-only
--     creation was the rule in force when they were made, so for those rows
--     creator and owner are demonstrably the same person. New rows record the
--     real creator, which may differ.
--   * assignedBy on the backfilled membership is left NULL rather than guessed.
--     Nobody assigned these owners; they are owners by construction. Writing a
--     value there would fabricate an audit event that never happened.

CREATE TABLE `projectMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`projectRole` enum('owner','manager','contractor','architect','engineer','supplier','viewer') NOT NULL,
	`assignedBy` int,
	`assignedAt` timestamp NOT NULL DEFAULT (now()),
	`removedAt` timestamp,
	`removedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projectMembers_id` PRIMARY KEY(`id`),
	CONSTRAINT `projectMembers_projectId_userId_unique` UNIQUE(`projectId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `rfqSuppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rfqId` int NOT NULL,
	`supplierId` int NOT NULL,
	`invitedBy` int,
	`invitedAt` timestamp NOT NULL DEFAULT (now()),
	`status` enum('invited','viewed','responded','declined') NOT NULL DEFAULT 'invited',
	`viewedAt` timestamp,
	`respondedAt` timestamp,
	`declinedAt` timestamp,
	`deadline` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rfqSuppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `rfqSuppliers_rfqId_supplierId_unique` UNIQUE(`rfqId`,`supplierId`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `createdBy` int;
--> statement-breakpoint
ALTER TABLE `projectMembers` ADD CONSTRAINT `projectMembers_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `projectMembers` ADD CONSTRAINT `projectMembers_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `projectMembers` ADD CONSTRAINT `projectMembers_assignedBy_users_id_fk` FOREIGN KEY (`assignedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `projectMembers` ADD CONSTRAINT `projectMembers_removedBy_users_id_fk` FOREIGN KEY (`removedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `rfqSuppliers` ADD CONSTRAINT `rfqSuppliers_rfqId_rfqs_id_fk` FOREIGN KEY (`rfqId`) REFERENCES `rfqs`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `rfqSuppliers` ADD CONSTRAINT `rfqSuppliers_supplierId_users_id_fk` FOREIGN KEY (`supplierId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `rfqSuppliers` ADD CONSTRAINT `rfqSuppliers_invitedBy_users_id_fk` FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `projectMembers_userId_idx` ON `projectMembers` (`userId`);--> statement-breakpoint
CREATE INDEX `projectMembers_projectId_idx` ON `projectMembers` (`projectId`);--> statement-breakpoint
CREATE INDEX `rfqSuppliers_supplierId_idx` ON `rfqSuppliers` (`supplierId`);--> statement-breakpoint
CREATE INDEX `rfqSuppliers_rfqId_idx` ON `rfqSuppliers` (`rfqId`);--> statement-breakpoint

-- BACKFILL. Idempotent: re-running inserts nothing and rewrites nothing.
INSERT INTO `projectMembers` (`projectId`, `userId`, `projectRole`, `assignedBy`, `assignedAt`, `createdAt`)
SELECT p.`id`, p.`ownerId`, 'owner', NULL, p.`createdAt`, p.`createdAt`
FROM `projects` p
WHERE NOT EXISTS (
  SELECT 1 FROM `projectMembers` m WHERE m.`projectId` = p.`id` AND m.`userId` = p.`ownerId`
);--> statement-breakpoint
UPDATE `projects` SET `createdBy` = `ownerId` WHERE `createdBy` IS NULL;
