-- ── THE BUYER'S SHORTLIST ───────────────────────────────────────────────
--
-- PRODUCT_NORTH_STAR.md CURRENT GLOBAL RELEASE item 9; CLAUDE.md §22 names
-- the actions a buyer takes from discovery - save, compare, contact, Add to
-- RFQ, invite provider - and Save was the one with no implementation at all.
--
-- Sourcing a construction package is not a single sitting. A buyer comparing
-- eleven suppliers of porcelain tile over two days had nowhere to put the
-- four worth a second look, so the work of finding them was discarded every
-- time the tab closed. The RFQ basket is a commitment to ask for prices; it
-- is not a shortlist, and using it as one distorts what a supplier receives.
--
-- ONE TABLE FOR BOTH KINDS. A product and a provider are different records
-- and the same gesture, and the shortlist is read as one list far more often
-- than as two. Two tables would mean two readers, two counts and two chances
-- to disagree.
--
-- NO FOREIGN KEY ON itemId, deliberately, and this is the one judgement call
-- in the table. `itemKind` decides which table the id belongs to, and MySQL
-- cannot express a conditional reference. The alternatives were both worse:
-- two nullable columns with two FKs invites a row that points at both or
-- neither, and two tables duplicates every reader. Integrity is enforced on
-- the write path, which resolves the id against the right table before
-- inserting, and the readers JOIN - so a row whose target disappeared shows
-- up as absent rather than as a broken card.
--
-- userId IS RESTRICTed like every other owned record here: a shortlist is
-- evidence of what somebody was considering, and deleting the account is not
-- a reason to silently drop it while the audit trail still names them.
--
-- THE UNIQUE INDEX IS THE TOGGLE. Save is idempotent by construction: a
-- second save of the same thing is the same row, not a second one, so a
-- double-tap on a phone cannot produce a list with duplicates in it.

CREATE TABLE `savedItems` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `userId` INT NOT NULL,
  `itemKind` ENUM('product','provider') NOT NULL,
  `itemId` INT NOT NULL,
  `note` VARCHAR(500),
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `savedItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `savedItems`
  ADD CONSTRAINT `savedItems_userId_users_id_fk`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX `savedItems_user_item_unique` ON `savedItems` (`userId`, `itemKind`, `itemId`);
--> statement-breakpoint
-- The shortlist page reads one user's rows newest first; the badge counts
-- them. Both lead with userId.
CREATE INDEX `savedItems_user_created_idx` ON `savedItems` (`userId`, `createdAt`);
