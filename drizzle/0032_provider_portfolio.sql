-- Provider portfolio: a professional can showcase real completed work.
-- Owner-scoped (userId), with optional category/location/year/services and a
-- JSON list of image URLs. Nothing here fabricates data; every row is created
-- by the provider it belongs to.
CREATE TABLE `portfolioItems` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `title` varchar(191) NOT NULL,
  `description` text,
  `category` varchar(100),
  `location` varchar(191),
  `completionYear` int,
  `services` varchar(500),
  `images` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
  CONSTRAINT `portfolioItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `portfolioItems` ADD CONSTRAINT `portfolioItems_userId_users_id_fk`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX `portfolioItems_userId_idx` ON `portfolioItems` (`userId`);
