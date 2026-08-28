CREATE TABLE `rfqItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rfqId` int NOT NULL,
	`productId` int,
	`name` varchar(255) NOT NULL,
	`variantLabel` varchar(120),
	`quantity` decimal(12,2) NOT NULL,
	`unit` varchar(40),
	`specifications` text,
	`unitPriceSnapshot` decimal(12,2),
	`position` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rfqItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `rfqItems` ADD CONSTRAINT `rfqItems_rfqId_rfqs_id_fk` FOREIGN KEY (`rfqId`) REFERENCES `rfqs`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `rfqItems` ADD CONSTRAINT `rfqItems_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `rfqItems_rfqId_idx` ON `rfqItems` (`rfqId`);--> statement-breakpoint
CREATE INDEX `rfqItems_productId_idx` ON `rfqItems` (`productId`);
