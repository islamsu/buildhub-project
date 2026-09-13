-- ── PRODUCT LIFECYCLE ────────────────────────────────────────────────────
--
-- `products.active` is a boolean, and a boolean can only say two things. A
-- product still being written, a product temporarily off sale, and a product
-- retired for good all read as active = 0, so a supplier's catalogue gave one
-- undifferentiated pile of "not live" rows.
--
-- FORWARD ONLY, and reversible by inspection. Every existing row is backfilled
-- from the boolean it already has: active = 1 becomes 'active', active = 0
-- becomes 'inactive'. No existing product is silently promoted or retired -
-- 'inactive' is the honest reading of a delisted row, because nothing in the
-- old model recorded whether a supplier meant "for now" or "for good".
--
-- The boolean STAYS for one migration, derived from the status and written in
-- exactly one place (server/productLifecycle.ts). It is not a second
-- authoritative field; a test holds the two in agreement, and it is scheduled
-- for removal once nothing reads it.
ALTER TABLE `products` ADD COLUMN `status` enum('draft','active','inactive','archived') NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `statusChangedAt` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `archivedAt` timestamp NULL;
--> statement-breakpoint
UPDATE `products` SET `status` = CASE WHEN `active` = 1 THEN 'active' ELSE 'inactive' END;
--> statement-breakpoint
-- The marketplace, search, placements and every vendor page filter on status.
-- Without this index that becomes a scan of the whole catalogue on the busiest
-- read in the product.
CREATE INDEX `products_status_idx` ON `products` (`status`);
--> statement-breakpoint
CREATE INDEX `products_supplier_status_idx` ON `products` (`supplierId`,`status`);
