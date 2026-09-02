-- MIGRATION DELIMITERS. drizzle-kit hands each migration file to the driver as
-- ONE query unless its statements are separated by the breakpoint marker used
-- throughout this directory, and MySQL/MariaDB reject a multi-statement query
-- outright. Without those markers this file failed on its SECOND statement and
-- never applied - taking the migrations after it down too, since the runner
-- stops at the first failure. Adding them is not rewriting applied history:
-- this file had never successfully run anywhere, so there is nothing applied
-- to rewrite.
--
-- (The marker itself is deliberately not quoted in this comment: the splitter
-- matches that text ANYWHERE in the file, comments included, and naming it
-- here cut this very note in half.)
-- Commercial placement architecture extension over the existing canonical
-- vendorSponsorships engine. Forward-only; does not rewrite earlier work.
ALTER TABLE `vendorSponsorships`
  ADD `source` varchar(40) NOT NULL DEFAULT 'ADMIN_EDITORIAL',
  ADD `package` varchar(40) NULL,
  ADD `surface` varchar(40) NULL,
  ADD `entityType` varchar(20) NOT NULL DEFAULT 'PROVIDER';
--> statement-breakpoint
CREATE INDEX `vendorSponsorships_package_surface_idx`
  ON `vendorSponsorships` (`package`, `surface`);
