CREATE TABLE `aiAttachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`contentType` varchar(100) NOT NULL,
	`size` int NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`deletedAt` timestamp,
	CONSTRAINT `aiAttachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `aiAttachments` ADD CONSTRAINT `aiAttachments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `aiAttachments_userId_idx` ON `aiAttachments` (`userId`);--> statement-breakpoint
CREATE INDEX `aiAttachments_fileKey_idx` ON `aiAttachments` (`fileKey`);