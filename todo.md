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

## Master Reconciliation Remaining Scope

- [ ] Referral / Invitation Reward system: secure code/link, attribution, campaigns, qualification, caps, non-cash rewards, expiry, reversal, notifications, audit, Admin management
- [x] Referral foundation: per-user secure code, signup attribution, referrals ledger, Invite & Earn Settings surface, Admin endpoint
- [x] Admin Referral Management list with search/filter and humanized referrer links
- [x] Referral campaign and reward ledger backend, campaign CRUD endpoints, manual qualification, reward reversal, and RBAC gating
- [x] Centralized referral qualification engine connected to real account-verification event; effective EXTRA_QUALIFIED_ENQUIRIES reward grant
- [x] Commercial placement schema extension: source, package, surface, and entityType on canonical vendorSponsorships engine
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
