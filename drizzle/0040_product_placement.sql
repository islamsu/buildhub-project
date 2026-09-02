-- Product placements share the canonical vendorSponsorships inventory model.
-- vendorId becomes nullable for PRODUCT rows; productId carries the product.
ALTER TABLE `vendorSponsorships`
  MODIFY `vendorId` int NULL,
  ADD `productId` int NULL,
  ADD KEY `vendorSponsorships_product_idx` (`productId`),
  ADD CONSTRAINT `vendorSponsorships_productId_products_id_fk`
    FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
