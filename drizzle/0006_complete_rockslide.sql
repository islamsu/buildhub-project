CREATE TABLE `productQuestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`askerId` int NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`answeredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `productQuestions_id` PRIMARY KEY(`id`)
);
