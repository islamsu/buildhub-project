-- Complete the vendor business profile with the discovery and contact facts a
-- customer needs to choose and reach a real company. Every column is nullable
-- so existing profiles stay valid. Privacy tiers are enforced in server code,
-- not by this schema.
ALTER TABLE `vendorProfiles` ADD `tradingName` varchar(191);
--> statement-breakpoint
ALTER TABLE `vendorProfiles` ADD `alternativeEmail` varchar(255);
--> statement-breakpoint
ALTER TABLE `vendorProfiles` ADD `serviceCoverage` text;
--> statement-breakpoint
ALTER TABLE `vendorProfiles` ADD `specialties` text;
--> statement-breakpoint
ALTER TABLE `vendorProfiles` ADD `businessHours` text;
--> statement-breakpoint
ALTER TABLE `vendorProfiles` ADD `socialLinks` text;
