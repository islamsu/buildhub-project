CREATE TABLE `billingEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`subscriptionId` int,
	`action` varchar(80) NOT NULL,
	`fromStatus` varchar(40),
	`toStatus` varchar(40),
	`source` varchar(40),
	`actorId` int,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billingEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vendorSubscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`plan` enum('free','professional','premium') NOT NULL DEFAULT 'free',
	`status` enum('free','trialing','active','past_due','canceled','expired') NOT NULL DEFAULT 'free',
	`billingInterval` enum('month','year'),
	`currency` varchar(3) NOT NULL DEFAULT 'EGP',
	`priceAmount` decimal(10,2),
	`isFounderPrice` boolean NOT NULL DEFAULT false,
	`founderPriceUsedAt` timestamp,
	`founderPriceEndsAt` timestamp,
	`trialEndsAt` timestamp,
	`currentPeriodStart` timestamp,
	`currentPeriodEnd` timestamp,
	`cancelAtPeriodEnd` boolean NOT NULL DEFAULT false,
	`canceledAt` timestamp,
	`gracePeriodEndsAt` timestamp,
	`provider` varchar(40),
	`providerCustomerRef` varchar(191),
	`providerSubscriptionRef` varchar(191),
	`providerPriceRef` varchar(191),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vendorSubscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `vendorSubscriptions_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `billingEvents` ADD CONSTRAINT `billingEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `billingEvents` ADD CONSTRAINT `billingEvents_subscriptionId_vendorSubscriptions_id_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `vendorSubscriptions`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `billingEvents` ADD CONSTRAINT `billingEvents_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `vendorSubscriptions` ADD CONSTRAINT `vendorSubscriptions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `billingEvents_userId_idx` ON `billingEvents` (`userId`);--> statement-breakpoint
CREATE INDEX `billingEvents_subscriptionId_idx` ON `billingEvents` (`subscriptionId`);--> statement-breakpoint
CREATE INDEX `billingEvents_actorId_idx` ON `billingEvents` (`actorId`);--> statement-breakpoint
CREATE INDEX `vendorSubscriptions_status_idx` ON `vendorSubscriptions` (`status`);--> statement-breakpoint
CREATE INDEX `vendorSubscriptions_currentPeriodEnd_idx` ON `vendorSubscriptions` (`currentPeriodEnd`);--> statement-breakpoint
CREATE INDEX `vendorSubscriptions_trialEndsAt_idx` ON `vendorSubscriptions` (`trialEndsAt`);--> statement-breakpoint
CREATE INDEX `vendorSubscriptions_gracePeriodEndsAt_idx` ON `vendorSubscriptions` (`gracePeriodEndsAt`);