-- Internal, permission-controlled Admin Notes. Never exposed on public routes.
CREATE TABLE `adminNotes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `subjectType` enum('user', 'vendor', 'project', 'rfq', 'quotation', 'dispute') NOT NULL,
  `subjectId` int NOT NULL,
  `note` text NOT NULL,
  `authorId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `adminNotes_subject_idx` (`subjectType`, `subjectId`),
  KEY `adminNotes_author_idx` (`authorId`),
  CONSTRAINT `adminNotes_authorId_users_id_fk`
    FOREIGN KEY (`authorId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
);
