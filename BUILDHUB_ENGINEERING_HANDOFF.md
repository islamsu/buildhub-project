# BUILDHUB ENGINEERING HANDOFF

PROJECT: BuildHub

REPOSITORY: islamsu/buildhub-project

ACTIVE DEVELOPMENT BRANCH: codex/buildhub-final-closure

LATEST VERIFIED DEVELOPMENT SHA: c66e2320388a984340240a84322c91acb3e88863

WORKING TREE: CLEAN

MAIN MERGED: NO

PRODUCTION DEPLOYED: NO

STAGING DEPLOYED SHA: NOT VERIFIED

PAYMENT GATEWAY: DEFERRED BY OWNER

AUTHORITATIVE TRACKER: todo.md

## CLAUDE — READ THIS BEFORE MAKING ANY CHANGE

Your previous Claude checkpoint is historical only.

DeepSeek continued BuildHub after your previous session.

The CURRENT GitHub state on `codex/buildhub-final-closure` is authoritative.

Do NOT reset to your former Claude branch.

Do NOT reset to `f5eed47a45808971e6dacc7ff8b35d6e29fc93d0`.

Do NOT rebuild completed DeepSeek functionality.

Read `todo.md`, this handoff, recent commits, migrations and tests first.

Preserve all newer legitimate work.

Continue the exact next unfinished milestone.

## MODEL / AGENT SWITCH RULE

Whenever changing between DeepSeek, Claude, Codex, or another engineering agent:

1. Inspect Git state.
2. Checkout `codex/buildhub-final-closure`.
3. Pull/fetch the latest authorized remote state.
4. Read `todo.md`.
5. Read `BUILDHUB_ENGINEERING_HANDOFF.md`.
6. Inspect recent commits.
7. Inspect recent migrations.
8. Preserve any newer legitimate work.
9. Continue the highest-priority IN PROGRESS/PARTIAL item.

Never restart BuildHub because the AI model changed.

## GITHUB CHECKPOINT POLICY

IMPLEMENT -> TARGETED TEST -> TYPECHECK -> REVIEW DIFF -> COMMIT -> PUSH -> FRESH REMOTE VERIFY -> CONTINUE.

## STAGING / DEPLOYMENT STATE

- Development branch: `codex/buildhub-final-closure`
- Latest committed and pushed development SHA: `ceb216920c055b5881c3c1344b7e4245387034e6`
- Staging service / URL: NOT VERIFIED
- Staging branch: NOT VERIFIED
- Staging deployed SHA: NOT VERIFIED
- Production branch: NOT MODIFIED
- Production deployed SHA: NOT VERIFIED

Do not blur these states. A pushed commit exists in GitHub but is not necessarily visible to the owner on staging or production.

## RECENT COMMIT SUMMARY

```text
c66e232 Admin internal notes and complete backlog register
fb0af30 Admin: allowlisted user detail editing
0284957 Vendor name change request and admin correction
ceb2169 Admin: entity links and humanized investigation statuses
d6ef973 Admin: promotion list search filter sort pagination
ca1b2df Admin: human-first RFQ investigation search
4b477c7 Admin: close identity, project detail and count partials
8459539 Admin: clarify total user count excludes test accounts
c54c014 Admin: replace misleading healthy live badges
ec9186a Admin: identity search replaces raw vendor id workflows
09b64e0 Admin: humanize invitation states and paginate user management
1bf5f1f Admin: project and product drill-down destinations
f0bb5eb Admin: compact user overview, clickable user detail and single nav
a065aca Admin: vendor lookup by business identity, not database id
```

## LATEST RELEVANT MIGRATION

The latest numbered migration file is `drizzle/0036_admin_notes.sql`.

Migration lineage must be preserved with forward migrations only. Do not rewrite historical migrations.

## MAJOR COMPLETED DEEPSEEK WORK

Recent completed or regression-protected work includes:

- Supplier RFQ Response and quotation revision workflow
- Single and bulk product listing with visible catalogue actions
- Dedicated `/catalogue` page and compact supplier catalogue preview
- Featured Products, Featured Providers, and Sponsored placement architecture
- Featured/Sponsored priority, From/Until, indefinite timing, and scheduled/active/expired/revoked lifecycle
- Vendor business profile fields, product specifications, warranty, and Arabic product description
- Provider portfolio and public portfolio display
- Qualified enquiry allowance management with visible vendor identity search
- Admin vendor identity search replacing raw numeric IDs in billing, sponsorship, featured-provider, and RFQ investigation
- Admin dashboard compaction with compact user preview, View All, and dedicated User Management
- Clickable user names and Admin User Detail page
- Clickable project names and Admin Project Detail page
- Admin KPI drill-downs, including `status=active` for Active Projects
- Single primary Admin navigation and removal of duplicated top-level tabs
- Human-readable invitation and RFQ investigation statuses
- Truthful platform health header and clarified real-user count semantics
- Promotion Management search, status filtering, sorting, and pagination for Featured and Sponsored
- Vendor Name Change Request and Admin Direct Vendor Name Correction with audit, notifications, and security tests
- Admin User Detail account editing for permitted name/username/email/phone/role fields
- Internal Admin Notes for User Detail with permission controls and non-public storage
- Initial user-facing dispute workflow

## PARTIAL / INCOMPLETE WORK

Repository-controlled work that remains to finish:

- System-wide entity-link/dead-control/raw-ID/raw-enum audit across remaining admin modules
- Vendor/business name link consistency across every remaining admin table
- Referral / Invitation Reward system
- Complete Dispute lifecycle
- Support Tickets
- Reviews / Moderation
- Full Vendor Management
- Benefits / Limits / Privileges
- Remaining role self-service
- Project Members/Documents deeper management
- Promotion generalized placement architecture if applicable
- Remaining messaging/notifications/settings work
- Final mobile/RTL/browser acceptance
- Staging/infrastructure validation

Use actual repository state, not assumptions, when continuing.

## OWNER-APPROVED PRODUCT RULES — DO NOT REOPEN WITHOUT REAL CONFLICT

A. FEATURED

- Featured content must be in prime marketplace locations.
- Featured must not have its only placement at the bottom.
- Featured must support From, Until, Indefinite, Priority, and automatic expiry.
- Featured and Sponsored remain distinct.

B. DASHBOARDS

- Dashboard = summary + important preview + actions + View All.
- Dedicated page = full management.
- Do not render entire growing datasets on dashboards.

C. CATALOGUE

- Bulk Upload must be clearly visible.
- Own products must show a clear Edit action.
- Catalogue dashboard remains compact.
- Full management belongs on `/catalogue`.

D. ADMIN UX

- Admin should operate with names, business identities, emails, and human-readable references, not raw database IDs.
- Important names/references should open the relevant management record.
- KPI cards should drill down where appropriate.
- No dead links/buttons.

E. VENDOR IDENTITY

- Vendor must have an appropriate Name Change workflow.
- Admin must be able to correct incorrectly written Vendor names.
- Verified legal identity must remain controlled and auditable.

F. DISPUTES

- Dispute functionality must exist even with zero cases.
- No fake cases.
- Build the real lifecycle.

G. REFERRALS

- A real Invitation / Referral Reward system must exist.
- Use global marketplace principles.
- Initial rewards should be non-cash BuildHub benefits while payments are deferred.

H. SELF-SERVICE

- Every role gets maximum practical management of its OWN authorized area.
- More privileges does not mean access to other users' private data.

## SECURITY INVARIANTS

- Frontend hiding is NOT authorization.
- Server-side authorization is mandatory.
- RBAC is required.
- Ownership/relationship checks are required.
- Same-role isolation is required.
- No IDOR.
- No cross-vendor private-data leakage.
- Supplier A cannot see Supplier B's private quotations.
- Mass assignment of privileged fields is prohibited.
- Ordinary users cannot self-grant Verified, Featured, Sponsored, Admin roles, plan override, entitlement override, compliance approval, or suspension reversal.

## ADMIN RBAC

Preserve the current administrator role/capability architecture:

- SUPER_ADMIN
- USER_ADMIN
- MARKETPLACE_ADMIN
- SUPPORT_ADMIN
- BILLING_ADMIN

Do NOT simplify this into "all admins = Super Admin".

## DISPUTE DIRECTION

Approved direction includes:

- real case reference
- relationship-based eligibility
- reporter/respondent
- evidence
- status lifecycle
- participant communication
- internal Admin notes
- assignment
- resolution
- controlled reopen
- notifications
- audit

Existing initial dispute creation must be EXTENDED, not replaced.

## REFERRAL DIRECTION

Approved Referral / Invite & Earn direction includes:

- secure referral code/link
- referrer/referred attribution
- qualification event
- campaigns
- caps
- anti-abuse
- non-cash marketplace rewards initially
- entitlement integration
- time-bound Featured reward possible
- reversal
- notifications
- audit

## QUOTATION OWNER DIRECTION

ONE CURRENT QUOTATION PER SUPPLIER PER RFQ plus CONTROLLED IMMUTABLE REVISION HISTORY.

Previous versions remain historical. Supplier sees own history. Requester sees authorized history. Competitors do not.

Avoid destructive migration without safe review.

## GET QUOTES DIRECTION

Get Quotes / Qualified Enquiries = relevance-filtered opportunities.

Open discovery = separate privacy-safe surface if applicable.

Private RFQ detail = authorization protected.

## PAYMENT GATEWAY

PAYMENT GATEWAY IS OWNER-DEFERRED.

Do not invent Payments, Orders, Revenue, GMV, Commissions, or cash referral rewards unless the owner later authorizes the real business/payment workflow.

## NO FAKE DATA

Never fabricate vendors, Featured entities, Sponsored entities, reviews, ratings, referrals, rewards, disputes, support tickets, orders, revenue, transactions, fraud scores, or analytics.

Function can exist with zero data.

## UX QUALITY RULE

Do not wait for the owner to identify every dead button, dead link, buried CTA, oversized dashboard section, raw enum, raw database ID, missing Edit, missing View All, missing search/filter, poor mobile layout, RTL problem, empty state, error state, or navigation issue. Fix obvious professional marketplace deficiencies proactively when business policy risk is low.

## NEW MACHINE / NEW SESSION RECONSTRUCTION

Safe commands:

```text
git clone https://github.com/islamsu/buildhub-project.git
cd buildhub-project
git checkout codex/buildhub-final-closure
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm dev
```

Migration commands:

```text
pnpm db:migrate
pnpm db:push
```

Environment variable names are documented in `.env.example`. Do not commit filled-in credentials.

## AUTHORITATIVE TRACKER

`todo.md` is the single authoritative development backlog/tracker.

Statuses should use DONE, IN PROGRESS, PARTIAL, OWNER DECISION, INFRASTRUCTURE BLOCKED, or FUTURE ARCHITECTURE.

## NEXT EXACT DEVELOPMENT ITEM

NEXT EXACT ITEM: Implement the Referral / Invitation Reward system.

Before moving deeper into Referrals, ensure the remaining Admin entity-link/raw-ID/actionability gaps are closed or explicitly tracked.

## PROMPT TO GIVE CLAUDE WHEN RESUMING

Continue BuildHub from the current GitHub source of truth.

DeepSeek continued development after your previous Claude session.

Do not reset to your historical branch or `f5eed47a45808971e6dacc7ff8b35d6e29fc93d0`.

Checkout `codex/buildhub-final-closure` and use its latest verified remote HEAD.

Read `todo.md` and `BUILDHUB_ENGINEERING_HANDOFF.md` before making changes.

Inspect recent commits and migrations.

Preserve all newer DeepSeek work.

Continue the exact NEXT DEVELOPMENT ITEM from the handoff.

Completed/regression-protected work must not be rebuilt unless touched or demonstrably regressed.

Do not merge main or deploy production without owner authorization.
