CREATE TABLE `commercialAuditEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorId` int,
	`ownerId` int,
	`subjectType` enum('rfq','quotation','product','document','enquiry','message') NOT NULL,
	`subjectId` int NOT NULL,
	`action` varchar(64) NOT NULL,
	`detail` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `commercialAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `commercialAuditEvents` ADD CONSTRAINT `commercialAuditEvents_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `commercialAuditEvents` ADD CONSTRAINT `commercialAuditEvents_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `commercialAuditEvents_subject_idx` ON `commercialAuditEvents` (`subjectType`,`subjectId`);--> statement-breakpoint
CREATE INDEX `commercialAuditEvents_actorId_idx` ON `commercialAuditEvents` (`actorId`);--> statement-breakpoint
CREATE INDEX `commercialAuditEvents_ownerId_idx` ON `commercialAuditEvents` (`ownerId`);--> statement-breakpoint
CREATE INDEX `commercialAuditEvents_createdAt_idx` ON `commercialAuditEvents` (`createdAt`);
