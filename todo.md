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
- [ ] Save the Admin Dashboard crash-fix checkpoint
