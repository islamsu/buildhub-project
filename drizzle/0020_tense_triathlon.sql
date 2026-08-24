CREATE TABLE `adminInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`adminRole` enum('SUPER_ADMIN','USER_ADMIN','MARKETPLACE_ADMIN','SUPPORT_ADMIN','BILLING_ADMIN') NOT NULL,
	`invitedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`revokedAt` timestamp,
	`revokedBy` int,
	CONSTRAINT `adminInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `adminInvitations_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `adminRole` enum('SUPER_ADMIN','USER_ADMIN','MARKETPLACE_ADMIN','SUPPORT_ADMIN','BILLING_ADMIN');--> statement-breakpoint
ALTER TABLE `adminInvitations` ADD CONSTRAINT `adminInvitations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `adminInvitations` ADD CONSTRAINT `adminInvitations_invitedBy_users_id_fk` FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `adminInvitations` ADD CONSTRAINT `adminInvitations_revokedBy_users_id_fk` FOREIGN KEY (`revokedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `adminInvitations_userId_idx` ON `adminInvitations` (`userId`);--> statement-breakpoint
CREATE INDEX `adminInvitations_invitedBy_idx` ON `adminInvitations` (`invitedBy`);--> statement-breakpoint
CREATE INDEX `adminInvitations_expiresAt_idx` ON `adminInvitations` (`expiresAt`);--> statement-breakpoint
-- Backfill, and the reason it has to exist.
--
-- Every permission check fails closed on a null adminRole. Without this line an
-- administrator who existed before this migration would keep role='admin',
-- authenticate perfectly, and then be refused by every single admin endpoint -
-- a self-inflicted lockout with no way back in through the application.
--
-- SUPER_ADMIN is the honest backfill: it is exactly the authority they already
-- held, since role='admin' has been all-or-nothing until now. This narrows
-- nobody's access and widens nobody's; it names what was already true.
--
-- Idempotent, and scoped by `adminRole IS NULL` so re-running can never
-- overwrite a role someone has since been assigned deliberately.
UPDATE `users` SET `adminRole` = 'SUPER_ADMIN' WHERE `role` = 'admin' AND `adminRole` IS NULL;
