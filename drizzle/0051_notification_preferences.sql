-- ── NOTIFICATION PREFERENCES ─────────────────────────────────────────────
--
-- A user could not turn any notification off. A supplier with forty listed
-- products got a notification for every question asked about any of them, and
-- the only remedy available was to stop reading the bell entirely - which also
-- silences the compliance decision sitting two rows below it.
--
-- ONLY OVERRIDES ARE STORED. A missing row means the category is ON, so:
--
--   * no backfill is needed, and every existing user keeps receiving exactly
--     what they receive today;
--   * a category added later is on for everybody without a data migration,
--     which is the safe direction - a new category that arrived switched off
--     would suppress messages nobody ever chose to suppress.
--
-- MANDATORY CATEGORIES ARE NOT REPRESENTABLE HERE. The server refuses to write
-- a suppression row for account, compliance, billing, disputes or moderation,
-- and the delivery gate ignores any such row a second time in case one ever
-- reaches the table by another route. The check is server-side in both places;
-- the locked control in the settings screen is a courtesy, not the control.
CREATE TABLE `notificationPreferences` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `category` varchar(40) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `notificationPreferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `notificationPreferences` ADD CONSTRAINT `notificationPreferences_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE restrict;
--> statement-breakpoint
-- One row per user per category: the uniqueness IS the model. Two rows for the
-- same pair would make "is this category on" a question with two answers, and
-- the delivery gate would pick whichever the database returned first.
CREATE UNIQUE INDEX `notificationPreferences_user_category_idx` ON `notificationPreferences` (`userId`,`category`);
