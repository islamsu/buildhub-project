CREATE TABLE `dailyLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`authorId` int NOT NULL,
	`date` timestamp NOT NULL DEFAULT (now()),
	`description` text NOT NULL,
	`weather` varchar(50),
	`workers` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dailyLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`uploaderId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`type` enum('drawing','boq','photo','contract','invoice','other') DEFAULT 'other',
	`url` text NOT NULL,
	`fileKey` varchar(255),
	`size` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`category` varchar(100),
	`description` text,
	`amount` decimal(12,2) NOT NULL,
	`currency` varchar(10) DEFAULT 'EGP',
	`date` timestamp DEFAULT (now()),
	`receiptUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`senderId` int NOT NULL,
	`receiverId` int NOT NULL,
	`projectId` int,
	`content` text NOT NULL,
	`type` enum('text','file','quotation') DEFAULT 'text',
	`fileUrl` text,
	`read` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`dueDate` timestamp,
	`status` enum('pending','in_progress','completed') DEFAULT 'pending',
	`progress` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `milestones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`type` varchar(50) DEFAULT 'info',
	`read` boolean DEFAULT false,
	`link` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supplierId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`nameAr` varchar(255),
	`description` text,
	`descriptionAr` text,
	`category` varchar(100) NOT NULL,
	`subCategory` varchar(100),
	`brand` varchar(100),
	`origin` varchar(100),
	`price` decimal(12,2),
	`currency` varchar(10) DEFAULT 'EGP',
	`stock` int DEFAULT 0,
	`unit` varchar(50),
	`warranty` varchar(100),
	`deliveryDays` int,
	`images` text,
	`specs` text,
	`rating` decimal(3,2) DEFAULT '0.00',
	`reviewCount` int DEFAULT 0,
	`featured` boolean DEFAULT false,
	`active` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`type` enum('residential','commercial','renovation','finishing','maintenance','other') DEFAULT 'residential',
	`status` enum('planning','active','on_hold','completed','cancelled') DEFAULT 'planning',
	`budget` decimal(14,2),
	`spent` decimal(14,2) DEFAULT '0.00',
	`progress` int DEFAULT 0,
	`location` varchar(255),
	`startDate` timestamp,
	`endDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rfqId` int NOT NULL,
	`providerId` int NOT NULL,
	`price` decimal(12,2) NOT NULL,
	`currency` varchar(10) DEFAULT 'EGP',
	`timeline` int,
	`warranty` varchar(100),
	`paymentTerms` text,
	`notes` text,
	`status` enum('pending','accepted','rejected') DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quotations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`reviewerId` int NOT NULL,
	`revieweeId` int NOT NULL,
	`rating` int NOT NULL,
	`comment` text,
	`verified` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rfqs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requesterId` int NOT NULL,
	`projectId` int,
	`title` varchar(255) NOT NULL,
	`description` text,
	`category` varchar(100),
	`budget` decimal(12,2),
	`location` varchar(255),
	`deadline` timestamp,
	`status` enum('open','closed','awarded') DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rfqs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`milestoneId` int,
	`assigneeId` int,
	`title` varchar(255) NOT NULL,
	`description` text,
	`status` enum('todo','in_progress','done') DEFAULT 'todo',
	`priority` enum('low','medium','high') DEFAULT 'medium',
	`dueDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `userRole` enum('homeowner','contractor','engineer','architect','supplier','project_manager','admin') DEFAULT 'homeowner';--> statement-breakpoint
ALTER TABLE `users` ADD `avatar` text;--> statement-breakpoint
ALTER TABLE `users` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `users` ADD `location` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `verified` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `users` ADD `rating` decimal(3,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `users` ADD `reviewCount` int DEFAULT 0;