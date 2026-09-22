-- ── THE REFERRAL CODE BECOMES A MANAGED OBJECT ──────────────────────────
--
-- `users.referralCode` has existed since sign-up first minted one, and that
-- is all it has ever been: a string issued once and never governed. There was
-- no way to stop a code that had been posted somewhere it should not have
-- been, no way to issue one to an account that somehow lacked one, no record
-- of who changed what, and no Admin screen over any of it. The owner named
-- Referral Codes as the missing Admin concept.
--
-- ONE ACTIVE CODE PER ACCOUNT. `users.referralCode` stays the single
-- authoritative lookup the sign-up attribution path reads, so there is no
-- second place a code can live and no chance of two codes attributing to the
-- same account. The lifecycle is expressed as state ON that column rather
-- than as a second table of codes.
--
--   referralCodeStatus     active | disabled. A disabled code attributes
--                          NOTHING: the sign-up lookup filters on it, so an
--                          already-printed link stops working rather than
--                          quietly continuing to earn.
--   referralCodeIssuedAt   when the current code was minted. A rotated code
--                          is a new code and gets a new timestamp, which is
--                          what makes "this link stopped working on the 4th"
--                          answerable.
--
-- HISTORY IS A SEPARATE TABLE, because the whole point of rotation is that
-- the old value is gone from `users` and somebody will still need to know
-- what it was. Every issue, rotation, disable and re-enable writes a row
-- naming the actor and the reason. `previousCode` is the string that stopped
-- working; it is NOT unique, because a code that was rotated away could in
-- principle be minted again by chance and history must record both.
--
-- FK RESTRICT on the actor and the subject, matching every other audit table
-- in this schema: an administrator's account cannot be deleted out from under
-- the record of what they did.
--
-- ADDITIVE AND BACKFILLED HONESTLY. Existing rows get status 'active', which
-- is exactly how they behaved before this migration, and a NULL issuedAt,
-- because the date a historic code was minted was never recorded and
-- inventing one would be worse than admitting it is unknown.

ALTER TABLE `users`
  ADD COLUMN `referralCodeStatus` ENUM('active','disabled') NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `users`
  ADD COLUMN `referralCodeIssuedAt` TIMESTAMP NULL;
--> statement-breakpoint
CREATE TABLE `referralCodeEvents` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `userId` INT NOT NULL,
  `action` ENUM('issued','rotated','disabled','reactivated') NOT NULL,
  `previousCode` VARCHAR(32),
  `newCode` VARCHAR(32),
  `reason` VARCHAR(500),
  `actorId` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `referralCodeEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `referralCodeEvents`
  ADD CONSTRAINT `referralCodeEvents_userId_users_id_fk`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `referralCodeEvents`
  ADD CONSTRAINT `referralCodeEvents_actorId_users_id_fk`
  FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX `referralCodeEvents_user_idx` ON `referralCodeEvents` (`userId`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `referralCodeEvents_previous_idx` ON `referralCodeEvents` (`previousCode`);
