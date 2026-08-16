ALTER TABLE `users` ADD `invitationStatus` enum('none','invitation_sent','pending_setup','password_set','expired') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `invitationToken` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `invitationExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `invitationSentAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordSetAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` text;