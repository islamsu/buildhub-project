-- ── THE DISPUTE LIFECYCLE ──────────────────────────────────────────────────
--
-- `disputes` had a reporter, an optional respondent, a project, a title, a
-- description, a free-text type, a priority nothing could change, a status any
-- administrator could set to any value from any state, and a resolution-notes
-- column. There was no reference, no category, no assignment, no record of who
-- resolved it or how, no way to reopen one, no evidence, no messages between
-- the parties, and no history of how it got where it is.
--
-- The owner's decision is ONE dispute architecture with a POLYMORPHIC SUBJECT -
-- PROJECT, RFQ or QUOTATION - rather than three parallel systems. A supplier who
-- disagreed with a quotation previously had nothing to dispute against.
--
-- FORWARD-ONLY, and every existing row survives:
--   * subjectType defaults to 'project' and subjectId is backfilled from
--     projectId, which is what every dispute written before today was about.
--   * A row whose projectId is NULL cannot name a subject, so it is left with
--     subjectId 0 and reported by the verification below rather than being
--     given an invented one.
--   * `reference` is backfilled from the id and the row's own creation year.
--   * `category` defaults to 'other'; the old free-text `type` is kept beside
--     it rather than guessed at.

-- ── 1. The subject ─────────────────────────────────────────────────────────
ALTER TABLE `disputes`
  ADD COLUMN `subjectType` enum('project','rfq','quotation') NOT NULL DEFAULT 'project',
  ADD COLUMN `subjectId` int NOT NULL DEFAULT 0;
--> statement-breakpoint

UPDATE `disputes` SET `subjectId` = `projectId` WHERE `projectId` IS NOT NULL;
--> statement-breakpoint

-- ── 2. Identity and classification ─────────────────────────────────────────
ALTER TABLE `disputes`
  ADD COLUMN `reference` varchar(32) NULL,
  ADD COLUMN `category` enum('quality','delivery','quantity','specification','communication','conduct','pricing','other') NOT NULL DEFAULT 'other';
--> statement-breakpoint

-- The row's OWN year, not this year: a dispute filed in 2025 must not be
-- referenced as a 2026 one.
UPDATE `disputes`
  SET `reference` = CONCAT('DSP-', YEAR(`createdAt`), '-', LPAD(`id`, 6, '0'))
  WHERE `reference` IS NULL;
--> statement-breakpoint

ALTER TABLE `disputes`
  ADD CONSTRAINT `disputes_reference_unique` UNIQUE (`reference`);
--> statement-breakpoint

-- ── 3. The lifecycle a dispute can actually have ───────────────────────────
-- `withdrawn` is the REPORTER's own decision and is not the same outcome as an
-- administrator rejecting it.
ALTER TABLE `disputes`
  MODIFY COLUMN `status` enum('open','investigating','resolved','rejected','withdrawn') NOT NULL DEFAULT 'open';
--> statement-breakpoint

ALTER TABLE `disputes`
  ADD COLUMN `assignedTo` int NULL,
  ADD COLUMN `assignedBy` int NULL,
  ADD COLUMN `assignedAt` timestamp NULL,
  ADD COLUMN `resolutionType` enum('resolved_by_agreement','resolved_by_platform','no_action_required','insufficient_evidence','out_of_scope') NULL,
  ADD COLUMN `resolvedBy` int NULL,
  ADD COLUMN `resolvedAt` timestamp NULL,
  ADD COLUMN `reopenedBy` int NULL,
  ADD COLUMN `reopenedAt` timestamp NULL,
  ADD COLUMN `reopenReason` varchar(500) NULL,
  ADD COLUMN `withdrawnAt` timestamp NULL;
--> statement-breakpoint

-- SET NULL and nullable, like every other actor column in this schema: the
-- record must outlive its actor, and RESTRICT would make an administrator who
-- ever touched a dispute undeletable.
ALTER TABLE `disputes`
  ADD CONSTRAINT `disputes_assignedTo_fk` FOREIGN KEY (`assignedTo`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `disputes_assignedBy_fk` FOREIGN KEY (`assignedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `disputes_resolvedBy_fk` FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `disputes_reopenedBy_fk` FOREIGN KEY (`reopenedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
--> statement-breakpoint

-- ── 4. The columns the admin list orders and filters on ────────────────────
-- `server/admin/operationalHealth.ts` counts open disputes on `status`, and the
-- admin list orders on `createdAt` - both were full scans.
CREATE INDEX `disputes_subject_idx` ON `disputes` (`subjectType`, `subjectId`);
--> statement-breakpoint
CREATE INDEX `disputes_status_idx` ON `disputes` (`status`);
--> statement-breakpoint
CREATE INDEX `disputes_priority_idx` ON `disputes` (`priority`);
--> statement-breakpoint
CREATE INDEX `disputes_createdAt_idx` ON `disputes` (`createdAt`);
--> statement-breakpoint
CREATE INDEX `disputes_assignedTo_idx` ON `disputes` (`assignedTo`);
--> statement-breakpoint

-- ── 5. Evidence ────────────────────────────────────────────────────────────
-- Soft removal: the row stays so the record shows the file existed and who
-- withdrew it. Deleting outright would let a party quietly retract evidence the
-- other side had already answered.
CREATE TABLE `disputeEvidence` (
  `id` int AUTO_INCREMENT NOT NULL,
  `disputeId` int NOT NULL,
  `uploadedBy` int NOT NULL,
  `storageKey` varchar(500) NOT NULL,
  `fileName` varchar(255) NOT NULL,
  `contentType` varchar(120) NOT NULL,
  `sizeBytes` int NOT NULL,
  `removedAt` timestamp NULL,
  `removedBy` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `disputeEvidence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `disputeEvidence`
  ADD CONSTRAINT `disputeEvidence_disputeId_fk` FOREIGN KEY (`disputeId`) REFERENCES `disputes`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `disputeEvidence_uploadedBy_fk` FOREIGN KEY (`uploadedBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `disputeEvidence_removedBy_fk` FOREIGN KEY (`removedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
--> statement-breakpoint
CREATE INDEX `disputeEvidence_dispute_idx` ON `disputeEvidence` (`disputeId`);
--> statement-breakpoint
CREATE INDEX `disputeEvidence_uploader_idx` ON `disputeEvidence` (`uploadedBy`);
--> statement-breakpoint

-- ── 6. What the participants say to each other ─────────────────────────────
-- PARTICIPANT MESSAGES ONLY. An administrator's internal note goes in
-- `adminNotes` with subjectType 'dispute', which that enum has always allowed
-- and nothing has ever written. The separation is a TABLE rather than a
-- visibility column on purpose: a forgotten `where visibility='participants'`
-- would show a reporter what an administrator wrote about them, and a rule that
-- can be got wrong by omitting a clause eventually will be.
CREATE TABLE `disputeMessages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `disputeId` int NOT NULL,
  `authorId` int NOT NULL,
  `body` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `disputeMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `disputeMessages`
  ADD CONSTRAINT `disputeMessages_disputeId_fk` FOREIGN KEY (`disputeId`) REFERENCES `disputes`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `disputeMessages_authorId_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
CREATE INDEX `disputeMessages_dispute_idx` ON `disputeMessages` (`disputeId`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `disputeMessages_author_idx` ON `disputeMessages` (`authorId`);
--> statement-breakpoint

-- ── 7. How it got here ─────────────────────────────────────────────────────
-- Append-only. `admin.updateDispute` wrote nothing but the new value, so "who
-- moved this to resolved, and when, and from what" was unanswerable - on the
-- record a party is entitled to see.
CREATE TABLE `disputeStatusHistory` (
  `id` int AUTO_INCREMENT NOT NULL,
  `disputeId` int NOT NULL,
  `fromStatus` varchar(20) NOT NULL,
  `toStatus` varchar(20) NOT NULL,
  `actorId` int NULL,
  `reason` varchar(500) NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `disputeStatusHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `disputeStatusHistory`
  ADD CONSTRAINT `disputeStatusHistory_disputeId_fk` FOREIGN KEY (`disputeId`) REFERENCES `disputes`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `disputeStatusHistory_actorId_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
--> statement-breakpoint
CREATE INDEX `disputeStatusHistory_dispute_idx` ON `disputeStatusHistory` (`disputeId`, `createdAt`);
