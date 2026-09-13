-- ── THE SERVICE CATALOGUE ────────────────────────────────────────────────
--
-- A supplier could list a product with a name, a description, a unit, a price
-- and a lifecycle. The four provider roles that sell WORK rather than GOODS -
-- contractor, engineer, architect, project manager - could declare one of nine
-- coarse RFQ categories and nothing else. A homeowner looking for bathroom
-- waterproofing saw a badge saying "Renovation".
--
-- THE SCOPE WAS ALREADY HERE AND UNUSED. `productCategories.scope` has carried
-- a SERVICE value since the taxonomy was consolidated, with a comment reading
-- "PRODUCT and BOTH are listable; SERVICE is deliberately not", and no row ever
-- used it. This migration is that comment being answered.
CREATE TABLE `serviceOfferings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `providerId` int NOT NULL,
  `categoryId` int NOT NULL,
  `title` varchar(120) NOT NULL,
  `description` text,
  `pricingBasis` enum('quote_on_request','per_square_metre','per_linear_metre','per_unit','per_day','fixed_project') NOT NULL DEFAULT 'quote_on_request',
  `priceMin` decimal(12,2),
  `priceMax` decimal(12,2),
  `leadTimeDays` int,
  `warrantyMonths` int,
  `status` enum('draft','active','inactive','archived') NOT NULL DEFAULT 'draft',
  `statusChangedAt` timestamp NULL,
  `archivedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `serviceOfferings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `serviceOfferings` ADD CONSTRAINT `serviceOfferings_providerId_users_id_fk` FOREIGN KEY (`providerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
-- RESTRICT, not CASCADE. A category an administrator retires must not take
-- every provider's listings with it; the category lifecycle already has
-- `hidden` and `archived` for exactly that, and they leave the rows intact.
ALTER TABLE `serviceOfferings` ADD CONSTRAINT `serviceOfferings_categoryId_productCategories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `productCategories`(`id`) ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
-- "This provider's catalogue", which is the read their own management screen
-- makes, and "this category's live services", which is the read discovery makes.
CREATE INDEX `serviceOfferings_provider_status_idx` ON `serviceOfferings` (`providerId`,`status`);
--> statement-breakpoint
CREATE INDEX `serviceOfferings_category_status_idx` ON `serviceOfferings` (`categoryId`,`status`);
--> statement-breakpoint
-- The commercial trail has to be able to NAME a service before anything writes
-- one. A TypeScript union alone would compile and then fail at the database on
-- the first published service, which is the worst place to find out.
ALTER TABLE `commercialAuditEvents` MODIFY COLUMN `subjectType` enum('rfq','quotation','product','document','enquiry','message','category','service') NOT NULL;
--> statement-breakpoint
-- ── The service categories the scope has been waiting for ────────────────
--
-- Seeded, not invented per-provider: a free-text category field is what
-- produced three unrelated vocabularies the last time, and an administrable row
-- is what the consolidation gave BuildHub instead. These are real Egyptian
-- construction trades, each bilingual, each with the stable slug an admin
-- screen and a URL need.
--
-- INSERT IGNORE and an explicit slug list, so re-running this migration on a
-- database that already has them changes nothing - and so a slug that already
-- exists as a PRODUCT category is left exactly as it is rather than being
-- quietly rescoped underneath the products already filed against it.
INSERT IGNORE INTO `productCategories` (`slug`, `nameEn`, `nameAr`, `scope`, `status`, `sortOrder`) VALUES
  ('svc-waterproofing',      'Waterproofing',                'أعمال العزل المائي',        'SERVICE', 'active', 10),
  ('svc-plastering',         'Plastering & Rendering',       'أعمال المحارة والبياض',     'SERVICE', 'active', 20),
  ('svc-tiling',             'Tiling & Flooring',            'أعمال البلاط والأرضيات',    'SERVICE', 'active', 30),
  ('svc-painting',           'Painting & Decorating',        'أعمال الدهانات والديكور',   'SERVICE', 'active', 40),
  ('svc-electrical',         'Electrical Installation',      'أعمال التركيبات الكهربائية', 'SERVICE', 'active', 50),
  ('svc-plumbing',           'Plumbing & Sanitary',          'أعمال السباكة والصحي',      'SERVICE', 'active', 60),
  ('svc-hvac',               'HVAC Installation',            'أعمال التكييف والتهوية',    'SERVICE', 'active', 70),
  ('svc-carpentry',          'Carpentry & Joinery',          'أعمال النجارة',             'SERVICE', 'active', 80),
  ('svc-aluminium-glazing',  'Aluminium & Glazing',          'أعمال الألوميتال والزجاج',  'SERVICE', 'active', 90),
  ('svc-gypsum',             'Gypsum Board & False Ceilings', 'أعمال الجبس والأسقف المستعارة', 'SERVICE', 'active', 100),
  ('svc-structural',         'Structural & Concrete Works',  'الأعمال الإنشائية والخرسانة', 'SERVICE', 'active', 110),
  ('svc-landscaping',        'Landscaping & Outdoor Works',  'أعمال اللاندسكيب والحدائق',  'SERVICE', 'active', 120),
  ('svc-pools',              'Swimming Pool Construction',   'إنشاء حمامات السباحة',      'SERVICE', 'active', 130),
  ('svc-interior-design',    'Interior Design',              'التصميم الداخلي',           'SERVICE', 'active', 140),
  ('svc-architectural-design', 'Architectural Design',       'التصميم المعماري',          'SERVICE', 'active', 150),
  ('svc-structural-engineering', 'Structural Engineering',   'الهندسة الإنشائية',         'SERVICE', 'active', 160),
  ('svc-surveying',          'Surveying & Site Inspection',  'المساحة ومعاينة الموقع',    'SERVICE', 'active', 170),
  ('svc-project-management', 'Project Management & Supervision', 'إدارة المشروعات والإشراف', 'SERVICE', 'active', 180),
  ('svc-maintenance',        'Maintenance & Repairs',        'أعمال الصيانة والإصلاح',    'SERVICE', 'active', 190),
  ('svc-demolition',         'Demolition & Site Clearance',  'أعمال الهدم وتجهيز الموقع', 'SERVICE', 'active', 200);
