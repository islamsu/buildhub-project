-- A supplier's quotation may carry supporting files: a proposal, a technical
-- specification, a certificate, product photographs.
--
-- Nullable, so every existing quotation remains valid and unchanged. Stored as
-- a JSON array of {key,url,name,type,size} - the identical shape
-- rfqs.attachments already uses, so the client parses both with one helper and
-- the storage proxy authorises both with one pattern.
ALTER TABLE `quotations` ADD `attachments` text;
