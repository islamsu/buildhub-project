-- ── Vendor company profile, primary contact, and category sponsorship ──────
--
-- BuildHub's "vendor profile" was, until now, the `users` row: a name, a bio,
-- a location, a phone. There was no company, no primary contact, no address,
-- no website, no registration number - so a customer choosing between two
-- construction firms was choosing between two personal names.
--
-- WHY A SEPARATE TABLE RATHER THAN MORE COLUMNS ON `users`.
--
-- `users` already carries passwordHash, passwordResetToken and
-- invitationToken, and a bare `select().from(users)` has leaked all three in
-- this codebase's history - twice. Every column added there widens that blast
-- radius. Company data belongs to providers only, is read by different
-- audiences at different authorization tiers, and has its own explicit
-- allowlists; keeping it in its own table means a mistake here cannot expose a
-- credential.

CREATE TABLE `vendorProfiles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,

  -- The organisation. Public: this is what a customer chooses between.
  `companyName` varchar(191),
  `companyDescription` text,

  -- The person. NOT public - released only on a real commercial relationship,
  -- the same rule rfq.requesterContact already applies in the other direction.
  `primaryContactName` varchar(191),
  `primaryContactPosition` varchar(120),
  `primaryContactEmail` varchar(255),
  `primaryContactPhone` varchar(40),
  `primaryContactMobile` varchar(40),

  -- Street address is contact-tier; city and country are public, because a
  -- customer must be able to filter by where a vendor works without being
  -- handed the door to knock on.
  `addressLine` varchar(255),
  `city` varchar(120),
  `country` varchar(120),
  `website` varchar(255),

  -- Commercial registration. Deliberately NOT public: it is the number an
  -- impersonator needs, and a directory listing is not the place for it.
  `registrationNumber` varchar(120),

  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
  CONSTRAINT `vendorProfiles_id` PRIMARY KEY(`id`),
  -- One profile per vendor, enforced by the database rather than by the
  -- application remembering to check.
  CONSTRAINT `vendorProfiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `vendorProfiles` ADD CONSTRAINT `vendorProfiles_userId_users_id_fk`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint

-- ── Sponsored placement in the vendors directory ──────────────────────────
--
-- A REAL RECORD, because the alternative is fabricating one. The brief asks
-- for sponsored vendor spaces per service category; a hard-coded list in the
-- UI would be inventing commercial relationships that do not exist, which is
-- exactly what must never happen. So sponsorship is a row an administrator
-- creates, scoped to one category, bounded by dates, and revocable.
--
-- NO PRICE, NO INVOICE, NO PAYMENT. This records THAT a sponsorship was
-- granted and by whom - not what was charged for it. BuildHub has no payment
-- provider, and inventing a billing relationship here would be the same
-- fabrication in a different column.
CREATE TABLE `vendorSponsorships` (
  `id` int AUTO_INCREMENT NOT NULL,
  `vendorId` int NOT NULL,
  -- One category per row. A vendor sponsored in two categories has two rows,
  -- which is what makes "who is sponsored in THIS category" a single indexed
  -- lookup rather than a scan-and-filter.
  `category` varchar(100) NOT NULL,
  `startsAt` timestamp NOT NULL DEFAULT (now()),
  -- NULL = open-ended until revoked. An expired sponsorship stops appearing
  -- the moment it elapses, whether or not anything runs to tidy it up.
  `endsAt` timestamp,
  `grantedBy` int,
  `grantedReason` varchar(500),
  -- Soft revocation: the row stays so an audit can still show that the
  -- sponsorship existed and when it was withdrawn.
  `revokedAt` timestamp,
  `revokedBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `vendorSponsorships_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `vendorSponsorships` ADD CONSTRAINT `vendorSponsorships_vendorId_users_id_fk`
  FOREIGN KEY (`vendorId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `vendorSponsorships` ADD CONSTRAINT `vendorSponsorships_grantedBy_users_id_fk`
  FOREIGN KEY (`grantedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `vendorSponsorships` ADD CONSTRAINT `vendorSponsorships_revokedBy_users_id_fk`
  FOREIGN KEY (`revokedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX `vendorSponsorships_category_idx` ON `vendorSponsorships` (`category`);
--> statement-breakpoint
CREATE INDEX `vendorSponsorships_vendorId_idx` ON `vendorSponsorships` (`vendorId`);
--> statement-breakpoint
-- The directory's own query: live sponsorships in one category, ordered.
CREATE INDEX `vendorSponsorships_active_idx` ON `vendorSponsorships` (`category`, `revokedAt`, `startsAt`);
