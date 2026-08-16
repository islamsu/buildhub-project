CREATE TABLE `registrationDocuments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`documentType` varchar(100) NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`url` text NOT NULL,
	`fileKey` varchar(255),
	`mimeType` varchar(100) NOT NULL,
	`size` int NOT NULL,
	`status` enum('submitted','under_review','approved','rejected','update_required') NOT NULL DEFAULT 'submitted',
	`applicantNote` text,
	`reviewerNote` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `registrationDocuments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `registrationReviewEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`documentId` int,
	`actorId` int NOT NULL,
	`action` varchar(80) NOT NULL,
	`status` varchar(50),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `registrationReviewEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `onboardingStatus` enum('not_started','under_review','update_required','approved','rejected') DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `onboardingReviewNotes` text;--> statement-breakpoint
ALTER TABLE `users` ADD `onboardingReviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `onboardingReviewedBy` int;