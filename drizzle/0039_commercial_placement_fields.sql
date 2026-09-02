-- Commercial placement architecture extension over the existing canonical
-- vendorSponsorships engine. Forward-only; does not rewrite earlier work.
ALTER TABLE `vendorSponsorships`
  ADD `source` varchar(40) NOT NULL DEFAULT 'ADMIN_EDITORIAL',
  ADD `package` varchar(40) NULL,
  ADD `surface` varchar(40) NULL,
  ADD `entityType` varchar(20) NOT NULL DEFAULT 'PROVIDER';

CREATE INDEX `vendorSponsorships_package_surface_idx`
  ON `vendorSponsorships` (`package`, `surface`);
