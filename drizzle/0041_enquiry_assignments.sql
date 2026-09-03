-- ── WHO IS HANDLING THIS ENQUIRY ─────────────────────────────────────────
--
-- A vendor enquiry has no table, and deliberately so: its STATE is derived
-- from the invitation, the allowance consumption and the quotation, and a
-- second copy of that would let the Admin view and the vendor view disagree.
--
-- An ASSIGNMENT is different in kind. Nothing in the domain records which
-- administrator is working an enquiry - it cannot be derived from any existing
-- row, because no existing row is about the platform's own operators. It is
-- genuinely new state, so it gets storage. Refusing a table here would mean
-- either inventing a derivation that does not exist or writing the assignment
-- into a column that means something else.
--
-- APPEND-ONLY, like every other trail in this schema. The current assignee is
-- the assigneeId of the most recent row for the pair; a NULL assigneeId is an
-- unassignment, which is a real event and not an absence. That gives the whole
-- history with no second table and no unique-index trick, and it means an
-- assignment record outlives the administrator who made it.
CREATE TABLE `enquiryAssignments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `rfqId` int NOT NULL,
  `vendorId` int NOT NULL,
  -- NULL = this event UNASSIGNED the enquiry. SET NULL on delete so the trail
  -- survives an administrator being removed, exactly as the audit tables do.
  `assigneeId` int,
  `actorId` int,
  `note` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `enquiryAssignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- The read this table exists for: the latest row for one pair, and the latest
-- row for each of a page of pairs.
CREATE INDEX `enquiryAssignments_pair_idx` ON `enquiryAssignments` (`rfqId`,`vendorId`,`id`);
--> statement-breakpoint
CREATE INDEX `enquiryAssignments_assignee_idx` ON `enquiryAssignments` (`assigneeId`);
--> statement-breakpoint
ALTER TABLE `enquiryAssignments` ADD CONSTRAINT `enquiryAssignments_rfqId_rfqs_id_fk` FOREIGN KEY (`rfqId`) REFERENCES `rfqs`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `enquiryAssignments` ADD CONSTRAINT `enquiryAssignments_vendorId_users_id_fk` FOREIGN KEY (`vendorId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `enquiryAssignments` ADD CONSTRAINT `enquiryAssignments_assigneeId_users_id_fk` FOREIGN KEY (`assigneeId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `enquiryAssignments` ADD CONSTRAINT `enquiryAssignments_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
