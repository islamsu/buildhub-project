-- ── SUPPORT TICKETS ─────────────────────────────────────────────────────────
--
-- Forward-only. A user-to-BuildHub channel, deliberately NOT the dispute table
-- with nullable columns: a dispute has a respondent and a commercial subject,
-- a support ticket has neither. See shared/supportTickets.ts.
--
-- Every foreign key follows this schema's existing RESTRICT convention, so a
-- ticket cannot be orphaned by deleting the person who raised it. The nullable
-- staff references (assignedTo, resolvedBy, closedBy, removedBy, actorId) are
-- SET NULL: the record of what happened must outlive the agent's account
-- without pretending nobody did it.

CREATE TABLE `supportTickets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `requesterId` int NOT NULL,
  `reference` varchar(32),
  `category` enum('account','billing','technical','marketplace','rfq','project','compliance','other') NOT NULL DEFAULT 'other',
  `subject` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `priority` enum('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  `status` enum('open','in_progress','awaiting_user','resolved','closed') NOT NULL DEFAULT 'open',
  `assignedTo` int,
  `assignedBy` int,
  `assignedAt` timestamp,
  `resolutionNotes` text,
  `resolvedBy` int,
  `resolvedAt` timestamp,
  `closedBy` int,
  `closedAt` timestamp,
  `lastUserReplyAt` timestamp,
  `lastStaffReplyAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `supportTickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `supportTickets_requester_idx` ON `supportTickets` (`requesterId`);
--> statement-breakpoint
CREATE INDEX `supportTickets_status_idx` ON `supportTickets` (`status`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `supportTickets_assigned_idx` ON `supportTickets` (`assignedTo`);
--> statement-breakpoint
CREATE INDEX `supportTickets_reference_idx` ON `supportTickets` (`reference`);
--> statement-breakpoint
ALTER TABLE `supportTickets` ADD CONSTRAINT `supportTickets_requesterId_users_id_fk` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `supportTickets` ADD CONSTRAINT `supportTickets_assignedTo_users_id_fk` FOREIGN KEY (`assignedTo`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `supportTickets` ADD CONSTRAINT `supportTickets_assignedBy_users_id_fk` FOREIGN KEY (`assignedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `supportTickets` ADD CONSTRAINT `supportTickets_resolvedBy_users_id_fk` FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `supportTickets` ADD CONSTRAINT `supportTickets_closedBy_users_id_fk` FOREIGN KEY (`closedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
CREATE TABLE `supportTicketMessages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `ticketId` int NOT NULL,
  `authorId` int NOT NULL,
  `authorSide` enum('user','support') NOT NULL,
  `body` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `supportTicketMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `supportTicketMessages_ticket_idx` ON `supportTicketMessages` (`ticketId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `supportTicketMessages_author_idx` ON `supportTicketMessages` (`authorId`);
--> statement-breakpoint
ALTER TABLE `supportTicketMessages` ADD CONSTRAINT `supportTicketMessages_ticketId_supportTickets_id_fk` FOREIGN KEY (`ticketId`) REFERENCES `supportTickets`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `supportTicketMessages` ADD CONSTRAINT `supportTicketMessages_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE TABLE `supportTicketAttachments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `ticketId` int NOT NULL,
  `uploadedBy` int NOT NULL,
  `storageKey` varchar(500) NOT NULL,
  `fileName` varchar(255) NOT NULL,
  `contentType` varchar(120) NOT NULL,
  `sizeBytes` int NOT NULL,
  `removedAt` timestamp,
  `removedBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `supportTicketAttachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `supportTicketAttachments_ticket_idx` ON `supportTicketAttachments` (`ticketId`);
--> statement-breakpoint
ALTER TABLE `supportTicketAttachments` ADD CONSTRAINT `supportTicketAttachments_ticketId_supportTickets_id_fk` FOREIGN KEY (`ticketId`) REFERENCES `supportTickets`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `supportTicketAttachments` ADD CONSTRAINT `supportTicketAttachments_uploadedBy_users_id_fk` FOREIGN KEY (`uploadedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `supportTicketAttachments` ADD CONSTRAINT `supportTicketAttachments_removedBy_users_id_fk` FOREIGN KEY (`removedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
CREATE TABLE `supportTicketStatusHistory` (
  `id` int AUTO_INCREMENT NOT NULL,
  `ticketId` int NOT NULL,
  `fromStatus` varchar(20) NOT NULL,
  `toStatus` varchar(20) NOT NULL,
  `actorId` int,
  `reason` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `supportTicketStatusHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `supportTicketStatusHistory_ticket_idx` ON `supportTicketStatusHistory` (`ticketId`,`createdAt`);
--> statement-breakpoint
ALTER TABLE `supportTicketStatusHistory` ADD CONSTRAINT `supportTicketStatusHistory_ticketId_supportTickets_id_fk` FOREIGN KEY (`ticketId`) REFERENCES `supportTickets`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `supportTicketStatusHistory` ADD CONSTRAINT `supportTicketStatusHistory_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
-- Staff need somewhere to think out loud that the requester cannot read. The
-- existing adminNotes table already serves six subject types, so this adds the
-- seventh rather than creating a second internal-notes system.
ALTER TABLE `adminNotes` MODIFY COLUMN `subjectType` enum('user','vendor','project','rfq','quotation','dispute','support_ticket') NOT NULL;
