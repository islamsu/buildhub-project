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
- [ ] OTP verification UI (placeholder - uses Manus OAuth)
- [x] Role-based routing after login
- [x] Protected route wrapper per role

## Phase 4: Homeowner Portal
- [x] Homeowner dashboard overview
- [x] Create/edit project form
- [ ] Upload drawings, BOQ, photos (placeholder - file upload requires S3)
- [x] Budget setup and tracking
- [x] Milestone management
- [ ] Invoice storage and management (placeholder)
- [x] Project list view

## Phase 5: Marketplace
- [x] Marketplace home with category grid
- [x] Product listing cards with search/filter
- [ ] Product detail page (specs, variants, reviews, Q&A) - placeholder
- [x] Category pages (Materials, Furniture, HVAC, Smart Home, etc.)
- [x] Search with filters (price, rating, availability, brand)

## Phase 6: RFQ & Smart Matching & Provider Dashboards
- [x] RFQ creation form for homeowners
- [x] RFQ list and detail view
- [x] Provider RFQ notification and quotation submission
- [ ] Side-by-side quotation comparison (placeholder)
- [x] Side-by-side quotation comparison (placeholder)
- [ ] Smart matching algorithm display (ranked providers) (placeholder)
- [x] Contractor dashboard
- [x] Engineer dashboard
- [x] Architect dashboard
- [x] Supplier dashboard

## Phase 7: Project Management Workspace
- [ ] Project timeline view (placeholder)
- [x] Milestone and task management
- [x] Budget and expense tracker
- [ ] Document management (upload/view files) (placeholder - requires S3)
- [x] Daily logs
- [x] Team member management
- [ ] Progress reports (placeholder)

## Phase 8: AI Assistant, Messaging, Notifications & Reviews
- [x] AI assistant chat interface (cost estimation, QS, material recs, PM advice, risk)
- [x] Real-time in-app messaging UI
- [ ] File and quotation sharing in chat (placeholder)
- [x] Notifications hub
- [ ] Verified review and rating system (placeholder - post-project only)
- [ ] Review submission (post-project only) (placeholder)

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
- [ ] Address remaining placeholder flows (OTP, real-time messaging, and other roadmap items)

## Phase 12 Recovery Note
- [x] Reapply RFQ upload work after sandbox restoration from checkpoint e1386070
- [x] Re-run TypeScript and Vitest checks before checkpoint
- [x] Re-verify the upload UI at desktop and mobile widths
- [x] Save checkpoint v1.7 after recovery verification

## Phase 12 Verification Gaps
- [ ] Add Vitest coverage for attachment metadata parsing, including valid, empty, and malformed JSON
- [ ] Visually exercise the RFQ picker, in-progress upload state, and rendered attachment card output
- [ ] Save checkpoint v1.7 after the full attachment-flow verification

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
