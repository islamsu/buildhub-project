-- ONE CURRENT QUOTATION PER SUPPLIER PER RFQ, WITH REVISION HISTORY.
-- `revisionNumber` counts versions; `supersededAt` marks the previous version
-- as history when a revision is submitted. Existing rows default to revision 1
-- and are all current, so no historical data is rewritten or lost.
ALTER TABLE `quotations` ADD `revisionNumber` int NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `quotations` ADD `supersededAt` timestamp NULL;
