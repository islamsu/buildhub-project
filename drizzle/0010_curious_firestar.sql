CREATE TABLE `userAccountAuditEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`actorId` int,
	`action` varchar(80) NOT NULL,
	`source` varchar(40),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userAccountAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(100);--> statement-breakpoint
ALTER TABLE `users` ADD `accountSource` enum('self_registered','admin_created') DEFAULT 'self_registered' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `isDummy` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `createdBy` int;--> statement-breakpoint
ALTER TABLE `users` ADD `creationNote` text;--> statement-breakpoint
ALTER TABLE `users` ADD `deactivatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);