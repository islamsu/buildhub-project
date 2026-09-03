-- ── The category taxonomy becomes administrable, and every change is recorded ──
--
-- 0042 created the taxonomy. This makes it something an administrator can edit
-- from the product, which means every edit has to leave a trail: who renamed
-- "Pools", when, and what it was called before.
--
-- Two existing audit tables already answer exactly that question for other
-- subjects, so this adds a subject rather than a third audit mechanism:
--
--   fieldValueHistory      OLD -> NEW per field, with actor and timestamp. This
--                          is where a rename, a scope change or a status change
--                          is recorded, because the value it moved FROM is the
--                          whole point.
--   commercialAuditEvents  WHICH action happened, never values. Creation and
--                          alias changes go here: there is no prior value to
--                          contrast, and the row is read by a wider audience.
--
-- FORWARD-ONLY. Extending a MySQL enum with a value appended at the END is a
-- metadata-only change on both MySQL 8 and MariaDB 10.11 - existing rows keep
-- their values and their storage, and nothing is rewritten. Adding it anywhere
-- but the end would renumber the existing members and silently change what
-- every stored row means.

ALTER TABLE `fieldValueHistory`
  MODIFY COLUMN `subjectType`
  ENUM('rfq','quotation','product','user','subscription','category') NOT NULL;
--> statement-breakpoint
ALTER TABLE `commercialAuditEvents`
  MODIFY COLUMN `subjectType`
  ENUM('rfq','quotation','product','document','enquiry','message','category') NOT NULL;
