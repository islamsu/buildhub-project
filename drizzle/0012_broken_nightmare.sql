ALTER TABLE `userAccountAuditEvents` MODIFY COLUMN `userId` int;--> statement-breakpoint
ALTER TABLE `adminSettings` ADD CONSTRAINT `adminSettings_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `dailyLogs` ADD CONSTRAINT `dailyLogs_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `dailyLogs` ADD CONSTRAINT `dailyLogs_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_reporterId_users_id_fk` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_respondentId_users_id_fk` FOREIGN KEY (`respondentId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_uploaderId_users_id_fk` FOREIGN KEY (`uploaderId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_senderId_users_id_fk` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_receiverId_users_id_fk` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_quotationId_quotations_id_fk` FOREIGN KEY (`quotationId`) REFERENCES `quotations`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `milestones` ADD CONSTRAINT `milestones_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `productQuestions` ADD CONSTRAINT `productQuestions_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `productQuestions` ADD CONSTRAINT `productQuestions_askerId_users_id_fk` FOREIGN KEY (`askerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_supplierId_users_id_fk` FOREIGN KEY (`supplierId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `progressReports` ADD CONSTRAINT `progressReports_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `progressReports` ADD CONSTRAINT `progressReports_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_rfqId_rfqs_id_fk` FOREIGN KEY (`rfqId`) REFERENCES `rfqs`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_providerId_users_id_fk` FOREIGN KEY (`providerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrationDocumentSubmissions` ADD CONSTRAINT `registrationDocumentSubmissions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrationDocumentSubmissions` ADD CONSTRAINT `regDocSubmissions_documentId_fk` FOREIGN KEY (`documentId`) REFERENCES `registrationDocuments`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrationDocuments` ADD CONSTRAINT `registrationDocuments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrationDocuments` ADD CONSTRAINT `registrationDocuments_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrationReviewEvents` ADD CONSTRAINT `registrationReviewEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrationReviewEvents` ADD CONSTRAINT `registrationReviewEvents_documentId_registrationDocuments_id_fk` FOREIGN KEY (`documentId`) REFERENCES `registrationDocuments`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrationReviewEvents` ADD CONSTRAINT `registrationReviewEvents_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_reviewerId_users_id_fk` FOREIGN KEY (`reviewerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_revieweeId_users_id_fk` FOREIGN KEY (`revieweeId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `rfqs` ADD CONSTRAINT `rfqs_requesterId_users_id_fk` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `rfqs` ADD CONSTRAINT `rfqs_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_milestoneId_milestones_id_fk` FOREIGN KEY (`milestoneId`) REFERENCES `milestones`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_assigneeId_users_id_fk` FOREIGN KEY (`assigneeId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `userAccountAuditEvents` ADD CONSTRAINT `userAccountAuditEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `userAccountAuditEvents` ADD CONSTRAINT `userAccountAuditEvents_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_onboardingReviewedBy_users_id_fk` FOREIGN KEY (`onboardingReviewedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `adminSettings_updatedBy_idx` ON `adminSettings` (`updatedBy`);--> statement-breakpoint
CREATE INDEX `dailyLogs_projectId_idx` ON `dailyLogs` (`projectId`);--> statement-breakpoint
CREATE INDEX `dailyLogs_authorId_idx` ON `dailyLogs` (`authorId`);--> statement-breakpoint
CREATE INDEX `disputes_reporterId_idx` ON `disputes` (`reporterId`);--> statement-breakpoint
CREATE INDEX `disputes_respondentId_idx` ON `disputes` (`respondentId`);--> statement-breakpoint
CREATE INDEX `disputes_projectId_idx` ON `disputes` (`projectId`);--> statement-breakpoint
CREATE INDEX `documents_projectId_idx` ON `documents` (`projectId`);--> statement-breakpoint
CREATE INDEX `documents_uploaderId_idx` ON `documents` (`uploaderId`);--> statement-breakpoint
CREATE INDEX `expenses_projectId_idx` ON `expenses` (`projectId`);--> statement-breakpoint
CREATE INDEX `messages_senderId_idx` ON `messages` (`senderId`);--> statement-breakpoint
CREATE INDEX `messages_receiverId_idx` ON `messages` (`receiverId`);--> statement-breakpoint
CREATE INDEX `messages_projectId_idx` ON `messages` (`projectId`);--> statement-breakpoint
CREATE INDEX `messages_quotationId_idx` ON `messages` (`quotationId`);--> statement-breakpoint
CREATE INDEX `milestones_projectId_idx` ON `milestones` (`projectId`);--> statement-breakpoint
CREATE INDEX `notifications_userId_read_idx` ON `notifications` (`userId`,`read`);--> statement-breakpoint
CREATE INDEX `productQuestions_productId_idx` ON `productQuestions` (`productId`);--> statement-breakpoint
CREATE INDEX `productQuestions_askerId_idx` ON `productQuestions` (`askerId`);--> statement-breakpoint
CREATE INDEX `products_supplierId_idx` ON `products` (`supplierId`);--> statement-breakpoint
CREATE INDEX `progressReports_projectId_idx` ON `progressReports` (`projectId`);--> statement-breakpoint
CREATE INDEX `progressReports_authorId_idx` ON `progressReports` (`authorId`);--> statement-breakpoint
CREATE INDEX `projects_ownerId_idx` ON `projects` (`ownerId`);--> statement-breakpoint
CREATE INDEX `quotations_rfqId_idx` ON `quotations` (`rfqId`);--> statement-breakpoint
CREATE INDEX `quotations_providerId_idx` ON `quotations` (`providerId`);--> statement-breakpoint
CREATE INDEX `registrationDocumentSubmissions_documentId_idx` ON `registrationDocumentSubmissions` (`documentId`);--> statement-breakpoint
CREATE INDEX `registrationDocumentSubmissions_userId_idx` ON `registrationDocumentSubmissions` (`userId`);--> statement-breakpoint
CREATE INDEX `registrationDocuments_userId_idx` ON `registrationDocuments` (`userId`);--> statement-breakpoint
CREATE INDEX `registrationDocuments_reviewedBy_idx` ON `registrationDocuments` (`reviewedBy`);--> statement-breakpoint
CREATE INDEX `registrationReviewEvents_userId_idx` ON `registrationReviewEvents` (`userId`);--> statement-breakpoint
CREATE INDEX `registrationReviewEvents_documentId_idx` ON `registrationReviewEvents` (`documentId`);--> statement-breakpoint
CREATE INDEX `registrationReviewEvents_actorId_idx` ON `registrationReviewEvents` (`actorId`);--> statement-breakpoint
CREATE INDEX `reviews_projectId_idx` ON `reviews` (`projectId`);--> statement-breakpoint
CREATE INDEX `reviews_reviewerId_idx` ON `reviews` (`reviewerId`);--> statement-breakpoint
CREATE INDEX `reviews_revieweeId_idx` ON `reviews` (`revieweeId`);--> statement-breakpoint
CREATE INDEX `rfqs_requesterId_idx` ON `rfqs` (`requesterId`);--> statement-breakpoint
CREATE INDEX `rfqs_projectId_idx` ON `rfqs` (`projectId`);--> statement-breakpoint
CREATE INDEX `tasks_projectId_idx` ON `tasks` (`projectId`);--> statement-breakpoint
CREATE INDEX `tasks_milestoneId_idx` ON `tasks` (`milestoneId`);--> statement-breakpoint
CREATE INDEX `tasks_assigneeId_idx` ON `tasks` (`assigneeId`);--> statement-breakpoint
CREATE INDEX `userAccountAuditEvents_userId_idx` ON `userAccountAuditEvents` (`userId`);--> statement-breakpoint
CREATE INDEX `userAccountAuditEvents_actorId_idx` ON `userAccountAuditEvents` (`actorId`);--> statement-breakpoint
CREATE INDEX `users_createdBy_idx` ON `users` (`createdBy`);--> statement-breakpoint
CREATE INDEX `users_onboardingReviewedBy_idx` ON `users` (`onboardingReviewedBy`);