-- Explicit commercial ordering for Featured/Sponsored placement, so an admin
-- controls which providers lead the strip rather than relying on insertion or
-- creation date. Lower value = higher priority.
ALTER TABLE `vendorSponsorships` ADD `priority` int NOT NULL DEFAULT 0;
