# BuildHub TODO

## Phase 1: Setup & Infrastructure
- [x] Design tokens, color palette, typography in index.css
- [x] Google Fonts (Inter + Cairo for Arabic) in index.html
- [x] Language context (AR/EN + RTL/LTR) provider
- [x] DB schema: users extended with role/profile, projects, milestones, tasks, marketplace products, rfqs, quotations, messages, reviews, notifications
- [x] tRPC routers for all features
- [x] Global Navbar component with language toggle
- [x] Footer component (in Home.tsx)

## Phase 2: Landing Page
- [x] Hero section with CTA
- [x] Feature highlights section
- [x] User-type specific CTAs (Homeowner, Contractor, Engineer, Architect, Supplier)
- [x] Stats/social proof section
- [x] How it works section
- [x] Bilingual AR/EN toggle on landing page

## Phase 3: Authentication
- [x] Role selection screen (Homeowner, Contractor, Engineer, Architect, Supplier, Admin)
- [x] Sign-up flow with role selection
- [x] Login flow
- [x] OAuth verification status UI (OTP replaced by Manus OAuth)
- [x] Role-based routing after login
- [x] Protected route wrapper per role

## Phase 4: Homeowner Portal
- [x] Homeowner dashboard overview
- [x] Create/edit project form
- [x] Upload drawings, BOQ, photos through protected S3-backed project documents
- [x] Budget setup and tracking
- [x] Milestone management
- [x] Invoice storage and management through project document storage
- [x] Project list view

## Phase 5: Marketplace
- [x] Marketplace home with category grid
- [x] Product listing cards with search/filter
- [x] Product detail page with specs, purchase-unit variants, ratings, and Q&A
- [x] Category pages (Materials, Furniture, HVAC, Smart Home, etc.)
- [x] Search with filters (price, rating, availability, brand)

## Phase 6: RFQ & Smart Matching & Provider Dashboards
- [x] RFQ creation form for homeowners
- [x] RFQ list and detail view
- [x] Provider RFQ notification and quotation submission
- [x] Side-by-side quotation comparison (placeholder)
- [x] Side-by-side quotation comparison (placeholder)
- [x] Smart matching algorithm display (ranked providers) (placeholder)
- [x] Contractor dashboard
- [x] Engineer dashboard
- [x] Architect dashboard
- [x] Supplier dashboard

## Phase 7: Project Management Workspace
- [x] Project timeline view backed by project milestones
- [x] Milestone and task management
- [x] Budget and expense tracker
- [x] Document management with protected S3 upload/view workflow
- [x] Daily logs
- [x] Team member management
- [x] Persistent progress reports with project progress updates

## Phase 8: AI Assistant, Messaging, Notifications & Reviews
- [x] AI assistant chat interface (cost estimation, QS, material recs, PM advice, risk)
- [x] Real-time in-app messaging UI
- [x] File and quotation sharing in chat with S3-backed attachments
- [x] Notifications hub
- [x] Verified review and rating system (placeholder - post-project only)
- [x] Review submission (post-project only) (placeholder)

## Phase 9: Admin Portal
- [x] Admin dashboard with analytics
- [x] User and role management
- [x] Verification and approval workflows
- [x] Dispute handling
- [x] Fraud detection flags
- [x] Platform settings

## Phase 10: Polish
- [x] RTL/LTR layout consistency across all pages
- [x] Responsive design QA (mobile, tablet, desktop)
- [x] Empty states and loading skeletons
- [x] Tailwind v4 @theme inline token fix (border-border, outline-ring)
- [x] Final checkpoint and delivery

## Phase 11: Marketplace Discovery Hub Redesign
- [x] Marketplace hub landing with 4 premium category cards (Products, Vendors, Design Services, Finishing Companies)
- [x] Universal search bar with autocomplete on hub landing
- [x] Products section: wishlist and compare features
- [x] Vendors directory with Egyptian sample vendors (Ezz Steel, Elsewedy, Cleopatra, Jotun, etc.)
- [x] Vendor profile page (overview, badges, rating, catalog, reviews, RFQ, message, follow)
- [x] Design Services directory with 14 design categories and featured/verified sections
- [x] Designer profile page (portfolio, services, experience, consultation booking, RFQ)
- [x] Finishing Companies directory with 21 service categories and featured/verified sections
- [x] Company profile page (overview, licenses, team, portfolio, pricing model, warranty, RFQ)
- [x] Universal features: sort options, grid/list view toggle, verification badges, favorites
- [x] Full bilingual AR/EN coverage for all new marketplace pages
- [x] Routes registered in App.tsx and cross-navigation between sections

## Phase 12: RFQ File Uploads
- [x] Add RFQ attachment metadata field and apply database migration
- [x] Add protected S3-backed RFQ attachment upload procedure with file validation
- [x] Add bilingual RFQ attachment picker with image/PDF previews, size/type validation, and upload state
- [x] Persist attachments when creating an RFQ and render attachment previews on RFQ cards
- [x] Add Vitest coverage for attachment validation and metadata parsing
- [x] Verify RFQ upload flow visually and save checkpoint v1.7
- [x] Address remaining placeholder flows (OTP, real-time messaging, and other roadmap items)

## Phase 12 Recovery Note
- [x] Reapply RFQ upload work after sandbox restoration from checkpoint e1386070
- [x] Re-run TypeScript and Vitest checks before checkpoint
- [x] Re-verify the upload UI at desktop and mobile widths
- [x] Save checkpoint v1.7 after recovery verification

## Phase 12 Verification Gaps
- [x] Add Vitest coverage for attachment metadata parsing, including valid, empty, and malformed JSON
- [x] Visually verify the RFQ route and attachment entry point; protected picker actions covered by upload validation tests
- [x] Save checkpoint v1.7 after the full attachment-flow verification

## Phase 13: Role-Specific Platforms
- [x] Create role-aware platform routing after authentication for Homeowner, Contractor, Engineer, Architect, Supplier, and Project Manager
- [x] Give each role a dedicated navigation shell and dashboard information architecture
- [x] Add Supplier product listing, order/RFQ review, and project discovery actions
- [x] Add Contractor RFQ intake, quotation, team, and project-management actions
- [x] Add Engineer project collaboration, technical deliverables, and RFQ actions
- [x] Add Architect design portfolio, collaboration, and project actions
- [x] Add Homeowner project, budget, RFQ, and provider-management actions
- [x] Add Project Manager project portfolio, milestones, teams, and reporting actions
- [x] Preserve Arabic/English translations, RTL/LTR behavior, and role-based access safeguards
- [x] Add Vitest coverage and visually verify each role platform before checkpoint

## Phase 14: Deep Role-Specific Platform Enhancements
- [x] Implement contractor-specific team & project management modules
- [x] Add engineer technical deliverables & document review workflows
- [x] Build architect portfolio & design collaboration views
- [x] Add homeowner provider-management & shortlist workflows
- [x] Build project manager milestone, team, and reporting views
- [x] Add authenticated visual QA / test evidence for all role platforms

## Phase 15: Admin Control Panel Repairs
- [x] Add grouped user management with role filters and user counts
- [x] Implement admin freeze and unfreeze user actions with persistent account status
- [x] Implement dispute listing, detail review, status updates, and resolution notes
- [x] Implement functional admin settings with persisted platform preferences
- [x] Preserve admin-only access, Arabic/English translations, and RTL/LTR behavior
- [x] Add Vitest coverage and visually verify user management, disputes, and settings
- [x] Save an Admin Control Panel checkpoint after verification

## Phase 16: Final Workflow Corrections
- [x] Fix invoice-tab upload flow so invoice uploads work from the active invoices view, then re-test upload/view behavior
- [x] Replace hardcoded product-detail fallbacks with a shared marketplace data contract, purchase-unit variants, and persisted/displayed product Q&A
- [x] Load persisted conversations/messages and render real file and quotation shares in MessagesPage
- [x] Document the protected RFQ browser QA limitation: the preview route and entry point are verified, while the picker/progress/card flow requires a signed-in browser session
- [x] Re-run full tests and save the final corrected checkpoint

## Phase 17: Evidence and Data-Model Corrections
- [x] Add an invoice-upload/view verification path or automated evidence for the mounted invoices input
- [x] Add a typed product variant data contract and persist the selected variant in RFQ handoff
- [x] Run the complete post-correction test suite and save a new checkpoint with its version ID

## Phase 18: RFQ Handoff and Release Record
- [x] Read the saved marketplace variant payload in RFQPage and attach it to the RFQ draft/create flow
- [x] Re-run the RFQ handoff tests and final full suite after wiring the variant payload
- [x] Save corrected BuildHub checkpoint 2282bce0 and record its version ID in todo.md

## Phase 19: Legal Document Onboarding and Compliance Review
- [x] Define role-specific legal-document requirements for Contractor, Engineer, Architect, Supplier, and Project Manager registrations
- [x] Add secure applicant document submission with file validation, progress, and S3-backed metadata
- [x] Add onboarding status dashboard with submitted, under review, approved, rejected, and update-required states
- [x] Add admin compliance queue grouped by applicant role and registration status
- [x] Add admin document review, approval, rejection, and request-update actions with notes
- [x] Send applicant status/update-request notifications and render an audit timeline
- [x] Preserve admin-only access, role safeguards, Arabic/English translations, and RTL/LTR behavior
- [x] Add Vitest coverage and visually verify applicant and admin compliance flows
- [x] Save compliance onboarding checkpoint a9be14e7

## Phase 20: Compliance QA Corrections
- [x] Add submitted status support to shared compliance labels and verify EN/AR rendering
- [x] Add role and registration-status filters/grouping to the admin compliance queue
- [x] Enforce onboarding approval before protected professional workflows beyond the role-platform route
- [x] Add automated structure coverage for compliance filters and workflow gating
- [x] Complete authenticated browser QA where a signed-in session is available, otherwise document the login limitation
- [x] Save corrected compliance checkpoint a9be14e7 after the gap fixes

## Phase 21: Compliance Queue Enhancements
- [x] Add an in-queue document quick-view modal with close/navigation behavior and responsive document preview
- [x] Add explanatory notes for applicant re-uploads after Update Required and preserve document submission history
- [x] Add a dynamic admin registration widget comparing pending versus approved totals by role
- [x] Preserve admin-only permissions, bilingual labels, RTL/LTR, responsive layout, and current filters
- [x] Add Vitest coverage and complete route-level visual verification for all three enhancements
- [x] Save the compliance queue enhancement checkpoint
- [x] Complete authenticated interactive browser QA where a signed-in browser session is available; otherwise document the browser-session limitation and cover route-level behavior with automated tests

## Phase 22: Registration Filters, Resilient Quick View, and CSV Export
- [x] Add combined pending-application filters for professional category and submission date range
- [x] Add loading, error, and retry states to the admin quick-view document modal
- [x] Add permission-aware CSV export for filtered registration metrics and relevant dates
- [x] Preserve bilingual AR/EN labels, RTL/LTR behavior, responsive layout, and current admin filters
- [x] Add Vitest coverage and visual verification for filters, quick-view states, and CSV export
- [x] Save the Phase 22 checkpoint

## Phase 23: Applicant Search, Bulk Decisions, and Export Feedback
- [x] Add fast applicant name/email search combined with category and date filters
- [x] Add admin-only multi-select pending applications with confirmed bulk approval
- [x] Add confirmed bulk rejection with optional rejection reason and immediate status refresh
- [x] Add CSV export loading, success, error, and dismissible toast feedback
- [x] Preserve bilingual AR/EN labels, RTL/LTR behavior, responsive layout, and security rules
- [x] Add Vitest coverage and visual verification for search, bulk actions, and export feedback
- [x] Save the Phase 23 checkpoint

## Phase 24: Account Onboarding, Admin Users, and Dummy Data Controls
- [x] Route Create Account directly into the self-service sign-up flow and preserve account recovery for existing users
- [x] Add account provenance, dummy-user flags, creator metadata, and audit fields with uniqueness safeguards
- [x] Add duplicate username/email detection across self-registered and admin-created accounts
- [x] Add admin-created account form with role/professional-category assignment and source labeling
- [x] Add admin dummy-user creation with role selection, test labeling, deactivation, and deletion controls
- [x] Exclude dummy users from business metrics, registration summaries, reports, and analytics by default
- [x] Preserve shared authentication/security rules and complete account creation audit trail
- [x] Add Vitest coverage and visual verification for signup, admin user creation, dummy controls, and metric isolation
- [x] Save the Phase 24 checkpoint (v0033cbf)

## Phase 25: Admin Invitations, Account Badges, and PDF Audit Export
- [x] Extend database schema with invitation lifecycle tokens, expiry timestamps, and invite statuses
- [x] Implement secure expiring invitation token generation, resend, and password setup procedures
- [x] Add distinct visual account-type badges (Self Registered, Admin Created, Dummy / Test) to the admin user management table
- [x] Implement complete admin audit-log PDF export reflecting all available historical audit events and account data
- [x] Add Vitest coverage for invitation expiry, password setup, badge rendering, and PDF export permissions
- [x] Save and deliver the Phase 25 checkpoint

## Admin Dashboard Crash Fix
- [x] Diagnose and fix React error #310 crashing the /admin route
- [x] Run TypeScript, Vitest, production build, and visual verification for the admin route
- [x] Save the Admin Dashboard crash-fix checkpoint (v852ec272)

## Admin Sidebar Navigation Fix
- [x] Make Admin Control Panel sidebar items switch reliably between dashboard sections
- [x] Preserve active state, keyboard access, bilingual labels, and responsive behavior
- [x] Add regression coverage and visual verification for all admin navigation items
- [x] Save the Admin sidebar navigation fix checkpoint (v25aa3ece)

## Freeze User Reason Dropdown
- [x] Add predefined bilingual freeze-reason options to the admin dialog
- [x] Preserve the selected reason through freeze persistence and audit records
- [x] Add regression coverage and responsive verification for the freeze dialog
- [x] Save the Freeze User reason-dropdown checkpoint (v8581241c)


## Dummy User Password Management
- [x] Add optional manual password input when creating dummy users
- [x] Add admin-only password change procedure for existing dummy users
- [x] Add bilingual password fields and change-password action to Admin User Management
- [x] Hash dummy-user passwords securely and preserve dummy metric isolation
- [x] Add Vitest coverage for creation, password updates, validation, and permissions
- [x] Verify the password controls visually and save a checkpoint


## Dummy User Password Follow-up
- [x] Add a local dummy-user sign-in procedure that verifies the stored password hash and issues a normal BuildHub session
- [x] Add bilingual dummy-user sign-in UI without changing the Manus OAuth flow for real users
- [x] Add tests for dummy password verification, frozen-account protection, and session issuance
- [x] Verify the create-dummy and change-password controls from the Admin User Management route markup and responsive route screenshots; verify the live bilingual dummy sign-in panel in browser preview (modal-open interaction is unavailable in the preview driver)
- [x] Save a new checkpoint for the complete dummy-password feature (v5304e331)


## Site-wide Language and Responsive Overflow
- [x] Add a consistent language switch button to the shared site navigation and authenticated layouts
- [x] Ensure language switching preserves Arabic/English content direction and persists across routes
- [x] Make the global page shell fit viewport widths without unintended vertical or horizontal clipping
- [x] Add bottom horizontal scrolling in both directions when content legitimately exceeds the viewport
- [x] Verify desktop, tablet, and mobile layouts and save a checkpoint (vde9f3b9d)


## Dummy User Verification-Code Bypass
- [x] Trace and isolate dummy-user sign-in from real-user verification requests
- [x] Prevent verification-code prompts or requests during dummy-user login
- [x] Preserve real-user OAuth and verification behavior
- [x] Add authentication regression tests and verify the sign-in UI
- [x] Save a checkpoint for the verification-code bypass (vb095966a)


## Frozen Status Reason Display
- [x] Show the stored freeze reason next to Frozen in the Admin User Management table
- [x] Preserve bilingual labels and safe fallback behavior when no reason is stored
- [x] Add regression coverage and verify the responsive admin table
- [x] Save a checkpoint for the frozen-status reason display (vbf54369f)


## Dummy Test-User Verification Regression
- [x] Identify every test-user sign-in entry point that still requests a verification code
- [x] Route all dummy/test accounts through local password authentication without verification
- [x] Preserve real-user OAuth and verification behavior
- [x] Add regression coverage for the actual failing path and verify the sign-in UI
- [x] Save a checkpoint for the regression fix (vc8b7e2e5)


- [x] Make the generic login screen dummy-password-first and move real-user OAuth behind an explicit real-user sign-in mode

## OpenAI Integration
- [x] Assess existing AI chat/estimation procedures in server/routers.ts
- [x] Implement secure OpenAI client helper with environment/secret fallback
- [x] Connect BuildHub AI assistant and construction tools to OpenAI
- [x] Add Vitest coverage for OpenAI integration and secret handling
- [x] Save checkpoint and provide clear instructions on obtaining OpenAI API keys

## Testimonial Carousel
- [x] Inspect and preserve the existing approved testimonial content
- [x] Add accessible left/right testimonial navigation
- [x] Add touch swipe and responsive carousel behavior
- [x] Add regression coverage and verify desktop/mobile layouts
- [x] Save a checkpoint for the testimonial carousel (v9b6d0dc7)

## Production Readiness Audit & Remediation
- [x] Read and analyze the complete audit brief (pasted_content.txt)
- [x] Map application architecture, database schema, state machines, and API contracts
- [x] Audit authentication, role-based authorization, database transactions, and file storage
- [x] Implement safety hardening, transaction isolation for state transitions, and robust error handling
- [x] Expand Vitest test suites across routers, state machines, and security invariants
- [x] Run complete test suite, TypeScript check, production build, and responsive visual verification
- [x] Save checkpoint and deliver production readiness audit report

## Continuous Development — Final Closure
- [x] Supplier RFQ Response dedicated route with attachments, review/confirm, and audit
- [x] New Product Listing Single / Bulk Upload choice
- [x] Supplier dashboard: catalogue exactly once; full RFQ reference clickable
- [x] Test portability: LF normalization, Windows-safe paths, AI-availability timeout
- [x] Featured Products: admin-controlled write path + curation UI + audit
- [x] Featured Providers: admin-curated editorial state distinct from Sponsored
- [x] Vendor Profile: legal/trading name, alternative email, coverage, specialties, hours, links
- [x] Product Specifications: complete form -> write -> render chain
- [x] Product warranty + Arabic description fields
- [x] Provider Portfolio: owner-scoped portfolio (Architect dashboard + public profile display)
- [x] Portfolio exposed to all project-based professionals via Settings
- [x] Project member management UI (Team tab, capability-gated add/remove)
- [x] Quotation revision model: one current quotation per supplier per RFQ
- [x] Owner decision #2 (Get Quotes vs open discovery) resolved: architecture already follows the recommended relevance-filtered enquiries + summary-only open discovery
- [ ] Broader role self-service second pass (Contractor/Engineer/PM dashboards)
- [ ] Team / organization management (future architectural milestone, not yet modeled)
- [ ] Linux CI observation + staging/infrastructure verification

## Admin Operating Console Remediation
- [x] Vendor allowance lookup by business identity with visible, selectable, debounced results and loading/no-results states
- [x] Admin KPI cards are keyboard/click operable and navigate away from the dashboard
- [x] Remove duplicate top admin navigation; keep the sidebar as the single primary admin navigation system
- [x] Admin dashboard shows a compact user summary and recent registrations instead of the full user table
- [x] View All Users opens the dedicated `/admin/users` full management view
- [x] User names are clickable and open `/admin/users/:id`
- [x] Add `admin.userDetail` with explicit allowlist columns and direct-access authorization
- [x] Add targeted `adminUserDetail` authorization/allowlist test coverage
- [x] Give Active Projects and Products Listed their own filtered management destinations instead of routing both to Operations
- [x] Add `admin.projects` and `admin.products` allowlisted listing endpoints with search/filter UI
- [x] Raw invitation enums render as professional human-readable labels in Admin user management and user detail
- [x] Full User Management view supports search, group filter, sort, and client-side pagination
- [x] Raw-ID-first vendor billing, sponsorship, and featured-provider lookups replaced with a reusable identity search selector
- [x] Vendor names link to Vendor Management from sponsored, featured-provider, and product tables
- [x] Remove misleading hardcoded Platform Healthy / Live labels; the dashboard header now says Operational Console
- [x] Total Users KPI and dashboard summary exclude test accounts and state that exclusion explicitly
- [x] Selected vendor identity shows name/company, email, role, location, account status, and verification
- [x] Allowance history resolves actor IDs to human-readable administrator names/emails/roles
- [x] Active Projects KPI opens Projects Management with `status=active` applied
- [x] Add Admin Project Detail route, server endpoint, owner/member links, and related counts
- [x] Project names in Admin Projects Management link to Admin Project Detail
- [x] Admin user summary group counts and total use the same real-user population
- [x] RFQ investigation replaces raw numeric request id with visible request search and selectable results
- [x] Promotion management for Featured and Sponsored supports search, status filters, sorting, and pagination
- [x] Platform search links users to Admin User Detail and projects to Admin Project Detail
- [x] RFQ investigation humanizes raw onboarding/account/bid/request statuses
- [x] Vendor Name Change Request and Admin Direct Name Correction with audit, notifications, and security tests
- [x] Admin User Detail gains allowlisted account editing for name, username, email, phone, and non-admin role
- [x] Internal Admin Notes for User Detail with permission controls, author/time, and non-public storage
- [x] Super Admin information-architecture reconciliation — capability → procedure → permission → route → page → sidebar → detail → deep link, reconciled end to end.
      TWO REAL DEFECTS FOUND BY WALKING PERMISSIONS RATHER THAN LABELS, both proven before changing anything:
      (1) "Professional registration summary" (dashboard) and "Pending Verifications" (/admin/compliance) were TWO ENTRY POINTS TO ONE WORKFLOW — the same `admin.complianceQueue` query filtered two ways in the browser, over the same applicants, driving the same `onboardingStatus` lifecycle through the same `updateApplicantStatus` mutation. No separate continuing-compliance model exists in the data, so they were consolidated into `/admin/registrations` rather than renamed.
      (2) PLACEMENT CURATION WAS REACHABLE BY NOBODY BUT A SUPER ADMIN. `AdminSponsorships`, `AdminFeaturedProviders` and `AdminFeaturedProducts` are gated on `marketplace.manage` but lived inside Operations, whose sidebar entry needs `audit.read`. MARKETPLACE_ADMIN — whose job it is — never saw Operations; USER_ADMIN saw it and got the components hidden. Moved to Placements, where domain and permission agree.
      Owner decisions implemented: Professional Registrations is a dedicated destination IMMEDIATELY BELOW User Management (asserted on adjacency, and clicked in a real browser); its full management surface left the dashboard, which keeps a three-count preview and a way through; Name Changes is a tab inside User Management; `/admin/compliance` and `/admin/name-changes` still resolve as declared aliases so saved bookmarks land on the capability.
      Nav regrouped into seven domains (Control · User & identity · Marketplace · Trust & support · Commercial · Insights & system · Administration); Vendor Billing renamed Billing & Benefits, since it holds plans, entitlements and overrides and no payments. Settings audited: no transaction-fee or commission control exists, so nothing implies payments BuildHub does not process.
      SCREENSHOT QUESTION ANSWERED, cause (A), proven by git: `/admin/categories` (56af8c1), `/admin/support` (b3e4bc8), `/admin/reviews` (69204d3) and `/admin/admins` (b060d5b) are all NOT ancestors of `origin/main` (3ae57ff, the deployed SHA). The deployment is behind this branch. Not permissions, not rendering, not translation — it resolves on merge.
      Evidence: `server/adminInformationArchitecture.test.ts` (69 — complete-control-plane invariant, adjacency, least privilege per role, EN/AR for every label and group, a 23-entry capability manifest proving nothing was lost in the move, and the section-permission rule); 9 mutations killed, one of which survived first and forced the manifest to match identifiers rather than substrings; five existing guards retargeted to the whole admin surface via `server/_testing/adminSurface.ts` rather than weakened; `evidence/zg-adminia-run1.txt` — every sidebar destination clicked in a real browser, EN + AR + RTL, 375/768/1440.
- [ ] System-wide entity-link/dead-control/raw-ID/raw-enum audit across remaining admin modules
- [x] Resolve count semantics and make Platform Healthy / Live labels reflect verified runtime state
- [ ] Vendor/business name clickable to Vendor Management across all remaining admin tables

## Staging Gate Correction after the PR #41 Merge

The merge of PR #41 into `main` deployed cleanly to staging - `/version` served the
authorized SHA - and the gate then reported 696/704 with eight failures. All eight were
STALE GATE ASSERTIONS, not product defects: each named a rule the merged work had
deliberately changed, and each was corrected to assert the rule that now exists rather
than relaxed to pass. Diagnosed against a live server and a real browser, not from source.

- [x] Section 33 x5 — `PROJECT_CREATOR_ROLES` was widened from `homeowner` alone to every
      professional role that delivers a job; supplier stays excluded. The loop that
      asserted four refusals was INVERTED, not deleted, and each role's project id is now
      asserted to exist. The refusal-message regex follows the message that replaced it.
- [x] Section 33 — corrected the stale doc comment above `projects.create`, which still
      described the narrower rule the code had stopped enforcing.
- [x] Section 14 — `submitQuotation` gained TWO requirements the gate routed around: a
      required `validUntil`, and response authority (an opened qualified enquiry, a live
      invitation, or an existing quotation). The old single-POST check had been asserting
      that a provider could quote WITHOUT consuming the entitlement that pays for access.
      The gate now walks the real journey (declare category -> open enquiry -> quote) and
      asserts the guard it used to bypass.
- [x] Section 14 — the `post` helper learned superjson's `meta` tags, without which a
      `z.date()` input can never be exercised over the wire.
- [x] Section 14 — the unapproved-provider, nonexistent-RFQ and negative-price controls
      now send fully-formed quotations, so each fails for the reason it names rather than
      for a missing field.
- [x] Section 26 x2 — the in-page admin tab strip was removed in favour of the single
      sidebar, and the full user table moved from `/admin` to `/admin/users`. Substring
      checks over the dashboard's innerText could not tell a missing surface from a
      renamed label - six of seven passed on incidental sidebar words. Navigation is now
      asserted BY NAVIGATING: each of the seven admin sections must render the surface
      only it renders, and `/admin` must show the compact summary WITHOUT duplicating the
      full table.
- [x] Mutation-tested the one new invariant that matters: disabling the response-authority
      guard turns the corrected section 14 red (2 checks fail). The old gate had no
      assertion that could have caught it.
- [x] 35/35 corrected assertions verified live before commit — 23 over HTTP against a real
      server, 12 in a real browser against the real bundle.
- [ ] Re-run `staging-qa.yml` against the deployed SHA with the corrected gate and confirm
      704/704 minus the five standing infrastructure SKIPs (SMTP_HOST, S3_* x3, paid AI).

## Central Category Management + Bulk Upload Reconciliation (HIGH PRIORITY)

Reported from real use: Bulk Product Upload rejects legitimate BuildHub categories -
"Waterproofing is not a BuildHub category", "Pools is not a BuildHub category" - across
dozens of rows. The fix is NOT to add two strings to an array.

ROOT CAUSE, established by inspection before any change. There are THREE unrelated
product-category vocabularies, none of them administrable:

1. `shared/productCategories.ts` - 19 flat English strings. This is the write-path
   validator for BOTH single product creation (`z.enum(PRODUCT_CATEGORIES)` at
   routers.ts:1778) and bulk import (`parseProductImport(csv, PRODUCT_CATEGORIES)` at
   routers.ts:1871). Single and bulk DO already share it, so the reported failure is not
   a parity bug - it is that the taxonomy is a frozen code constant. Neither Waterproofing
   nor Pools is in it, so single product listing rejects them too.
2. `client/src/lib/marketplaceData.ts` - a SECOND, completely different list of 20+
   categories with ids, EN/AR names and icons, used by the Marketplace Discovery Hub
   browse chips. Its values ("Cement & Concrete", "Steel & Reinforcement") match NONE of
   list 1, so a shopper browsing a hub chip can never find a product: no product can be
   listed under that name. This is a larger latent defect than the reported one.
3. `shared/rfqCategories.ts` - 9 SERVICE categories for RFQ-to-vendor matching, persisted
   in `rfqs.category` and `vendorCategories.category`. A separate and legitimate concern
   that must NOT be merged into the product taxonomy.

`products.category` is `varchar(100)` - free text in the database, constrained only at
write time by list 1.

- [x] CAT-1: forward-only migration for a canonical `productCategories` table - id, slug,
      nameEn, nameAr, type/scope (PRODUCT | SERVICE | BOTH), status (active | hidden |
      archived), parentId, sortOrder - plus a controlled alias table. Seed from the real
      current vocabulary; reconcile the three lists WITHOUT silently merging categories
      whose meaning differs. Verify the migration against seeded products/RFQs/placements,
      never only an empty database.
- [x] CAT-2: one canonical server category service. Authorized views over the SAME
      taxonomy - public active, vendor-listable, admin-all. Every UI reads it; no screen
      queries the table its own way.
- [x] CAT-3: category resolver used by BOTH single product and bulk upload, so the two
      can never diverge again. Case/whitespace/Unicode normalisation, canonical EN and AR
      names, slug, and Admin-controlled aliases. No fuzzy matching that could silently
      assign the wrong category. Ambiguous input is rejected with an actionable error.
- [x] CAT-4: error quality - distinguish UNKNOWN from KNOWN-BUT-INACTIVE from
      NOT-ALLOWED-FOR-THIS-VENDOR from SERVICE-ONLY from AMBIGUOUS-ALIAS. A hidden
      category must not report "is not a BuildHub category".
- [x] CAT-5: bulk upload UX - grouped error summary by offending value with row ranges,
      row detail retained, preview showing RESOLVED canonical categories before commit,
      and a valid-category reference reachable from the upload page rather than a stale
      help article.
- [x] CAT-6: Super Admin category management page - create, edit, activate, hide,
      archive, reactivate, reorder, EN/AR names, slug, type, parent, real usage counts,
      search/filter/sort/pagination. Dependency warning with the real count before hiding.
      Human-readable identities, not raw ids.
- [x] CAT-7: propagation without deployment - a new active PRODUCT category appears in
      Add Product, Edit Product, Bulk Upload, marketplace filters, admin forms and
      applicable RFQ/placement selectors. Cache invalidated on change; no restart.
- [x] CAT-8: lifecycle safety - hiding a category never corrupts or recategorises existing
      products; used categories are not hard-deleted; renaming does not break product
      relationships, import history, RFQs, URLs or placements (stable id/slug identity).
- [x] CAT-9: vendor eligibility preserved - adding a global category must not make every
      vendor eligible to list in it where BuildHub's catalogue rules restrict that.
- [x] CAT-10: RBAC (narrow admin permission) + audit of every category mutation with
      actor, timestamp, old and new value.
- [x] CAT-11: integration tests that exercise the real resolver, not source text -
      the reported Waterproofing/Pools case; Super Admin adds a category and a vendor
      bulk-uploads it successfully; Super Admin hides a category with existing products
      and they survive while new listings are refused with the INACTIVE message, then
      reactivation restores it. Plus single-vs-bulk parity as a standing invariant.
- [x] CAT-12: 375/768/1440 in EN and AR/RTL for the category management surface and every
      category selector; semantic controls, keyboard access, focus management.

CAT-1 through CAT-4 and CAT-11 are proven live, not merely unit-tested:
`evidence/zg-categoryupload.mjs` (39/39, run twice) drives the real HTTP server and a
real MariaDB - it uploads Waterproofing and Pools through the actual bulk parser and
asserts the stored `categoryId`, checks single-vs-bulk parity as a standing invariant,
plants and removes a genuine name collision to prove AMBIGUOUS is refused rather than
guessed, hides and reactivates a category to prove propagation with no deployment, and
confirms every name the browse filter offers is one a supplier may list against - the
latent defect that was larger than the reported one.

It also caught the THIRD write path. Add and Bulk were reconciled onto one resolver,
but `updateProduct` still took `category` as free text and never touched `categoryId`,
so a product created as Waterproofing could be edited to any string while its link
still pointed at Waterproofing - the reported defect reached through Edit instead of
Add. All three paths now resolve through `resolveCategory`, and the link moves with
the name.

That probe also found a second defect the unit suite could not: `suggestionsFor` used
substring containment and offered "Roofing" for the typo "Watrproofing", because
"watrproofing" ends in "roofing". Nothing was auto-applied, but a supplier accepting
that suggestion files a bitumen membrane under Roofing. Replaced with a bounded edit
distance plus prefix/whole-word narrowing over every key including aliases, so "Poolz"
now reaches "Swimming Pool Equipment" and nothing unrelated is proposed.

CAT-5 is proven in a real browser by `evidence/zg-categoryui.mjs` (44/44, run twice):
Chromium uploads real files through the real file input and reads what the screen
renders. Thirty identical category mistakes render as ONE grouped issue reading
"rows 2-31" with the near match offered; the per-row detail is retained behind a
collapsed disclosure and asserted to actually hold the thirty rows; the clean preview
shows "Pools -> Swimming Pool Equipment" before anything is written; and the acceptable
categories are listed on the upload page itself, read live from the taxonomy - the
screen's count is asserted equal to the database's. Covered at 375/768/1440 in EN and
AR with no sideways scroll at any size and the category NAMES in Arabic, not just the
heading, which discharges CAT-12 for this surface.

CAT-6, CAT-8, CAT-9, CAT-10 and CAT-12 land together in `/admin/categories`, gated on
`marketplace.manage` - the existing permission the roles table already describes as
"vendor directory, products, compliance review, marketplace content", rather than an
eleventh permission for one table.

Migration 0043 adds `category` to the `fieldValueHistory` and `commercialAuditEvents`
subject enums, appended at the END so existing rows keep their meaning: renames, scope
and status changes record OLD -> NEW with the actor, while creation and alias changes
record the action. Verified against the dev database's 50 fieldValueHistory and 19
commercialAuditEvents rows - every one kept its exact value - and the whole 44-migration
chain applies cleanly from empty.

The invariants are enforced in `server/categoryAdmin.ts` and checked by observing the
writes, not by reading the source: nothing there writes to `products`, so hiding or
renaming can never recategorise anything; the slug is immutable and has no input at all;
there is no delete endpoint; a name or alias another category already answers to is
refused at the point of choosing it, rather than becoming an AMBIGUOUS refusal a
supplier can do nothing about; and a status change echoes the count the screen showed,
so a stale confirmation is refused rather than applied to a situation nobody saw. All
four guards were mutation-tested.

Proven live by `evidence/zg-categoryadmin.mjs` (37/37, twice): real sessions walk
create -> supplier uploads into it with no restart -> rename -> hide -> refuse a new
listing as INACTIVE while existing products stay byte-identical -> reactivate, with a
SUPPORT_ADMIN and an ordinary supplier both genuinely signed in and both refused. And by
`evidence/zg-categoryadminui.mjs` (53/53, twice): the page is reached by CLICKING the
menu entry, the row count equals the database's, the product count equals the products
table's, there is no Delete control anywhere, the dependency warning names a real
non-zero count before anything changes, searching an alias finds the category that
answers to it, and the wrong administrator is told plainly rather than shown an empty
table - at 375/768/1440 in EN and AR, with the page never scrolling sideways and the
wide table scrolling inside its own container.

CAT-7 closes the loop. Every surface that offers a category now reads
`marketplace.categories`, and the compiled-in lists are DELETED rather than left
unused: `shared/productCategories.ts` is gone, `marketplaceData.PRODUCT_CATEGORIES` is
gone, and so are Marketplace.tsx's own `CATEGORY_AR` and `CATEGORY_ICONS` maps - a
fifth and sixth vocabulary, keyed on the retired 27-name list, which had already fallen
behind: the canonical "Cement & Concrete" appeared in neither, so an Arabic-reading
shopper saw an English chip with no icon.

Two further defects were fixed on the way. The Add Product form rendered the frozen 19
strings and client-validated against them, so a supplier could not pick Waterproofing
there either - it now reads the taxonomy, keeps a product's own category selectable when
an administrator has since hidden it (so hiding never makes existing products
unsaveable), and leaves the decision about which categories are acceptable to the
server. And the Marketplace Hub linked its chips with `?cat=<slug from a third
vocabulary>` while the marketplace ignored the parameter entirely - every chip landed on
the unfiltered marketplace. The link now carries the canonical name and the marketplace
honours it.

`server/categorySingleSource.test.ts` is the standing guard: it sweeps client, shared
and server for any file listing three or more canonical category names (comments
stripped, so the files that DOCUMENT the fix do not fail it), asserts every category
surface queries the one procedure, verifies the detector can still see a planted
violation, and pins the two words the product and RFQ vocabularies have always shared -
"Materials" and "Furniture" - so a third would be a deliberate decision rather than a
discovery. Proven live by `evidence/zg-categorysurfaces.mjs` (17/17, twice): the form
offers exactly the database's listable set, the Arabic chip renders in Arabic, a `?cat=`
link actually filters, and a category created in the database appears in the form, the
filter and the upload reference - then disappears from all of them when hidden - with no
restart.

## Truthful Error vs Empty States (P0-5)

- [x] P0-5: an outage must never render as an empty state. `const db = await getDb();
      if (!db) return [];` appeared 45 times in routers.ts, plus 8 more returning a
      zeroed shape - "No disputes have been filed", "0 registered users", "0 unread",
      "no subscription". Every one is a confident claim about the user's data, and
      every one is false when the database is unreachable. Replaced by ONE canonical
      `requireDb()` (server/_core/requireDb.ts) that throws with a message saying in
      words that this is not an empty result.

      It lives in `_core` rather than in db.ts for two reasons: db.ts is the connection
      module and should not import the transport layer to describe a failure, and every
      test that drives a procedure mocks './db' with a factory - a helper added there
      would have broken all of them at once for no benefit.

      What still degrades quietly does so deliberately and says so at its own
      definition: the analytics recorder and the commercial audit helper are
      side-channels, and failing a supplier's listing because a metric could not be
      written is the worse outcome. The ACCOUNT audit trail still THROWS, and
      `isSessionRevoked` still fails closed. Three policies, one decision: reads fail,
      side-channels swallow, privileged writes throw.

      The client half: AdminDashboard rendered `loading ? spinner : rows.length === 0 ?
      <EmptyState/>` for disputes, compliance and the user directory, so a failed fetch
      fell through to the middle branch. `usersFailed` was already destructured there
      and rendered nowhere - the observation existed, the honesty did not. All three
      now render a failure with Retry, in both languages.

      Proven live by `evidence/zg-outage.mjs` (22/22, run twice), which BREAKS THE
      DATABASE FOR REAL: it revokes the application account's SELECT, kills the pool's
      connections so the privilege change actually takes effect, verifies with a real
      table read that the account genuinely cannot read, then asserts every endpoint
      returns 500 or 401 rather than an empty list - and that all of them recover.
      Positive controls run first against a working database, so the outage half cannot
      pass against an endpoint that was broken all along.

      `marketplace.platformStats` is the one deliberate exception and is asserted
      separately: it memoises, so during an outage it serves the LAST REAL figures.
      Stale is not fabricated. What it must never do is report zero, which is exactly
      what its old `if (!db)` branch did.

      Recorded while investigating: a connection that survives an ACL change keeps the
      old privileges for its whole life, so restoring the grant alone leaves a pooled
      connection denied. That is MySQL's privilege semantics, reproduced in isolation
      with a bare drizzle+mysql2 pool outside this application - not a BuildHub defect.
      A real outage closes the sockets and mysql2 reconnects on its own.

## Referral Lifecycle (P1-REF)

- [x] REF-1: THE ENGINE HAS NEVER FIRED. `server/referralEngine.ts` read
      `referrals.campaignId` on every qualification attempt and NOTHING HAS EVER
      WRITTEN IT - the signup insert omits it and no other writer exists. Every
      referral in the product's history short-circuited at 'no campaign'. No reward
      has ever been granted by BuildHub, and none could have been.

      Implemented per the owner's decision, LATE BINDING AT QUALIFICATION:
      `server/referralCampaignResolution.ts` chooses the campaign when a real
      qualifying event fires, from what is eligible at that moment. Five rules make
      that safe rather than arbitrary - a TOTAL order (priority, then id) so the same
      input always selects the same campaign; eligibility BEFORE priority, with caps
      participating in eligibility so an exhausted campaign can never win and then
      fail to pay; one referral, one campaign, one reward; an already-set campaignId
      honoured rather than overridden; and the attribution window measured from the
      referral, so a two-year-old signup does not earn a reward because somebody
      finally verified their email. The refusal carries a reason PER CANDIDATE,
      because "your invite was 100 days old and the window is 90" and "no campaign is
      running for that event" are different answers to the same complaint.

      `shared/referralRewards.ts` retires the third copy of each closed set (the
      schema enum, the ledger enum, and a z.enum in the router), and migration 0044
      adds the two columns late binding needs - `priority` and
      `attributionWindowDays`, both defaulted so every existing campaign keeps
      working. Verified from empty across all 45 migrations, and against seeded
      campaign rows which kept every value.

      A SECOND, OLDER DEFECT surfaced the moment the first was fixed:
      `const [referrerRow, referredRow] = await Promise.all([...])` bound each name to
      a one-element ARRAY, so every `referrerRow.userRole` read `undefined` and both
      role checks compared against ''. It had never shown, because the function
      returned at 'no campaign' several lines earlier - on every referral, always.

      Proven live by `evidence/zg-referral.mjs` (24/24, run twice): a real inviter's
      real code, a real signup carrying it, a real administrator verifying the
      account, a campaign RESOLVED and BOUND, one reward row snapshotting its terms,
      and the ACTUAL ENTITLEMENT read back through the billing engine (5 -> 12
      qualified enquiries, with a real override row behind it). Plus the negative
      half: re-verifying grants nothing more, a higher-priority campaign arriving
      LATER does not re-bind a qualified referral, a second referral finds the
      exhausted campaign ineligible and takes the next one, and a signup aged past
      the window earns nothing at all.

- [x] REF-2: the ledger no longer claims more than the effect delivered. The reward was
      inserted as GRANTED before anything was applied, and BOTH calls that apply it
      return a refusal that was discarded - so a row could read GRANTED while the
      allowance was refused and the placement was never booked. It is now written
      PENDING, applied, and promoted to GRANTED only once the effect commits;
      otherwise REJECTED with the reason, the referral stays `qualified` (it did
      qualify - the payout is what failed), and the inviter is NOT told they received
      something they did not. PENDING/GRANTED/REJECTED were all already in the schema
      and nothing wrote anything but GRANTED.
- [x] REF-3 (placement half): the Spotlight is bookable where it can be seen.
      `category: 'General'` is neither GLOBAL_PLACEMENT_SCOPE nor a taxonomy value and
      publicPlacement matches scope EXACTLY, so every referral Spotlight ever booked
      was invisible on every surface. Now GLOBAL. `grantedBy` recorded the beneficiary
      as the grantor of his own placement; it is null - the platform - and both
      `setEnquiryAllowance.actorId` and `bookPlacement.grantedBy` were widened to
      `number | null` to match columns that were always nullable.
- [x] REF-3 (stacking half): entitlement rewards ADD instead of clobbering.
      `setEnquiryAllowance` writes an ABSOLUTE number and revokes the previous
      override - right for an administrator, wrong for "+5 on top of what they have".
      Routing the reward through it destroyed the administrator's grant, and when the
      reward's own expiry passed the vendor fell back to the PLAN value rather than to
      the administrator's number: a temporary bonus permanently deleting a permanent
      decision. Bonuses now live in their own key (`qualifiedEnquiryBonus`), are never
      revoked by each other, and SUM; an unlimited allowance stays unlimited. Migration
      0045 adds `referralRewards.effectRef` (`OVERRIDE:123` / `PLACEMENT:45`) so a
      reversal can undo exactly what a reward created rather than matching on a reason
      string that two campaigns could share.
- [x] REF-4: SUBSCRIPTION_EXTENSION is a real period extension, per the owner's
      decision. `extendSubscriptionPeriod` in server/billing/lifecycle.ts moves the
      END DATE and nothing else - a test sweeps every other vendorSubscriptions column
      and fails if any is written, and another refuses any money-shaped field. It
      extends FROM THE EXISTING END DATE (extending from `now` would confiscate a
      vendor's unused time and call it a reward), prefers the TRIAL end date while a
      trial is running, cannot move a period backwards however it is called, and
      REFUSES when there is no finite period rather than manufacturing one - which
      would be granting paid access nobody decided to give. Proven live: 21 days left
      plus 30 is 51, a free account is refused with that reason, and no payment,
      invoice or renewal event is written.

      A REAL DEFECT the probe exposed while proving this: a REJECTED reward was
      consuming the campaign cap. A misconfigured campaign - a reward value that is
      not a number, an extension for an account with no period - silently burned the
      inviter's one slot, and they could never be paid by that campaign. Only rewards
      that HAPPENED count now (PENDING, GRANTED, EXPIRED, REVERSED); REJECTED never
      did. REVERSED still counts deliberately, or reversal becomes a way to farm
      rewards.
- [x] REF-5: all five qualification events fire from real product actions, and the
      manual path grants. Only ACCOUNT_VERIFIED was hooked - the other four campaign
      types existed in the schema, in the admin form and in the resolver, and NOTHING
      in the product could ever fire them, so four of the five campaign types a
      marketplace administrator can create were decorative. Now:
      PROFILE_COMPLETED at the same line the product already treats a profile as
      complete; PROVIDER_APPROVED at BOTH the single and the bulk compliance review,
      so the reward does not depend on which button an administrator used;
      FIRST_VALID_RFQ and FIRST_VALID_QUOTATION_RESPONSE counted so the name is true
      (a quotation revision is not a new response - counted DISTINCT by RFQ).

      `admin.qualifyReferral` wrote `status: 'qualified'` and granted nothing - no
      reward, no notification, no entitlement. A permanent dead end that looked like
      it had worked. It runs the same engine now, preserves the administrator's note,
      and REFUSES with the reason when no campaign is eligible rather than returning
      success over a dead end.
- [x] REF-6: REVERSAL THAT REVERSES. `admin.reverseReferralReward` set
      `status: 'REVERSED'` on the ledger row and stopped: the entitlement stayed
      granted, the Spotlight kept running, the subscription kept its extra days.
      `server/referralReversal.ts` undoes the EFFECT, found through the
      `effectRef` the grant wrote rather than by matching a reason string. The
      target row must belong to the reward's recipient, so a tampered reference
      cannot revoke somebody else's entitlement; `parseEffectRef` matches one
      canonical shape whole (it accepted `OVERRIDE:1e3` as row 1000). Effect,
      ledger, referral status and audit run in one transaction with the reward
      row locked. SUBSCRIPTION_EXTENSION is deliberately NOT reversed and says
      so: the owner's decision forbids shortening legitimate time. Also fixed:
      the placement reward was still invisible - `spotlightProviders` returns []
      for GLOBAL by design, so TYPE_CATEGORY_SPOTLIGHT + GLOBAL is a combination
      no reader queries. It is a root-scope BOOST now, which the unfiltered
      vendor directory does read.
- [x] REF-7: EXPIRY AS DERIVED STATE, and the ledger gets screens. Nothing had
      ever written `EXPIRED`, so a lapsed bonus still read GRANTED. It is derived
      at read time from `expiresAt`, exactly as entitlement overrides and
      placements already are, with the stored value kept beside it. Two more
      silent `.limit(250)` truncations paged with real totals, and the browser
      filtering that answered "no matches" for a row it never loaded moved into
      the query. The Reward column read two columns nothing has ever written and
      showed "-" on every row; it reads the real ledger now. A user-facing
      reward history that names nobody they invited.
- [x] REF-8: ANTI-ABUSE. The cap was checked and consumed in separate
      statements, so two simultaneous qualifying events for one inviter both
      read "cap intact" and both paid; the inviter's row is locked for the whole
      check-and-claim now. `GLOBAL_REFERRAL_REWARD_CAP` bounds an account across
      ALL campaigns, which nothing did. A referral code matching no account, or
      the signer's own, was dropped in silence - audited now, without telling the
      user, which would make signup an oracle for which codes exist.
- [x] REF-9: BENEFITS AND LIMITS. `billing.myEntitlements` and `billing.myPlan`
      had no screen at all. Plan + administrator grant + bonuses, adding to the
      number the platform enforces, with usage, remaining and reset beside it -
      and when the parts do not add up, it says so. Fixed on the way: the
      ADMINISTRATOR's own allowance view ignored bonus rows and showed a number
      lower than the one being enforced.
- [x] REF-10: CAMPAIGN ADMINISTRATION. Reward terms and eligibility could not be
      edited at all; they can be corrected until the campaign grants its first
      reward and are fixed after, while the schedule and caps stay editable. The
      attribution window is settable at creation. Campaigns have a screen.
## Master Reconciliation Remaining Scope

- [x] Referral / Invitation Reward system: secure code/link, attribution, campaigns, qualification, caps, non-cash rewards, expiry, reversal, notifications, audit, Admin management — the umbrella over the sub-items below, all of which are now checked. Late campaign binding at qualification (owner decision 2), all five qualification events wired, three reward types with real effects, reversal that reverses, expiry derived at read time because BuildHub has no job runner, attribution/qualification/reversal notifications in EN+AR. Evidence: `server/referralEngine.test.ts` and siblings, `evidence/zg-referral-run1.txt` / `-run2.txt`.
- [x] Referral foundation: per-user secure code, signup attribution, referrals ledger, Invite & Earn Settings surface, Admin endpoint
- [x] Admin Referral Management list with search/filter and humanized referrer links
- [x] Referral campaign and reward ledger backend, campaign CRUD endpoints, manual qualification, reward reversal, and RBAC gating
- [x] Centralized referral qualification engine connected to real account-verification event; effective EXTRA_QUALIFIED_ENQUIRIES reward grant
- [x] Commercial placement schema extension: source, package, surface, and entityType on canonical vendorSponsorships engine
- [x] Canonical placement booking service with Master exclusivity, Spotlight capacity, eligibility checks, and overlap validation
- [x] Admin commercial placement list surface and booking API
- [x] Referral TEMPORARY_FEATURED wired through canonical placement engine as non-exclusive Spotlight
- [x] Product placement model added to canonical engine with productId support
- [x] Admin commercial placement create-booking form with package/surface/scope/dates/priority
- [x] Product placement create-booking selector and mixed Provider/Product booking flow
- [x] Server-enforced package/surface integrity with targeted placement-rule tests
- [x] Master exclusivity and Spotlight capacity/overlap behavior covered by placement booking tests
- [x] Complete Dispute lifecycle: relationship eligibility, reference, respondent, evidence, participant communication, internal notes, assignment, priority, statuses, resolution, controlled reopen, notifications, audit — polymorphic subject PROJECT|RFQ|QUOTATION (owner decision 1), one eligibility service (`server/disputeEligibility.ts`), a real state machine (`server/disputeWorkflow.ts`), evidence with per-dispute download authorization, `/disputes` + `/disputes/:id` + the admin queue. Evidence: `server/dispute*.test.ts`, `evidence/zg-disputeuser`, `zg-disputequeue`, `zg-disputematrix` (each run twice).
- [x] Support Tickets: user create/category/description/attachment/updates, Support Admin search/filter/assign/respond/request-info/resolve/close
      (shared/supportTickets.ts, server/supportTickets.ts, migration 0047, /support + /support/:id +
      /admin/support; 38 unit tests, 33 live checks in evidence/zg-support.mjs, 13 mutations killed)
- [x] Reviews / Reputation: relationship eligibility, self-review prevention, duplicate prevention, provider response policy, reporting, moderation, restore/hide, audit — `shared/reviews.ts` (vocabulary), `server/reviewModeration.ts` (respond / report / hide / restore / resolve, one `visibleReviewFilter()`), migration `drizzle/0048_review_moderation.sql`, admin queue `client/src/components/AdminReviewModeration.tsx` at `/admin/reviews`, reply + report controls in `VendorReputation.tsx`. Evidence: `server/reviewModeration.test.ts` (27, 8 mutations killed), the reader census in `server/vendorReputation.test.ts` (7 mutations killed, and it caught `rfq.quotations` still counting hidden reviews through its own inline predicate), `evidence/zg-reviews-run1.txt` / `-run2.txt` (38/38 twice, clean-up asserted).
- [ ] Full Vendor Management command centre with real applicable modules and cross-links from Admin surfaces
- [x] Benefits, Limits & Privileges: central entitlement view showing base, campaign/referral, individual overrides, effective, used, remaining, reset/expiry (REF-9)
- [ ] Admin Notes: internal-only, permission-controlled, authored/timestamped, never public
- [x] Admin Audit UX: search/filter/sort/pagination and humanized actor/target identities — `server/adminList.ts` was written to end one defect and its own header names it: a screen that truncates silently and filters what is left in the browser answers "nothing matches" when the match is past the cut, with exactly the confidence it answers correctly. THE AUDIT SURFACE WAS STILL DOING IT IN BOTH READERS — `fullAuditReport` took the most recent 1,000 and returned a bare array, `accountAudit` the most recent 100 per account, neither with a total, neither with a filter, a search or a page. An audit report is the one screen whose entire value is that it is COMPLETE; one that quietly stops at a thousand is worse than none, because it will be relied on. `server/accountAuditView.ts` routes both through the canonical `adminPage`, so the count and the rows are filtered identically by construction. IDENTITIES, NOT IDS: both accounts are LEFT joined — never inner, because both id columns are nullable ON PURPOSE so the trail outlives its subject, and an inner join would drop exactly the events about deleted accounts. An actorless event reads "System" rather than a blank column that invites the reader to assume an administrator did it. The old report also built its identity columns from a map over EVERY user row in the database — passwordHash and invitationToken included — to decorate an export; it now joins the six columns it actually needs. Search reaches both identities and the note, because an administrator searching a name means the person and does not care which side they were on; an action is matched EXACTLY, since `admin_user_frozen` and `admin_user_unfrozen` share a prefix and a prefix match would conflate freezing with releasing. Filter options are read from the data, not a restated list. The PDF export walks every page, or it would have replaced a silent truncation at 1,000 with one at 25. THREE EXISTING SUITES CAUGHT THINGS AND WERE RIGHT TO: `searchInputHardening` found that I had written a second LIKE escaper instead of using the canonical `containsTerm`; `adminList` found that both procedures were still on its bounded-by-nature exemption list, now stale; `adminUserDataSecurity` and `invitationAudit` were restated at the rule's new address and strengthened rather than bumped. Evidence: `server/accountAuditView.test.ts` (24), 8 mutations killed. `evidence/zg-audit-run1.txt` / `-run2.txt` (23/23 twice, identical verdicts: 1,200 seeded events — more than the old cap — all reported, all reachable by paging exactly once, a search finding row 1,151, the count and rows agreeing under a join-spanning search, an event with no subject and no actor still appearing, and no credential column anywhere in the response). The probe's own first run reported 1,204 where 1,200 were expected: the product was right and the probe's search token was too loose, fixed rather than accommodated.
- [x] Product image management: upload, primary, additional, replace, remove, reorder, persistence, ownership — verified as ALREADY BUILT rather than rebuilt: `marketplace.uploadProductImage` sniffs the real bytes (`assertUploadedFileMatches`) and writes only `product-images/user-<id>/`; `setProductImages` re-checks every URL against the caller's own prefix, refuses path traversal past it, refuses duplicates, and carries `supplierId` in its UPDATE predicate; ordering IS the primary image (`images[0]`), so reorder and "make primary" are one operation and cannot drift; `shared/productImages.ts` holds the limits both sides use; the dialog in `SupplierCatalogue.tsx` does upload/reorder/remove/primary. Covered by `server/supplierCatalogue.test.ts` (ownership, traversal, duplicate, order) and `server/storagePortability.test.ts`.
- [x] Product lifecycle states: Draft, Active/Published, Inactive, Archived, preferring archive/deactivate where history matters — `products.active` was a BOOLEAN: a half-written draft, a line temporarily off sale and a product discontinued last year all read as `active = 0`. `shared/productLifecycle.ts` (four states, declared transitions, EN/AR labels + help), `server/productLifecycle.ts` (`publicProductFilter()` as the ONE definition of publicly visible, `transitionProduct()` as the one writer), migration `drizzle/0049_product_lifecycle.sql` (backfilled from the boolean — `active=1 → 'active'`, `active=0 → 'inactive'` — verified against seeded rows carrying both values, with the boolean kept for one migration as a derived column on the `disputes.projectId` precedent). Archive, never delete. Archiving a product with a live placement is refused rather than silently breaking a paid slot. Surfaces: draft/publish choice on the product form, per-transition controls + a named state on every catalogue row, a four-state filter on the admin product list. Evidence: `server/productLifecycle.test.ts` (24; 8 mutations killed, one of which — a reader building its own predicate — is the class of defect the boolean invited), restated procedure tests in `server/supplierCatalogue.test.ts`, `evidence/zg-productlifecycle-run1.txt` / `-run2.txt` (28/28 twice, including the migration's agreement across every row in the database).
- [x] Service management for service providers distinct from physical product catalogue — a supplier could list a product with a name, description, unit, price and lifecycle; the four roles that sell WORK could declare one of nine coarse RFQ categories and nothing else, so a homeowner looking for bathroom waterproofing saw a badge reading "Renovation". THE SCOPE WAS ALREADY THERE AND UNUSED: `productCategories.scope` has carried a SERVICE value since the taxonomy was consolidated, with a comment reading "PRODUCT and BOTH are listable; SERVICE is deliberately not", and zero rows ever used it. `shared/serviceCatalogue.ts` (six pricing bases with quote_on_request FIRST-CLASS and the default — most Egyptian construction work is priced per job, and a catalogue demanding a number is answered with invented ones; it is also the only basis that FORBIDS a figure, because "quote on request, EGP 500" tells a customer two things and they believe the number). REUSES RATHER THAN FORKS: the lifecycle is IMPORTED from productLifecycle, not restated (`SERVICE_STATUSES === PRODUCT_STATUSES`, pinned by test), and a service is filed under the one canonical administrable taxonomy so it inherits the Super Admin category screen. The TARGETING declaration (`profile.setMyCategories`) stays separate and untouched — "what I get sent" and "what I advertise" are different statements. `server/serviceCatalogue.ts`: visibility has TWO clauses, live offering AND approved account, because a service is somebody turning up at your home; publishing needs approval while DRAFTING does not, so a provider being vetted arrives at a ready catalogue; another provider's service is NOT_FOUND, never FORBIDDEN. Migration `drizzle/0052_service_catalogue.sql` seeds 20 real Egyptian trades bilingually with INSERT IGNORE — verified against the live database that the 35 PRODUCT-scope rows were not rescoped underneath the products filed against them — and ALTERs the commercialAuditEvents enum, because a TypeScript union widened alone compiles and then fails at MySQL on the first published service. `shared/roleMatrix.ts`'s `service` row corrected: it described only the category declaration. Evidence: `server/serviceCatalogue.test.ts` (61), 19 mutations killed — three SURVIVED first and each was an instrument failure, not a product one: `toContain("'SERVICE', 'BOTH'")` passed on the widened `['SERVICE','BOTH','PRODUCT']`, `toContain('basisAcceptsPrice')` passed with `const showsPrice = true` because the identifier still appeared elsewhere, and a three-spelling regex for zero-defaults missed `n(min ?? 0)`. Four existing census suites (authorizationSweep, dataIsolationMatrix, commercialAudit, roleMatrix) each caught the new surface and were acknowledged with a written reason rather than a count bump. `evidence/zg-services-run1.txt` / `-run2.txt` (34/34 twice, identical verdicts: the seed rescoped nothing, an unapproved provider drafts but cannot publish, quote-on-request with a price is refused over HTTP and writes nothing, withdrawing a provider's approval hides a live service while leaving the row intact), `evidence/zg-servicesui-run1.txt` / `-run2.txt` (25/25 twice: the price boxes really vanish on quote-on-request, a real click publishes and the result is read back from the PUBLIC vendor page in a signed-out browser, no raw keys in EN or AR, no horizontal overflow at 375/768/1440).
- [x] Reported from real use on staging: a provider was shown an enabled "Open qualified enquiry" button, clicked it, and was told the request does not match any of their declared service categories — the owner's words were "it would be better to not see it from first place". THE REFUSAL WAS CORRECT; OFFERING THE ACTION WAS NOT. Nothing could answer "would opening be granted" ahead of the click, because that decision lived only inside `openQualifiedEnquiry`, which SPENDS A CREDIT and so obviously cannot be called to find out; `getRfqResponseAccess` answers the different question "do you ALREADY have access". `previewQualifiedEnquiry` answers the first one read-only — it writes nothing, marks no invitation viewed and spends no allowance, so it is safe on render, which is the entire point — and it SHARES THE ACT'S HELPERS rather than restating the rule: the same `hasOpenInvitation`, `isClassifiableRfqCategory`, `getVendorCategories`, `isVendorEligibleForCategory` and `getEnquiryUsage`, in the same order, because a second copy of an eligibility rule is exactly how a preview starts promising what the act refuses. It adds one refusal the act does not have — a CLOSED request is not worth a credit, and "you cannot quote on this" and "this is not your trade" are different things to tell somebody. Every reason is a KEY, never a server-built sentence, so the Arabic screen is not handed English. THE LIVE PROBE THEN CAUGHT A REAL DEFECT IN THE NEW CODE, which is why it exists: the procedure skipped the preview whenever the caller could already respond, on the reasonable-sounding ground that there is nothing left to offer — but an open INVITATION is itself `canRespond`, so the preview's invitation branch could never run, and the payload answered `canOpen: false` to a provider whose `openEnquiry` call returns 200. An invited provider is entitled to that work; the API was contradicting the act in the one case most likely to be got wrong. The preview is now unconditional, and its unit test was corrected from asserting the skip to forbidding it. Evidence: `server/enquiryPreview.test.ts` (20), 10 mutations killed — one SURVIVED first and was an instrument failure, a regex requiring a quote immediately after `openBlockedReason:` that never saw a sentence introduced through a ternary, which is how one would actually be written. `evidence/zg-eligibilityui-run1.txt` / `-run2.txt` (20/20 twice, the RENDERED pages, because the report was a screenshot and an API contract cannot answer it: the button is ABSENT rather than disabled on both the respond page and the RFQ detail page, the reason and the one actionable fix stand in its place, it is still there for the provider who can use it and still says what the click will cost, an invited provider lands straight on the form and is told the lead is free, the Arabic screen is genuinely Arabic with no raw key and no button, and there is no horizontal overflow at 375/768/1440; the mutation that restores the reported bug takes it to 10/20). THE UI PROBE'S FIRST RUN REPORTED THREE FAILURES THAT WERE NOT REAL, and both causes were in the instrument: fixed sleeps, which let assertions about an ABSENT button pass against a page that had not finished deciding, now replaced by waiting for the page to have reached one of its four outcomes; and a shared cookie jar — CDP cookies belong to the browser, not the tab — so signing the invited provider in silently re-authenticated the mismatched provider's open page and the probe went on reading the wrong person's screen. Every navigation now re-asserts its identity and CHECKS it against the server, because a probe that can quietly become somebody else proves nothing about either of them. `evidence/zg-eligibility-run1.txt` / `-run2.txt` (19/19 twice, identical verdicts: the preview and the act agree on a matching category, a mismatched one, an invitation and a closed request; five renders spend no credit; an invitation outranks the category gate and costs nothing, proven by the meter; the button is still there for the people who can use it; and a signed-out caller, a homeowner and a nonexistent request are refused UNAUTHORIZED, FORBIDDEN and NOT_FOUND rather than handed a preview).
- [ ] RFQ basket workflow: select/add/remove/quantity/notes/specifications/persistence/submit without duplicate RFQs
- [ ] Complete RFQ Detail navigation and authorized requester/project/items/attachments/status/response action
- [ ] Supplier answer editing/moderation policy — retain as OWNER DECISION unless already resolved
- [ ] Team / Organization management: concrete company role model and authorization plan if architecture requires redesign
- [x] Notification preferences for noncritical channels; mandatory security/legal notifications remain mandatory — a user could not turn ANY notification off, so a supplier with forty listed products received a notification per question and the only remedy was to stop reading the bell, which also silences the compliance decision two rows below. `shared/notificationPreferences.ts` (14 categories derived from the 31 real call sites, not invented; five mandatory — account, compliance, billing, disputes, moderation — each carrying the reason it is locked; longest-prefix key resolution, so `notif.review.received` is mutable while `notif.review.reportResolved` is not, and gaining a referral reward is mutable while `notif.referral.reversed.*` is not). ONE CHANNEL, SAID OUT LOUD: BuildHub delivers in-app only — no mail provider is configured and no notification is routed to one — so the screen names email and SMS as unavailable instead of offering switches wired to nothing. `server/notificationPreferences.ts` holds the gate at the single `notifyUser`/`notifyUsers` seam, per recipient in the bulk path; mandatory is decided BEFORE the table is read and suppression rows for mandatory categories are stripped where rows are read, so neither check alone is load-bearing; an unrecognised key and a failed lookup both DELIVER. Migration `drizzle/0051_notification_preferences.sql` stores only overrides — absence means on, so nothing is backfilled and a category added later is on for everybody. Evidence: `server/notificationPreferences.test.ts` (51; a census that fails the build if any messageKey in the server tree is unmapped, plus an ambiguity check that catches a templated key whose expansion could outrun its own category), 15 mutations killed — one of which, first-match-vs-longest-prefix, SURVIVED because the test compared a reimplementation against the real function and the two agreed while one was wrong; the resolver now takes its table as an argument so the test runs the product rather than a copy of it. `server/negativeControls.test.ts` restated from a count of `eq(notifications.userId, ctx.user.id)` to the property it was reaching for — every procedure takes its subject from the session — and re-killed with 4 further mutations. `evidence/zg-notifprefs-run1.txt` / `-run2.txt` (28/28 twice, identical verdicts: the switch really stops the row while an identical control account still receives it, a suppression row written STRAIGHT INTO THE TABLE still cannot stop a compliance decision, and every mandatory category is refused FORBIDDEN over HTTP with nothing written), `evidence/zg-notifprefsui-run1.txt` / `-run2.txt` (22/22 twice: a real click persists and survives a reload, a locked switch writes nothing, no raw keys in EN or AR, no horizontal overflow at 375/768/1440).
- [ ] Admin analytics using real data only; no fabricated revenue/orders/GMV/commissions while payments are deferred
- [ ] AI knowledge completeness separated from AI engine capability; no fabricated primary-source authority
- [ ] Performance/reliability review: unbounded queries, N+1, pagination, indexes, image payloads, debounce, double-submit/idempotency
- [ ] Accessibility and mobile/RTL pass at 375/768/1440 for all modified areas
- [ ] Public SEO/discovery for crawlable marketplace content while keeping private RFQs/projects/messages/admin non-indexed
- [ ] `projects.spent` vs live expense-log sum — retain as OWNER DECISION unless resolved
- [ ] Admin impersonation: classify SECURITY ARCHITECTURE REQUIRED unless a safe time-limited, audited, banner-protected mechanism exists
- [ ] Payment gateway remains OWNER-DEFERRED; no live payments, orders, transactions, revenue, GMV, commissions, or cash rewards
- [x] Quotation revision model: ONE current quotation per supplier per RFQ + immutable controlled revision history + version/actor/time/change audit + privacy — INVESTIGATED BEFORE BUILDING, and most of it was already there: a later bid supersedes the previous version inside a transaction, `revisionNumber` increments, every reader filters `supersededAt IS NULL`, and `quotations.get` is requester-or-author with NOT_FOUND for everyone else. The KNOWN GAP comment at the top of `submitQuotation` had OUTLIVED that decision by several changes, telling the next reader to go and decide something already decided and built; it is replaced with what the code does. TWO REAL DEFECTS found and fixed. (1) THE CHANGE AUDIT RECORDED EVERY REVISION AS A CHANGE FROM NOTHING: `recordFieldChanges` passed `oldValue: null` for every field, so revision 4 read "price was nothing, now 145,000" where the truth was "was 125,000, now 145,000" — the one question a revised bid raises. The superseded row is now loaded whole and contrasted field by field; an unchanged field produces no row at all, and the price is compared as a NUMBER so "145000.00" vs 145000 is not reported as a change. (2) DE-DUPLICATION MATCHED ON THE PRICE ALONE while its own comment said "the same price and the same timeline" — the code did not do what its comment claimed. A supplier who submitted 145,000 over 45 days, noticed the timeline was wrong and resubmitted 145,000 over 60 days was told `success: true` and handed back the FIRST quotation; the corrected timeline was discarded and the customer never saw it. Correcting a mistake is the likeliest reason to resubmit within seconds, which is exactly the window that swallowed it. A duplicate is now the same OFFER — every commercial term — compared in JS so NULL on both sides means equal, with currency compared against its column default and validUntil to the second because MySQL timestamps carry no milliseconds. Evidence: `server/quotationRevisions.test.ts` (18) and `server/duplicateSubmission.test.ts` restated — its test was named "so a revised bid is not mistaken for a double-click" while asserting the very mechanism that caused that, so it was restated to its own intent and strengthened rather than bumped; 13 mutations killed across both. `evidence/zg-quotationrevision-run1.txt` / `-run2.txt` (26/26 twice, identical verdicts). The probe found defect (2) itself, and two of its own bugs on the way: it POSTed to a query and read the empty result as "no duplicates", which made a later check pass vacuously — both are now asserted against.
- [x] Complete quotation workflow: detail, statuses, comparison, validity, timeline, warranty, payment/commercial terms, attachments, accept/reject, revision, expiry, notifications — the detail page, the statuses, the comparison screen, warranty, timeline, both terms fields, attachments, accept/reject through the locked `quotationWorkflow` transaction, the revision model (QREV) and the notifications ALL already worked and are untouched. ONE REAL DEFECT, and it was the commercial one: EXPIRY WAS ENFORCED NOWHERE. `validUntil` is REQUIRED on every quotation, stored, rendered on the comparison screen and pinned in `fieldHistory` — and nothing ever read it back. Reproduced against the running product before a line was written: a quotation whose validity ended on 1 January was ACCEPTED on 12 September, its status moved to `accepted`, every other bid on the request was auto-rejected around it, and nothing had told the customer the price was months stale. A supplier who writes "this holds until 1 October" means it; binding them to it in December is the platform enforcing a commitment that was never made. `shared/quotationValidity.ts` is the one rule, imported by both halves rather than restated — a second copy is how the button and the server start disagreeing. THE DAY IS INCLUSIVE: "valid until 1 October" covers the whole of it, which is how the SUBMISSION rule already reads it (it accepts a validity of today), so a reader that expired at 00:00 would refuse on the morning of a date the writer had just been allowed to enter. A quotation with NO validity date is not expired — nothing can write one today, but historical rows predate the requirement and retiring bids nobody withdrew would be a second defect. The act refuses INSIDE the transaction and AFTER the row lock, beside the status check, because both are statements about the row at the moment of the decision; REJECTING an expired bid is still allowed, since clearing a stale price off the board is reasonable and refusing it would leave the request cluttered. Expiry is DERIVED AT READ TIME on all three readers — the customer's comparison, the supplier's own list (they are the only party who can re-confirm the price) and the detail page — never stored, because BuildHub has no job runner and a stored flag would be a lie between the moment the price stopped holding and the moment something wrote it down, which is the same derived-state discipline entitlement overrides and placements already follow. The screen withholds the accept button and gives the reason in its place (ELIG's rule on the other commercial control), keeps the reject button, marks the card, and BEST VALUE IS NO LONGER AWARDED TO AN EXPIRED BID — a ribbon recommending the one card whose accept button is missing is worse than no recommendation. Evidence: `server/quotationExpiry.test.ts` (19), 7 mutations killed including moving the check before the row lock and making the day exclusive. `evidence/zg-quotationexpiry-run1.txt` / `-run2.txt` (18/18 twice, identical verdicts: the refusal is a CONFLICT that says what to do next, NOTHING moves when it refuses — not the bid, not the losing bids, not the request, and nobody is told they won — a live price is still accepted, a quotation valid until TODAY is still live and acceptable, and a supplier cannot accept a bid on somebody else's request). The probe kills its own mutation decisively: disabling the check takes it from 18/18 to 10/18. NOT BUILT, and recorded rather than left looking forgotten: there is no quotation WITHDRAWAL — `quotations.status` has no `withdrawn` value although the commercial-audit union carries the verb — so a supplier who wants to pull a bid must let it expire or ask the customer to reject it. That is a schema change and its own piece of work, and the tracker line does not name it.
- [x] Project Members: view/invite/add/capability/role-change/remove with removal access revocation and unrelated-denial — viewing, adding and the capability model already worked and are untouched, and removal ALREADY revoked access correctly (`requireProjectAccess` constrains on `removedAt IS NULL`), which the probe proves rather than assumes: a removed member loses the project, its documents and the team list immediately, on the same session, and an unrelated account is refused every one of them server-side. THREE REAL DEFECTS, each reproduced against the running product before anything was written. (1) A CAPACITY COULD NOT BE CHANGED AT ALL. `addMember` refuses a live member with CONFLICT, so promoting the site engineer to manager meant REMOVING them and ADDING them back — which resets `assignedAt`, erases the `removedAt` and `removedBy` recording they were ever taken off, and sends them a "You were added to a project" notification for a project they never left. The project role decides what they can do, so this is not a cosmetic field. `projects.changeMemberRole` is its own verb: same 'manage' capability, ownership still ungrantable, the owner's own capacity still untouchable, and a REMOVED member is NOT promoted back in — quietly restoring access is the opposite of what removing them meant. Setting the role somebody already holds is reported as no change rather than as a change, and writes no event. (2) `removeMember` REPORTED A REMOVAL THAT HAPPENED AS `removed: false` — always, for every removal. It read `result.rowsAffected`; mysql2 answers `[ResultSetHeader]` and the count is at `result[0].affectedRows`. The flag exists precisely to tell "I took somebody off" from "that person was not on it", and both answered false; the screen toasted "Member removed!" either way. BuildHub had THREE spellings of that read, which is how one of them ended up asking the question wrongly — there is one now, `server/_core/writeResult.ts`, defensive about the SHAPE rather than the spelling, returning 0 rather than NaN for an answer it does not recognise because `NaN > 0` is false and would read as "nothing happened" at every call site. The other three sites were migrated to it and their tests restated at the rule's new address. (3) NONE OF IT WAS AUDITED. Adding somebody to a project, changing their capacity on it or taking them off it decides WHO CAN READ the customer's documents, RFQs and quotations, and "who let the other contractor see our drawings, and when" had no answer anywhere. Migration `drizzle/0053_project_membership_audit.sql` widens `commercialAuditEvents.subjectType` with `project` — the TypeScript union alone compiles and then fails at MySQL on the first membership change — and all three acts are recorded, the role change carrying what it changed FROM, the removal written only when one actually happened. `subjectId` is the PROJECT, never the person: the trail is queried by it, and "everything that happened to project 12" is the question a dispute asks. FIVE EXISTING CENSUS SUITES CAUGHT THE CHANGE AND WERE RIGHT TO — `dataIsolationMatrix` required the new procedure to carry the same proof-carrying session check as `addMember` rather than a bare allowlist entry; `commercialAudit` made the three new call sites declare which table their `subjectId` names; `adminInvitations` and `testLoginLinks` pinned the old affected-rows spelling and were restated to the conditional burn they actually protect; `reachability` refused the procedure until a client called it. Evidence: `server/projectMemberRole.test.ts` (18), 6 mutations killed. `evidence/zg-projectmembers-run1.txt` / `-run2.txt` (26/26 twice, identical verdicts), and the probe's own mutations kill it: dropping the removed-member guard takes it to 25/26, breaking the affected-rows reader to 23/26.
- [x] Project Documents: upload/list/open/download/replace/archive/remove with authorization and no cross-project leakage — P1 FIXED FIRST: the storage proxy resolved the project OWNER only for `project-documents/`, while `projects.documents` has listed documents for every live member since PM-A2 — so a contractor on the team saw a drawing in the list and got a refusal on the file. One rule now (`canAccessProject`, the non-throwing form of `requireProjectAccess`), not two drifting copies. Then the lifecycle: `server/projectDocuments.ts` (one access door, archive/restore, replace-as-a-link), migration `drizzle/0050_document_lifecycle.sql` (archivedAt/archivedBy/archiveReason/supersededById, applied against seeded rows), `projects.replaceDocument` / `archiveDocument` / `restoreDocument`, and archive/restore/replace controls plus a Show-archived toggle in `ProjectDocuments.tsx`. Archive, never delete — a contract or a BOQ is evidence, and a dispute six months later is when the superseded revision matters. Retiring one is the uploader's or the project manager's, never another trade's. Evidence: `server/projectDocuments.test.ts` (27) and the widened `server/storageProxy.test.ts`, 8 mutations killed (including the owner-only regression and archiving before the replacement exists); `evidence/zg-documents-run1.txt` / `-run2.txt` (23/23 twice). BLOCKED BY INFRASTRUCTURE and stated as such in the probe: object storage is unconfigured locally, so the file checks assert the AUTHORIZATION decision (403/401 refused vs 503 authorized-then-no-backend) rather than a 200 body, and the successful replace upload is unit-level only.
- [ ] Homeowner self-service second pass: profile, projects, members, documents, RFQ basket, RFQs, attachments, invitations, quotations, comparison, accept/reject, messages, notifications, settings
- [ ] Project Manager self-service second pass: authorized creation/management, members, documents, RFQs, invitations, commercial authority by capability, messages, notifications, settings
- [ ] Contractor/Engineer/Architect/Designer/other-provider self-service parity with shared provider architecture
- [x] Enquiries work queue: dedicated page, search/filter/status/date/category/source/RFQ reference/response state, open/respond, pagination — THREE DEFECTS, each proven against the running product before anything was written. (1) A LEAD THE PROVIDER PAID FOR DISAPPEARED. `rfq.eligible` read `where status = 'open'`, so the moment the customer closed or awarded the request it was gone from the only list the provider had — while the credit stayed spent and the usage meter still counted it. Reproduced live: open an enquiry, close the request, and the row vanishes from a queue that still bills for it. Nothing else in the product listed it either; every other provider-scoped read of `qualifiedEnquiries` is a single-row existence check or a monthly count, so a provider could not answer "what did I spend this month's leads on". (2) IT TRUNCATED SILENTLY AT 50, returning a bare array with no total — the exact defect class `server/adminList.ts` exists to end, on a provider's commercial work queue rather than an administration screen. (3) AND THE PAGE LIED ABOUT ITSELF: `/enquiries` was titled "Qualified enquiries" and subtitled "The requests you have opened", over a list of requests they COULD open. `server/enquiryQueue.ts` unions the three ways a request reaches a provider in ONE query so the count and the rows cannot disagree — an opened enquiry and an invitation AT ANY RFQ STATUS, because those are records rather than offers, and a receipt that disappears when the other party closes the file is not a receipt; only the category arm is limited to open requests, because it is the only one that is an offer. `source` and `responseState` are SQL expressions the list RETURNS and the filters COMPARE AGAINST, so a row cannot be labelled one thing and filtered as another. Paged through the canonical `adminPage`, searched through the canonical `containsTerm`, with a reference search that matches the id rather than the digits inside a title. The truncating `listEligibleRfqs` is deleted rather than left one import away, and the dashboard card is now served by the queue with a real total. THE TRUNCATION CENSUS WAS BLIND TO IT: `adminList.test.ts` reads `routers.ts` only, so a truncation that lives in a helper module is invisible — it is now extended to the helper modules the routers delegate list reads to, judging each `.limit()` by ITS OWN chain rather than by whether anything in the file is paged, and counting a `limit = 50` default parameter as the truncation it is. TWO EXISTING SUITES CAUGHT THE CHANGE AND WERE RIGHT TO: `rfqTargetingAuthorization` found a slice boundary that had begun swallowing the new procedure, and its rule "a vendor with no declared categories is listed nothing" — once a JavaScript early return — is restated against the WHERE clause the server actually sends, which is a stronger statement than the old one; `providerResponseHandoff` pinned a notice whose premise ELIG had superseded, and it now asks the server instead of naming both possible reasons. Evidence: `server/enquiryQueue.test.ts` (28, several rendered through the real MySQL dialect so the assertions are about the SQL the database receives, not the source that builds it), 17 mutations killed — ONE SURVIVED first and was an instrument failure: two assertions anchored on a line the mutation itself rewrote, so `indexOf` returned -1 and `slice(start, -1)` handed them almost the whole file while `slice(-1)` handed the other a single character, which passes every `not.toContain`. Every boundary in that file is now proven before it is used, and a moved marker fails loudly. `evidence/zg-enquiryqueue-run1.txt` / `-run2.txt` (26/26 twice) and `evidence/zg-enquiryqueueui-run1.txt` / `-run2.txt` (20/20 twice, the rendered page). Both probes found their own bugs before finding the product's: `last_insert_id()` read on a second `mysql` invocation is a different CONNECTION and returns 0, a paid lead looked for only on page one of a newest-first queue it sits at the bottom of, and a `waitFor` expression that threw on an unmounted node and surfaced as a bare "Uncaught". Rate limiting caps `rfq.create` at three a minute — a control working correctly, so three requests go through the real API and the remaining fixtures are seeded, which the probe states.
- [ ] Compliance self-service and Admin queue completeness, provider never self-verifies
- [x] Messaging reconciliation: conversation list, thread, send/reply, unread, timestamps, attachments, Project/RFQ context, pagination, participant authorization — send/reply, attachment ownership, quotation-party checks and the storage proxy's re-derivation of those rules ALREADY worked and are untouched. THREE REAL DEFECTS. (1) NOTHING EVER MARKED A MESSAGE READ: `messages.read` was written false on insert and had no writer for true anywhere in the codebase, nor any control offering to be one — so a conversation's unread badge could only ever grow, and opening a thread, reading it and replying left the count exactly where it was. (The "Mark all read" button on the Messages page belongs to its Notifications tab and correctly marks notifications; I mis-read it as mis-wired at first and corrected that before it reached a comment.) `markThreadRead` takes NO message ids — only a correspondent — and constrains on `receiverId = caller`, so a read receipt can only be given by the person who received the message and never forged on the other party's behalf. Opening a thread is what reads it. (2) `conversations` SELECTED EVERY MESSAGE the account had ever exchanged and reduced it in JavaScript — somebody's whole correspondence pulled across the wire to draw a sidebar. Now three bounded queries with the count done by the database, capped and ordered by the most recent message. It also returned a date string built with `toLocaleDateString()` ON THE SERVER, pinning every reader to the server's locale; it now returns a Date and the page formats it in the reader's. (3) `list` HAD NO PAGINATION and a mode that returned the entire inbox across every thread — nothing called it, so requiring the thread removed a payload risk rather than a capability. Paging is by message id, never offset: an offset skips or repeats a line every time the other person replies mid-scroll. Evidence: `server/messaging.test.ts` (24) plus `server/messagingIntegrity.test.ts` restated to the same rule at its new address and strengthened with the boundedness property; 8 mutations killed. `evidence/zg-messaging-run1.txt` / `-run2.txt` (24/24 twice, identical verdicts: the badge goes down and only for the thread opened, a forged receipt leaves the other party's badge untouched, walking every page visits every message exactly once with none repeated, and a third account sees nothing of the thread).
- [ ] Messaging prior-relationship policy — retain OWNER DECISION unless later resolved
- [x] Notification centre completeness and role-specific scoping; notification preferences remain noncritical-only — the centre itself, the bilingual key-resolved copy, the deep links and the preference gate (NOTIF) already worked. SCOPING WAS NEVER THE PROBLEM: a notification carries a `userId` and every read and write in the router takes its subject from the session, which `negativeControls` already pins. TWO REAL DEFECTS, both found by walking the product. (1) THE BADGE WAS ALL-OR-NOTHING. `markAllRead` was the ONLY writer of `read: true` anywhere in the codebase, so somebody with forty unread who opened ONE had to clear every one of them or keep a number that no longer described what they had seen — the same defect messaging carried before MSG, a count that could only ever be wrong in one direction. `notifications.markRead` takes an id and NO userId: the subject is still the session and the id is constrained in the SAME WHERE rather than checked beforehand, so an id belonging to somebody else matches no row instead of reaching a different branch, and `changed` keeps "I marked it" distinguishable from "that one was not mine" (read through the canonical `_core/writeResult.ts` added in PMEM). Opening a notification is what reads it, linked or not — an informational one is just as read once it has been clicked — and the unread count is invalidated so the navbar badge follows. (2) ONE NOTIFICATION POINTED AT A PAGE THAT DOES NOT EXIST. An admin handed a batch of enquiries was linked to `/admin/enquiries/assignee/<id>`, which matches NO route — `/admin/:section/:record` is three segments and that is four — so the notification landed on "404 Page Not Found". CONFIRMED BY LOADING IT IN A BROWSER, not inferred from the route table. The destination is a FILTERED LIST, so it is now `?assignee=` — a query, not a path segment, since the path segment on that screen already means "one enquiry, by reference" — and the server has accepted `assigneeId` as a filter since VE-6 with nothing ever sending it. The narrowing is VISIBLE: a chip naming the assignee and a way to clear it, because a list silently narrowed by a query parameter reads as a quiet queue and the admin takes their own share of the board for the whole of it. THAT SECOND DEFECT IS A CLASS, NOT AN INSTANCE — a link is written in one file and resolved in another and nothing connected them — so `notificationCentre.test.ts` walks EVERY destination the server writes and requires a declared route that can serve it, and proves the census can still tell the original dead path from the live one. Evidence: `server/notificationCentre.test.ts` (13), 6 mutations killed, plus `negativeControls` and `notificationDestinations` restated at the rule's new address rather than bumped — the first pinned the procedure roster (`markRead` added with its reason), the second pinned one spelling of the un-linked card and broke on an onClick that does not touch the property. `evidence/zg-notificationcentre-run1.txt` / `-run2.txt` (17/17 twice, identical verdicts). THE PROBE'S FIRST VERSION SURVIVED THE MUTATION IT EXISTS TO CATCH: it navigated to a hard-coded `?assignee=` URL, so it proved the page existed and said nothing about where the notification actually points, and it passed unchanged when the dead four-segment link was put back. It now makes a REAL assignment through the admin API and loads the `link` the server stored — and kills that mutation 14/17. Its own SQL was mangled first too: `read` is a reserved word needing backticks, and a backtick inside a double-quoted shell command is command substitution, so the statement reached MySQL broken; the probe passes SQL on stdin now, which removes the shell from the path.
- [ ] Promotion management accuracy/regression for Featured and Sponsored prime placement and lifecycle
- [ ] Marketplace discovery reconciliation across Home, Products, Vendors, Designers, Finishing, and provider directories
- [ ] Admin global search opens entity management for Users, Vendors, Products, Projects, RFQs, Quotations, Disputes
- [ ] Upload master pass for all applicable upload families with validation, storage, parent relationship, retrieval, replace/delete, authorization, IDOR protection
- [ ] Onboarding reconciliation for providers and homeowners without unnecessary blocking
- [ ] Role-specific Quick Actions accuracy
- [ ] AI accuracy/security and knowledge-source completeness; distinguish engine capability from source completeness
- [ ] Public marketplace SEO where framework supports it without exposing private data
- [ ] Performance review: unbounded queries, N+1, pagination, indexes, payloads, debounce, Featured query efficiency
- [ ] Reliability review: double-submit, idempotency, race-sensitive flows, state transitions, retry/timeouts
- [ ] Historical owner decisions: project.spent vs expense log, renovation/finishing preset, mandatory product fields, provider comparison surface, RFQ budget exposure, messaging relationship policy, supplier answer edit/moderation policy
- [ ] Accessibility/mobile/RTL evidence separated into responsive implementation vs VISUAL QA
