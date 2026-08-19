CREATE TABLE `qualifiedEnquiries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`rfqId` int NOT NULL,
	`yearMonth` varchar(7) NOT NULL,
	`planAtConsumption` varchar(20),
	`matchedCategory` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qualifiedEnquiries_id` PRIMARY KEY(`id`),
	CONSTRAINT `qualifiedEnquiries_userId_rfqId_unique` UNIQUE(`userId`,`rfqId`)
);
--> statement-breakpoint
CREATE TABLE `vendorCategories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`category` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vendorCategories_id` PRIMARY KEY(`id`),
	CONSTRAINT `vendorCategories_userId_category_unique` UNIQUE(`userId`,`category`)
);
--> statement-breakpoint
ALTER TABLE `qualifiedEnquiries` ADD CONSTRAINT `qualifiedEnquiries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `qualifiedEnquiries` ADD CONSTRAINT `qualifiedEnquiries_rfqId_rfqs_id_fk` FOREIGN KEY (`rfqId`) REFERENCES `rfqs`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `vendorCategories` ADD CONSTRAINT `vendorCategories_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `qualifiedEnquiries_userId_yearMonth_idx` ON `qualifiedEnquiries` (`userId`,`yearMonth`);--> statement-breakpoint
CREATE INDEX `qualifiedEnquiries_rfqId_idx` ON `qualifiedEnquiries` (`rfqId`);--> statement-breakpoint
CREATE INDEX `vendorCategories_category_idx` ON `vendorCategories` (`category`);