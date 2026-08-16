CREATE TABLE `registrationDocumentSubmissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`userId` int NOT NULL,
	`documentType` varchar(100) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`url` text NOT NULL,
	`fileKey` varchar(255),
	`mimeType` varchar(100) NOT NULL,
	`size` int NOT NULL,
	`status` enum('submitted','under_review','approved','rejected','update_required') NOT NULL DEFAULT 'submitted',
	`applicantNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `registrationDocumentSubmissions_id` PRIMARY KEY(`id`)
);
