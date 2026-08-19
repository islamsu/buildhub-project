CREATE TABLE `revokedSessions` (
	`jti` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`revokedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `revokedSessions_jti` PRIMARY KEY(`jti`)
);
--> statement-breakpoint
ALTER TABLE `revokedSessions` ADD CONSTRAINT `revokedSessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `revokedSessions_userId_idx` ON `revokedSessions` (`userId`);