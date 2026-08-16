CREATE TABLE `adminSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settingKey` varchar(120) NOT NULL,
	`value` text NOT NULL,
	`updatedBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `adminSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `adminSettings_settingKey_unique` UNIQUE(`settingKey`)
);
--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reporterId` int NOT NULL,
	`respondentId` int,
	`projectId` int,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`type` varchar(80) NOT NULL DEFAULT 'general',
	`priority` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`status` enum('open','investigating','resolved','rejected') NOT NULL DEFAULT 'open',
	`resolutionNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `disputes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `accountStatus` enum('active','frozen') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `frozenAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `frozenReason` text;