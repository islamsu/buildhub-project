-- ── A PUBLIC SURFACE WITH NO REMEDY ──────────────────────────────────────
--
-- `productQuestions` had three surfaces - list, ask, answer - and no way for
-- anybody to act on what was published. A question carrying abuse, a third
-- party's phone number or a competitor's contact details sat on a supplier's
-- product page permanently: the supplier could not remove it, and neither
-- could an administrator. Reviews have had a report-and-resolve queue for some
-- time. Questions had nothing.
--
-- This is the missing half, built on the SAME lifecycle as review moderation
-- rather than as a second system with its own rules.
--
-- ── HIDDEN, NEVER DELETED ────────────────────────────────────────────────
--
-- Nothing here removes a row. Hiding stops content rendering publicly and
-- leaves it fully auditable, because the author wrote something real, an
-- administrator's decision has to be reviewable afterwards, and evidence that
-- is destroyed cannot be weighed if the decision is challenged. Every foreign
-- key below is RESTRICT for that reason: moderation evidence must not vanish
-- because a product or an account was removed.
--
-- ── THE TWO HALVES ARE MODERATED SEPARATELY ──────────────────────────────
--
-- A question and its answer are written by different people and go wrong
-- independently: a reasonable question can get an abusive reply, and an
-- abusive question can get a patient one. Hiding one must not hide the other,
-- so each carries its own hidden columns rather than sharing one flag.
--
-- ── AN ANSWER MAY BE CORRECTED, AND THE PREVIOUS TEXT IS KEPT ────────────
--
-- The old rule was write-once, so a supplier who mistyped a dimension could
-- never fix it and the wrong answer stayed public forever. But an editable
-- public answer is also a way to rewrite history - answer "yes, we ship to
-- Alexandria", take the order, quietly change it to "no". Every previous
-- version is preserved in its own table, so an edit is a correction and never
-- an erasure.

ALTER TABLE `productQuestions`
  ADD COLUMN `hiddenAt` timestamp NULL,
  ADD COLUMN `hiddenBy` int NULL,
  ADD COLUMN `hiddenReason` varchar(500) NULL,
  ADD COLUMN `answerHiddenAt` timestamp NULL,
  ADD COLUMN `answerHiddenBy` int NULL,
  ADD COLUMN `answerHiddenReason` varchar(500) NULL,
  ADD COLUMN `answerEditedAt` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `productQuestions`
  ADD CONSTRAINT `productQuestions_hiddenBy_users_id_fk`
  FOREIGN KEY (`hiddenBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `productQuestions`
  ADD CONSTRAINT `productQuestions_answerHiddenBy_users_id_fk`
  FOREIGN KEY (`answerHiddenBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX `productQuestions_hiddenAt_idx` ON `productQuestions` (`hiddenAt`);
--> statement-breakpoint

-- Every answer this question has ever carried, in order. The row that is
-- CURRENT lives on productQuestions.answer; this table holds what it replaced.
CREATE TABLE `productAnswerRevisions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `questionId` int NOT NULL,
  `answer` text NOT NULL,
  -- When the replaced answer was originally published, so the record shows how
  -- long the superseded text was the public answer.
  `answeredAt` timestamp NULL,
  `replacedAt` timestamp NOT NULL DEFAULT (now()),
  `replacedBy` int NOT NULL,
  CONSTRAINT `productAnswerRevisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `productAnswerRevisions`
  ADD CONSTRAINT `productAnswerRevisions_questionId_productQuestions_id_fk`
  FOREIGN KEY (`questionId`) REFERENCES `productQuestions`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `productAnswerRevisions`
  ADD CONSTRAINT `productAnswerRevisions_replacedBy_users_id_fk`
  FOREIGN KEY (`replacedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX `productAnswerRevisions_questionId_idx` ON `productAnswerRevisions` (`questionId`);
--> statement-breakpoint

-- Reports, shaped like reviewReports deliberately: same states, same
-- resolution columns, same "a resolution note is part of the record" rule. A
-- moderator working both queues meets one decision, not two.
CREATE TABLE `productQuestionReports` (
  `id` int AUTO_INCREMENT NOT NULL,
  `questionId` int NOT NULL,
  -- Which half of the exchange. Reporting "the exchange" would force a
  -- moderator to hide both to act on either.
  `target` enum('question','answer') NOT NULL,
  `reporterId` int NOT NULL,
  `reason` enum('abusive','personal_data','off_platform','competitor','not_a_question','spam','other') NOT NULL,
  `detail` varchar(1000) NULL,
  `status` enum('open','upheld','rejected') NOT NULL DEFAULT 'open',
  `resolutionNote` varchar(1000) NULL,
  `resolvedBy` int NULL,
  `resolvedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `productQuestionReports_id` PRIMARY KEY(`id`),
  -- One open report per person per target. A reporter clicking twice is not
  -- two reports, and letting it become two drowns the queue it feeds.
  CONSTRAINT `productQuestionReports_unique_reporter`
    UNIQUE(`questionId`,`target`,`reporterId`)
);
--> statement-breakpoint
ALTER TABLE `productQuestionReports`
  ADD CONSTRAINT `productQuestionReports_questionId_productQuestions_id_fk`
  FOREIGN KEY (`questionId`) REFERENCES `productQuestions`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `productQuestionReports`
  ADD CONSTRAINT `productQuestionReports_reporterId_users_id_fk`
  FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `productQuestionReports`
  ADD CONSTRAINT `productQuestionReports_resolvedBy_users_id_fk`
  FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX `productQuestionReports_status_idx` ON `productQuestionReports` (`status`);
--> statement-breakpoint
CREATE INDEX `productQuestionReports_questionId_idx` ON `productQuestionReports` (`questionId`);
