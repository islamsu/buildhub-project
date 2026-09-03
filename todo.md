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
- [ ] REF-3 (stacking half): entitlement rewards still CLOBBER rather than stack.
      `setEnquiryAllowance` revokes the prior override and writes an absolute number,
      so a referral reward silently destroys an unrelated admin grant and, on expiry,
      the vendor falls back to the plan value rather than to the admin's. Needs the
      referral bonus modelled as its own additive override row so both survive
      independently.
- [ ] REF-4: SUBSCRIPTION_EXTENSION as a real period extension, per the owner's
      decision - extend from the existing end date, never from now, refuse honestly
      when there is no finite period, and fabricate no payment or invoice.
- [ ] REF-5: wire the remaining qualification events (only ACCOUNT_VERIFIED is hooked),
      and route `admin.qualifyReferral` through the same engine.
- [ ] REF-6: reversal that reverses; expiry as derived state; anti-abuse; the admin and
      user surfaces; the Benefits/Limits view.

## Master Reconciliation Remaining Scope

- [ ] Referral / Invitation Reward system: secure code/link, attribution, campaigns, qualification, caps, non-cash rewards, expiry, reversal, notifications, audit, Admin management
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
- [ ] Complete Dispute lifecycle: relationship eligibility, reference, respondent, evidence, participant communication, internal notes, assignment, priority, statuses, resolution, controlled reopen, notifications, audit
- [ ] Support Tickets: user create/category/description/attachment/updates, Support Admin search/filter/assign/respond/request-info/resolve/close
- [ ] Reviews / Reputation: relationship eligibility, self-review prevention, duplicate prevention, provider response policy, reporting, moderation, restore/hide, audit
- [ ] Full Vendor Management command centre with real applicable modules and cross-links from Admin surfaces
- [ ] Benefits, Limits & Privileges: central entitlement view showing base, campaign/referral, individual overrides, effective, used, remaining, reset/expiry
- [ ] Admin Notes: internal-only, permission-controlled, authored/timestamped, never public
- [ ] Admin Audit UX: search/filter/sort/pagination and humanized actor/target identities
- [ ] Product image management: upload, primary, additional, replace, remove, reorder, persistence, ownership
- [ ] Product lifecycle states: Draft, Active/Published, Inactive, Archived, preferring archive/deactivate where history matters
- [ ] Service management for service providers distinct from physical product catalogue
- [ ] RFQ basket workflow: select/add/remove/quantity/notes/specifications/persistence/submit without duplicate RFQs
- [ ] Complete RFQ Detail navigation and authorized requester/project/items/attachments/status/response action
- [ ] Supplier answer editing/moderation policy — retain as OWNER DECISION unless already resolved
- [ ] Team / Organization management: concrete company role model and authorization plan if architecture requires redesign
- [ ] Notification preferences for noncritical channels; mandatory security/legal notifications remain mandatory
- [ ] Admin analytics using real data only; no fabricated revenue/orders/GMV/commissions while payments are deferred
- [ ] AI knowledge completeness separated from AI engine capability; no fabricated primary-source authority
- [ ] Performance/reliability review: unbounded queries, N+1, pagination, indexes, image payloads, debounce, double-submit/idempotency
- [ ] Accessibility and mobile/RTL pass at 375/768/1440 for all modified areas
- [ ] Public SEO/discovery for crawlable marketplace content while keeping private RFQs/projects/messages/admin non-indexed
- [ ] `projects.spent` vs live expense-log sum — retain as OWNER DECISION unless resolved
- [ ] Admin impersonation: classify SECURITY ARCHITECTURE REQUIRED unless a safe time-limited, audited, banner-protected mechanism exists
- [ ] Payment gateway remains OWNER-DEFERRED; no live payments, orders, transactions, revenue, GMV, commissions, or cash rewards
- [ ] Quotation revision model: ONE current quotation per supplier per RFQ + immutable controlled revision history + version/actor/time/change audit + privacy
- [ ] Complete quotation workflow: detail, statuses, comparison, validity, timeline, warranty, payment/commercial terms, attachments, accept/reject, revision, expiry, notifications
- [ ] Project Members: view/invite/add/capability/role-change/remove with removal access revocation and unrelated-denial
- [ ] Project Documents: upload/list/open/download/replace/archive/remove with authorization and no cross-project leakage
- [ ] Homeowner self-service second pass: profile, projects, members, documents, RFQ basket, RFQs, attachments, invitations, quotations, comparison, accept/reject, messages, notifications, settings
- [ ] Project Manager self-service second pass: authorized creation/management, members, documents, RFQs, invitations, commercial authority by capability, messages, notifications, settings
- [ ] Contractor/Engineer/Architect/Designer/other-provider self-service parity with shared provider architecture
- [ ] Enquiries work queue: dedicated page, search/filter/status/date/category/source/RFQ reference/response state, open/respond, pagination
- [ ] Compliance self-service and Admin queue completeness, provider never self-verifies
- [ ] Messaging reconciliation: conversation list, thread, send/reply, unread, timestamps, attachments, Project/RFQ context, pagination, participant authorization
- [ ] Messaging prior-relationship policy — retain OWNER DECISION unless later resolved
- [ ] Notification centre completeness and role-specific scoping; notification preferences remain noncritical-only
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
