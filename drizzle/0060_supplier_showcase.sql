-- ── SUPPLIER SHOWCASE (CLAUDE.md §18) ─────────────────────────────────────
--
-- The supplier's own emphasis within their OWN storefront. Deliberately NOT a
-- row in `vendorSponsorships`: that table carries grantedBy, revokedAt,
-- startsAt/endsAt, priority, package and surface - all ADMIN decisions about
-- SHARED surfaces - and a showcase has none of them. Keeping it here means a
-- showcase row can never be read by the placement engine, which is the
-- property that stops a supplier granting themselves marketplace placement.
--
-- NO FOREIGN KEY ON `itemId`, for the same reason `savedItems` has none:
-- `itemKind` decides which table it points at and MySQL cannot express a
-- conditional reference. Integrity lives on the write path, which resolves the
-- id against the right table AND against the caller's ownership before
-- inserting, and the readers JOIN, so a vanished target reads as absent rather
-- than as a broken card.
CREATE TABLE `supplierShowcase` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `itemKind` enum('product','service','portfolio') NOT NULL,
  `itemId` int NOT NULL,
  -- The supplier's own ordering. Small integers, rewritten wholesale on save.
  `position` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `supplierShowcase_id` PRIMARY KEY(`id`),
  -- One slot per thing: a double-tap cannot spend two of six slots on one item.
  CONSTRAINT `supplierShowcase_user_item_unique` UNIQUE(`userId`,`itemKind`,`itemId`)
);
--> statement-breakpoint
CREATE INDEX `supplierShowcase_user_position_idx` ON `supplierShowcase` (`userId`,`position`);
--> statement-breakpoint
ALTER TABLE `supplierShowcase` ADD CONSTRAINT `supplierShowcase_userId_users_id_fk`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE restrict;
