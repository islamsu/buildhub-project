-- Individual entitlement overrides (Part 46) and field-level value history
-- (Parts 42-44).
--
-- HAND-WRITTEN, like 0023-0025 before it. `drizzle-kit generate` re-emitted
-- commercialAuditEvents, rfqItems and quotations.attachments alongside the two
-- new tables, because no meta snapshot exists for those three hand-written
-- migrations and the diff therefore ran from 0022. Applying that output would
-- have failed on any database that has already run them. The 0026 snapshot it
-- wrote IS correct and is kept, so the next generate starts from the real
-- current schema.
CREATE TABLE `vendorEntitlementOverrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`entitlementKey` varchar(64) NOT NULL,
	`value` text NOT NULL,
	`previousValue` text,
	`reason` text,
	`actorId` int,
	`startsAt` timestamp NOT NULL DEFAULT (now()),
	`endsAt` timestamp NULL,
	`revokedAt` timestamp NULL,
	`revokedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vendorEntitlementOverrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fieldValueHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subjectType` enum('rfq','quotation','product','user','subscription') NOT NULL,
	`subjectId` int NOT NULL,
	`ownerId` int,
	`actorId` int,
	`field` varchar(64) NOT NULL,
	`oldValue` text,
	`newValue` text,
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fieldValueHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `vendorEntitlementOverrides` ADD CONSTRAINT `vendorEntitlementOverrides_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `vendorEntitlementOverrides` ADD CONSTRAINT `vendorEntitlementOverrides_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `vendorEntitlementOverrides` ADD CONSTRAINT `vendorEntitlementOverrides_revokedBy_users_id_fk` FOREIGN KEY (`revokedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `fieldValueHistory` ADD CONSTRAINT `fieldValueHistory_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `fieldValueHistory` ADD CONSTRAINT `fieldValueHistory_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `vendorEntitlementOverrides_userId_key_idx` ON `vendorEntitlementOverrides` (`userId`,`entitlementKey`);--> statement-breakpoint
CREATE INDEX `vendorEntitlementOverrides_actorId_idx` ON `vendorEntitlementOverrides` (`actorId`);--> statement-breakpoint
CREATE INDEX `vendorEntitlementOverrides_createdAt_idx` ON `vendorEntitlementOverrides` (`createdAt`);--> statement-breakpoint
CREATE INDEX `fieldValueHistory_subject_idx` ON `fieldValueHistory` (`subjectType`,`subjectId`);--> statement-breakpoint
CREATE INDEX `fieldValueHistory_ownerId_idx` ON `fieldValueHistory` (`ownerId`);--> statement-breakpoint
CREATE INDEX `fieldValueHistory_actorId_idx` ON `fieldValueHistory` (`actorId`);--> statement-breakpoint
CREATE INDEX `fieldValueHistory_createdAt_idx` ON `fieldValueHistory` (`createdAt`);
