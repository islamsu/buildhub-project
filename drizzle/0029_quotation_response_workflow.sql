-- Complete the supplier quotation record with the two commercial facts that
-- could previously exist only in an uploaded document or an unstructured note.
-- Both columns are nullable so every inherited quotation remains valid.
ALTER TABLE `quotations` ADD `commercialTerms` text;
--> statement-breakpoint
ALTER TABLE `quotations` ADD `validUntil` timestamp NULL;
