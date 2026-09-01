-- Distinguish admin-curated editorial FEATURED placement from paid SPONSORED
-- placement in the same table. The two states share the grant/revoke/period
-- machinery but must never be confused in audit or in the marketplace.
ALTER TABLE `vendorSponsorships` ADD `kind` varchar(20) NOT NULL DEFAULT 'sponsored';
