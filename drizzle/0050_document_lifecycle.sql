-- ── PROJECT DOCUMENTS: REPLACE AND RETIRE ────────────────────────────────
--
-- A project document could be uploaded and listed and nothing else. There was
-- no way to correct a drawing that went up as the wrong revision, and no way to
-- take one down - so the only remedies available to a site team were to upload
-- a second file with a confusing name, or to ask an administrator to delete a
-- row from the database.
--
-- ARCHIVE, NEVER DELETE, for the same reason products archive: a contract, a
-- BOQ or a drawing is evidence of what was agreed at a moment in time, and a
-- dispute six months later is exactly when somebody needs the superseded
-- revision. Archived documents leave the working list and stay downloadable to
-- the people who could already read the project.
--
-- REPLACING IS A LINK, NOT AN OVERWRITE. The new file is a new row; the old one
-- is archived and points forward to its replacement, so "which revision was
-- current on the 3rd of March" has an answer.
ALTER TABLE `documents` ADD COLUMN `archivedAt` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `archivedBy` int NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `archiveReason` varchar(500) NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `supersededById` int NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_archivedBy_users_id_fk` FOREIGN KEY (`archivedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_supersededById_documents_id_fk` FOREIGN KEY (`supersededById`) REFERENCES `documents`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
-- The working list is "this project's documents that are not archived", which
-- is the read every project page makes.
CREATE INDEX `documents_project_archived_idx` ON `documents` (`projectId`,`archivedAt`);
