CREATE TABLE `analyticsEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`eventType` varchar(64) NOT NULL,
	`subjectType` varchar(40),
	`subjectId` int,
	`plan` varchar(24),
	`metadata` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analyticsEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `analyticsEvents` ADD CONSTRAINT `analyticsEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `analyticsEvents_type_occurredAt_idx` ON `analyticsEvents` (`eventType`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `analyticsEvents_userId_eventType_idx` ON `analyticsEvents` (`userId`,`eventType`);--> statement-breakpoint
CREATE INDEX `analyticsEvents_occurredAt_idx` ON `analyticsEvents` (`occurredAt`);