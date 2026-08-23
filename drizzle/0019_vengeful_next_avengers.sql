CREATE TABLE `testLoginTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`issuedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`revokedAt` timestamp,
	`revokedBy` int,
	CONSTRAINT `testLoginTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `testLoginTokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `testLoginTokens` ADD CONSTRAINT `testLoginTokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `testLoginTokens` ADD CONSTRAINT `testLoginTokens_issuedBy_users_id_fk` FOREIGN KEY (`issuedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `testLoginTokens` ADD CONSTRAINT `testLoginTokens_revokedBy_users_id_fk` FOREIGN KEY (`revokedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `testLoginTokens_userId_idx` ON `testLoginTokens` (`userId`);--> statement-breakpoint
CREATE INDEX `testLoginTokens_expiresAt_idx` ON `testLoginTokens` (`expiresAt`);