-- ── THE CANONICAL PRODUCT CATEGORY TAXONOMY ────────────────────────────────
--
-- Before this, BuildHub had THREE unrelated product-category vocabularies and
-- no way for an administrator to change any of them:
--
--   shared/productCategories.ts        19 flat English strings; the write-path
--                                      validator for BOTH single product
--                                      creation and bulk import
--   client/src/lib/marketplaceData.ts  33 browse chips with slug, English,
--                                      Arabic and icon - sharing NO values with
--                                      the list above
--   shared/rfqCategories.ts            9 SERVICE categories for RFQ-to-vendor
--                                      matching (a separate, legitimate concern
--                                      that is NOT merged here)
--
-- The reported failure - "Waterproofing is not a BuildHub category" - was the
-- first list refusing a value that the second list has carried all along. The
-- deeper defect is that a shopper browsing a chip could never find a product,
-- because nothing could be listed under a chip's name.
--
-- `slug` is the identity. Display names are editable without breaking anything
-- that references a category, which is the whole point of not treating the
-- English label as the key.

CREATE TABLE `productCategories` (
  `id` int AUTO_INCREMENT NOT NULL,
  `slug` varchar(80) NOT NULL,
  `nameEn` varchar(120) NOT NULL,
  `nameAr` varchar(120) NOT NULL,
  -- PRODUCT, SERVICE or BOTH. Bulk product upload accepts PRODUCT and BOTH and
  -- refuses SERVICE, so a service-only category cannot be used to list goods.
  `scope` enum('PRODUCT','SERVICE','BOTH') NOT NULL DEFAULT 'PRODUCT',
  -- active   selectable for new listings
  -- hidden   not selectable, existing products keep it and stay readable
  -- archived hidden and retired from browse; still never deleted
  `status` enum('active','hidden','archived') NOT NULL DEFAULT 'active',
  `parentId` int,
  `sortOrder` int NOT NULL DEFAULT 0,
  `icon` varchar(16),
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `productCategories_id` PRIMARY KEY(`id`),
  CONSTRAINT `productCategories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
-- An alias is a controlled second name for ONE category. The unique index on
-- the normalized form is what makes resolution deterministic: two categories
-- cannot both claim "pools", so bulk upload can never silently pick one.
CREATE TABLE `productCategoryAliases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `categoryId` int NOT NULL,
  `alias` varchar(120) NOT NULL,
  `normalized` varchar(120) NOT NULL,
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `productCategoryAliases_id` PRIMARY KEY(`id`),
  CONSTRAINT `productCategoryAliases_normalized_unique` UNIQUE(`normalized`)
);
--> statement-breakpoint
ALTER TABLE `productCategories` ADD CONSTRAINT `productCategories_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `productCategories`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `productCategories` ADD CONSTRAINT `productCategories_createdBy_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
-- RESTRICT, deliberately: an alias must never outlive the category it resolves
-- to, or bulk upload would resolve a name to a row that is gone.
ALTER TABLE `productCategoryAliases` ADD CONSTRAINT `productCategoryAliases_categoryId_fk` FOREIGN KEY (`categoryId`) REFERENCES `productCategories`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `productCategoryAliases` ADD CONSTRAINT `productCategoryAliases_createdBy_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX `productCategories_status_idx` ON `productCategories` (`status`);
--> statement-breakpoint
CREATE INDEX `productCategories_scope_idx` ON `productCategories` (`scope`);
--> statement-breakpoint
CREATE INDEX `productCategories_parentId_idx` ON `productCategories` (`parentId`);
--> statement-breakpoint
CREATE INDEX `productCategories_sortOrder_idx` ON `productCategories` (`sortOrder`);
--> statement-breakpoint
CREATE INDEX `productCategoryAliases_categoryId_idx` ON `productCategoryAliases` (`categoryId`);
--> statement-breakpoint
-- Products keep their existing `category` varchar as the stored value AND gain
-- a canonical link. The varchar is not dropped in this migration: it is what
-- every existing row already holds, and forward-only means the column that
-- carries live data is retired only after everything reads the link instead.
ALTER TABLE `products` ADD `categoryId` int;
--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_categoryId_fk` FOREIGN KEY (`categoryId`) REFERENCES `productCategories`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX `products_categoryId_idx` ON `products` (`categoryId`);
