# BuildHub — Claude Operating Directive

This file is the canonical standing instruction for Claude Code on the BuildHub repository.

It exists so the owner does **not** need to copy/paste long prompts between ChatGPT and Claude.

Read this file at the start of every session and after every fresh fetch. Also read:

- `OWNER_DECISIONS.md` — canonical owner-policy ledger
- `REACHABILITY_CENSUS.md` — current reachability/dead-capability findings
- `todo.md` — engineering ledger, after reconciling duplicates and non-engineering items
- the latest Git history on the active release-candidate branch

Do not treat historical root-level reports as current truth when they conflict with the files above or the current code.

---

## 1. Mission

Continue autonomously until BuildHub is a coherent, global-standard, production-ready **website**, not merely a repository with many implemented capabilities.

The target is a mature construction B2B marketplace combining:

- marketplace discovery
- buyer sourcing
- supplier/provider storefronts
- RFQs
- quotations
- projects
- documents
- messaging
- notifications
- compliance
- referrals
- reviews
- disputes
- support
- Admin operations
- supplier growth / promotion
- analytics
- Arabic/RTL
- accessibility
- responsive/mobile quality
- truthful failure and empty states
- strong security and data isolation

Adopt the strongest relevant capability patterns from mature global B2B platforms such as Alibaba-style sourcing and Alimama-style marketplace marketing, but implement them as BuildHub-native construction workflows.

Do **not** build a generic Alibaba clone.

---

## 2. Definition of done

Never collapse these states:

- IMPLEMENTED — code exists locally
- COMMITTED — in local Git history
- PUSHED — remote branch contains it
- IN RELEASE CANDIDATE — part of the integrated RC
- MERGED — main contains it
- DEPLOYED — exact SHA deployed
- STAGING VERIFIED — exact deployed SHA passed acceptance
- OWNER DELIVERED — owner can open the deployed site and verify the intended experience

A feature is not owner-delivered because tests pass or code exists.

The formal owner complaint remains open until the deployed staging build visibly contains the approved product behavior.

---

## 3. Current release path

Primary product integration branch:

`claude/buildhub-global-release-candidate`

Main must never be merged without explicit owner authorization.

Production must never be deployed without explicit owner authorization.

PR #43 is considered superseded only after exact containment is proven and the final release candidate has one clean integration path.

The ops migration reconciler remains separate tooling.

Avoid new random product branches unless genuine isolation is required.

---

## 4. Freshness rule

Before meaningful work:

1. `git fetch`
2. verify current branch and remote SHA
3. verify working tree
4. read this file
5. read `OWNER_DECISIONS.md`
6. read the current release ledger
7. verify the build identity before trusting any HTTP/browser probe

Never trust a stale process or stale build.

---

## 5. Build identity is release-critical

`/version` and the Admin/Operations build view must expose safe build identity such as:

- commit
- shortCommit
- buildTime
- environment

Every HTTP/browser probe that exercises a running application must verify the expected build before making functional assertions.

Database-only/domain-only tests do not need an HTTP build assertion.

Never make a running build pretend it is current Git HEAD if it was built from an older commit.

---

## 6. Product journey rule

The strongest lesson from this release:

**A capability is not a product journey.**

For every important feature ask:

1. Can the user find it?
2. Can the user complete it?
3. Does the next part of the product know it happened?
4. Can the other party see the correct consequence?

Buyer action must become supplier reality.
Supplier action must become buyer reality.
Admin action must become user/public reality.

Critical journeys require rendered/browser proof, not endpoint-only proof.

---

## 7. Autonomous execution

Do not stop after ordinary milestones.

Normal loop:

inspect
→ identify real gap
→ root-cause
→ implement using canonical architecture
→ targeted test
→ negative/security test
→ browser/DB proof where appropriate
→ typecheck
→ affected integration tests
→ diff review
→ commit
→ push
→ fresh fetch
→ verify local == remote
→ update the canonical ledger
→ select the next highest-priority release gap
→ continue

Stop only for:

- owner merge authorization
- production deployment authorization
- destructive/manual staging DB repair
- irreversible risky migration
- required unavailable external credential/infrastructure
- a genuine owner-policy decision that blocks the exact next task
- payment-policy decision
- context/session limit requiring handoff

Do not stop to ask “should I continue?”

---

## 8. Priority model

P0:
- security breach
- cross-tenant leak
- destructive data risk
- broken authorization

P1:
- core user journey cannot complete
- money-equivalent entitlement fails open
- critical Admin control missing
- dead critical route/action
- owner-visible release requirement materially missing

P2:
- major feature incompleteness
- serious UX contradiction
- operational workflow gap

P3:
- polish
- accessibility refinements
- performance tuning
- SEO refinements

If P0/P1 appears during P2/P3, fix it first, then resume.

---

## 9. Security invariants

Frontend hiding is never authorization.

Every protected read/write must enforce applicable:

- authentication
- role
- ownership
- relationship
- capability
- entitlement
- same-role isolation
- IDOR protection
- attachment authorization
- search/export authorization

Preserve:

- Supplier A cannot see Supplier B quotation
- competitor supplier cannot see rival private dispute/quote context
- project membership removal revokes protected access
- provider approval/verification remains server-authoritative
- Admin authority cannot exceed permission set
- at least one usable Super Admin remains
- uploads cannot traverse or borrow another user’s owned storage object
- review/referral/message integrity remains enforced

Not-found and not-yours should not become enumeration oracles.

---

## 10. Truthfulness invariants

ERROR != EMPTY

OUTAGE != ZERO

UNKNOWN AUTH != SIGNED OUT

UNKNOWN ENTITLEMENT != FREE ALLOWANCE

Never fabricate:

- users
- vendors
- reviews
- ratings
- Featured/Sponsored content
- orders
- payments
- revenue
- GMV
- growth
- commercial health
- analytics

A database outage must not render as zero business activity.

---

## 11. Canonical architecture rule

Do not create duplicate systems when one canonical domain exists.

Reuse canonical:

- category taxonomy
- entitlement resolver
- project access/capability model
- RFQ authority model
- quotation current/revision model
- upload ownership guards
- moderation lifecycle
- messaging architecture
- referral qualification architecture
- placement/Featured/Sponsored architecture
- Admin permission model

New UI should compose canonical systems rather than fork them.

---

## 12. Admin owner requirements

Preserve the approved information architecture:

- Admin Control Panel
- User Management
- Professional Registrations
- Marketplace
- Trust & Support
- Commercial / Benefits
- Insights / Operations
- Administrator Management
- Settings

Specific owner rules:

- Name Changes is **not** a top-level Admin destination
- Name Change Requests belongs inside User Management
- legacy `/admin/name-changes` may alias directly to that tab
- Professional Registrations sits immediately after User Management
- dashboard = summary + compact previews + quick actions + View All
- dedicated page = full search/filter/sort/pagination/management
- human names/businesses/references are primary; raw IDs are secondary
- every visible Admin destination must change URL, content, heading and active state correctly
- operational queues should have truthful actionable badges where useful
- database failure must not render badge 0
- global Admin search must remain permission-scoped and open canonical detail pages

Maintain the permanent Admin click-through acceptance test.

---

## 13. Operational attention model

Review meaningful queues such as:

- Professional Registrations
- Vendor Enquiries
- Name Change Requests
- Disputes
- Support Tickets
- Reviews / moderation
- Product Q&A moderation
- Compliance

Badge only meaningful work such as unassigned/unreviewed/pending-admin/actionable state.

Do not turn the sidebar into notification noise.

A count computed but never rendered is not a feature.

---

## 14. Product Q&A

Owner direction is decided:

- public Q&A must have report/moderation
- question and answer moderated independently
- Admin can hide/restore and resolve reports
- evidence/history preserved
- no destructive deletion by default
- supplier may correct own answer
- old answer preserved as revision history
- public UI shows Edited marker
- hidden answer cannot be rewritten around moderation
- Admin attention count exists
- notifications localized EN/AR

Treat this as regression-protected unless a real defect appears.

---

## 15. Project spend

Current canonical source of truth:

**expense log**

Use it consistently across project detail, dashboard and analytics.

Dormant `projects.spent` must not silently become truth again.

A future manually stated carry-forward total would require an explicit separate field and visible provenance.

---

## 16. Messaging

Current launch policy:

Open marketplace buyer/provider contact is allowed.

Keep volume + breadth controls.

Do not require a prior RFQ merely to contact a discovered supplier unless the owner later changes policy.

Canonical messaging remains one system.

Unread badge and destination must agree.

Workspace roles must have visible notification/message indicators.

---

## 17. Referral

Preserve:

- immutable attribution
- late campaign binding at qualification
- one referral → one campaign → one reward
- no stacking by default
- transactional/idempotent qualification
- real effect, not ledger-only success
- reversible benefits where legitimate

Reward types:

- EXTRA_QUALIFIED_ENQUIRIES
- TEMPORARY_FEATURED
- SUBSCRIPTION_EXTENSION

Referral privacy:

- approved public business may be named
- private/unapproved/hidden account remains “Private account”
- do not expose private identity merely because a referral code was used

No raw reward enums in user UI.

---

## 18. Featured / Sponsored / Showcase

These are three separate concepts:

FEATURED
= BuildHub editorial curation

SPONSORED
= commercial promotion

SUPPLIER SHOWCASE
= supplier-selected emphasis within the supplier’s own storefront

Never merge them.

Where combined, discovery priority is:

FEATURED
→ clearly labelled SPONSORED
→ ORGANIC

Featured Provider/Product should receive prime placement:

1. Marketplace Home
2. relevant Category experience

Wrong-category Featured content must be absent.

Featured and Sponsored need visibly distinct treatment using more than color alone.

---

## 19. Supplier commercial arc — current immediate release focus

The supplier journey must connect:

signup
→ business setup
→ compliance/approval
→ public storefront
→ catalogue/services/portfolio
→ marketplace discovery
→ RFQ opportunity
→ enquiry
→ entitlement
→ quotation
→ revision
→ withdrawal
→ buyer decision
→ notification
→ messaging
→ project relationship
→ trust/support/dispute/review
→ supplier dashboard/pipeline

Exercise fresh accounts and real DB state.

Object storage unavailable = honest infrastructure SKIP, not fake pass.

An invited RFQ remains allowance-exempt where current canonical rules say so.

A self-discovered/opened eligible lead consumes the appropriate allowance exactly once.

---

## 20. Global B2B marketplace direction

BuildHub must progressively match mature B2B sourcing expectations while remaining construction-specific.

Current-release priorities, where architecture and time permit:

- professional provider storefront
- buyer saved products/providers / sourcing shortlist
- Contact Supplier
- Ask Product Question
- Request Quote
- Invite to RFQ
- Add Product to RFQ
- RFQ Opportunity Centre
- Provider Lead Centre
- Supplier Showcase
- Marketing Center foundation
- Sponsored Products
- Sponsored Providers
- category/search placement foundation
- real promotion analytics
- profile/listing completeness
- stronger Arabic/English search/discovery
- quotation comparison
- provider comparison only where objective and useful

Do not delay the current release indefinitely for speculative marketplace features.

Classify large capabilities as:

- CURRENT GLOBAL RELEASE
- NEXT MARKETPLACE MILESTONE
- FUTURE AFTER PAYMENT
- FUTURE AFTER TEAM/ORG
- NOT APPLICABLE

---

## 21. Provider storefront standard

A public provider page should feel like a professional B2B storefront.

Applicable sections:

- business/professional identity
- overview
- verified credentials
- categories/specialties
- service areas
- products
- services
- portfolio
- public experience/projects where legitimate
- business hours
- certifications
- reviews
- truthful response metrics where statistically valid
- Contact Supplier
- Request Quote
- Invite to RFQ
- Save Provider

Never leak internal compliance documents, Admin notes, private identity data or raw technical fields.

---

## 22. Buyer sourcing model

Two strong buyer paths must connect:

SEARCH / BROWSE

and

POST REQUIREMENT / RFQ

From discovery, appropriate actions may include:

- save
- compare
- contact
- Add to RFQ
- invite provider

From RFQ, relevant providers may be recommended using explainable deterministic signals.

No fake match percentage.

---

## 23. Opportunity Centre / Lead Centre

Supplier opportunity states may include canonical equivalents of:

- Recommended
- Invited
- Available
- Opened
- Responded
- Declined
- Closed

Lead Centre may summarize real:

- New Opportunities
- Invitations
- Qualified Enquiries
- Opened
- Quotation Sent
- Follow-up
- Accepted/Won
- Closed

Do not invent CRM states unsupported by domain truth.

Dashboard = summary.
Dedicated Lead Centre = management.

---

## 24. Marketing Center foundation

Alimama-style marketplace marketing is a strategic direction, adapted to BuildHub.

Foundation may manage:

- Sponsored Products
- Sponsored Provider
- category placement
- marketplace placement
- keyword/search placement foundation
- campaign dates
- status
- scope
- targeting
- entity/creative
- real performance

Payment is still deferred.

Do not invent budget, CPC, revenue or billing.

Entitlement/grant sources must be truthful.

---

## 25. Search and discovery

Improve toward professional B2B search using real data:

- Arabic/English normalization
- canonical categories
- aliases
- brands
- providers
- products
- services
- location
- verification
- attributes
- Featured
- Sponsored

Discovery may use fuzzy matching where safe.

Business writes/category assignment remain deterministic.

Never fuzzy-assign stored categories.

No fabricated “Trending” queries.

---

## 26. Category experience

Category pages should feel like sourcing destinations, not merely unchanged grids with a query parameter.

Where data exists:

- category identity
- Featured Providers
- Featured Products
- Sponsored content
- organic providers
- organic products/services
- search/filter
- Get Quotes

Use one canonical taxonomy.

---

## 27. Comparison

Product comparison may use real:

- price/unit
- specifications
- warranty
- supplier
- lead time
- verification

Provider comparison only where objective enough:

- verification
- specialties
- coverage
- portfolio
- reviews
- statistically meaningful response metrics

Do not rank a “winner.”

Quotation comparison remains the primary commercial decision surface.

---

## 28. Marketing / seller analytics

Only real instrumented metrics.

Possible:

- provider profile views
- product views
- search impressions
- Featured impressions
- Sponsored impressions
- clicks
- inquiries
- Add-to-RFQ
- RFQ invitations
- opened enquiries
- quotations
- accepted quotation where attribution is defensible

No invented graphs.

Zero only when actually measured zero.

Error if measurement failed.

Attribution must be deterministic and avoid double counting.

---

## 29. Profile/listing completeness

Use objective completeness guidance such as:

- missing logo
- missing Arabic description
- missing service region
- missing portfolio
- missing product image
- incomplete verification

Call it:

Profile Completeness
or
Listing Completeness

Never “Supplier Quality Score.”

---

## 30. No fake trade assurance

Do not claim:

- escrow
- payment protection
- refund guarantee
- BuildHub Guaranteed

until real financial/policy infrastructure exists.

Today BuildHub can legitimately provide trust through:

- verified records
- RFQ history
- quotation history
- messages
- documents
- reviews
- moderation
- dispute mediation

---

## 31. Professional role arcs

After supplier arc, complete fresh-account journeys for:

- Contractor
- Engineer
- Architect/Designer
- Project Manager

Do not assume shared components prove parity.

Test both allowed and forbidden actions.

Project Manager is not merely another provider; commercial/project authority must follow capability.

Do not invent Team/Organization behavior.

---

## 32. Admin operational arcs

Required connected Admin journeys include:

- Professional Registration
- Vendor Enquiry
- Product Q&A moderation
- Support
- Dispute
- Review moderation
- Name Change
- Placement / Featured / Sponsored

Each must prove:

EVENT
→ ATTENTION
→ QUEUE
→ DETAIL
→ ACTION
→ AUDIT/HISTORY
→ USER/PUBLIC CONSEQUENCE

---

## 33. Role dashboards

A dashboard should summarize the role’s real work.

It must not be a full management page.

Supplier dashboard should reflect actual:

- profile/catalogue state
- opportunities/enquiries
- quotations
- notifications
- compliance
- benefits
- real analytics if available

Homeowner dashboard should reflect actual projects/RFQs/quotations/spend.

No fake Team feature or irrelevant universal cards.

---

## 34. Upload master pass

Do not redo already-proven work blindly.

Reconcile the tracker contradiction.

Applicable upload families should have:

- writer
- validation
- ownership
- protected serve/read
- parent relationship
- replace/delete where relevant
- IDOR protection
- traversal protection

Infrastructure-dependent real S3 round-trip remains BLOCKED until object storage exists.

---

## 35. Performance/reliability

Consolidate duplicate tracker entries into one real gate.

Performance review:

- N+1
- unbounded reads
- pagination
- indexes
- payload size
- repeated requests
- debounce
- dashboard overfetch
- marketplace/Featured query efficiency

Reliability review:

- double-submit
- idempotency
- concurrent reward grants
- quotation races
- RFQ duplicate creation
- notification duplication
- retry/timeouts
- stale updates
- state transitions

Fix material findings.

---

## 36. Mobile / RTL / accessibility

Critical flows at:

- 375px
- 768px
- 1440px

English LTR and Arabic RTL.

Check actual rendered behavior:

- navigation
- tables
- forms
- dialogs
- filters
- pagination
- marketplace
- RFQ
- quotation
- messages
- role dashboards
- Admin

Accessibility:

- keyboard
- focus
- semantic buttons/links
- labels
- form errors
- dialogs
- menus/tabs
- accessible icon controls
- status not color-only

Do not close based only on static assertions.

---

## 37. SEO

Consolidate duplicate SEO tasks.

Public/crawlable where appropriate:

- Marketplace
- Categories
- Provider profiles
- Products

Private/no-index:

- Admin
- messages
- private RFQs
- projects
- account pages

Implement useful titles, metadata and canonical semantics.

---

## 38. AI

Final AI gate:

- AR question → AR answer
- EN question → EN answer
- authorized context only
- no private-data leakage
- no fabricated BuildHub facts
- clear distinction between engine capability and available knowledge/source completeness

Do not pretend optional AI knowledge is authoritative primary-source data.

---

## 39. Owner decisions / deferred architecture

Current standing decisions:

- Project spend: expense log canonical
- Messaging: open marketplace contact, bounded
- Referral privacy: public business may be named; private account remains private
- Product Q&A moderation/editing: decided and built
- Admin impersonation: do not launch; future security architecture
- Team/Organization: post-release architecture
- Payment gateway: owner-deferred / external
- Main GitHub ruleset: owner governance authorization required
- Supplier answer moderation policy: now resolved by Q&A decision

Do not repeatedly stop on already-settled items.

---

## 40. Large refactors after release

Do not split the ~10k-line `server/routers.ts` during this release candidate.

Record as the first major post-release maintainability milestone:

split by domain seam while preserving API contracts/tests.

Do not spend the release moving dozens of historical markdown reports.

After release, archive superseded reports under `docs/history/`.

---

## 41. Tracker truth

The tracker must not mix:

- current engineering
- duplicates
- owner decisions
- infra blocks
- future architecture
- next commercial milestone

Classify every remaining item into:

- CURRENT RELEASE ENGINEERING
- ALREADY COMPLETE — evidence
- DUPLICATE — points to canonical item
- OWNER DECISION
- INFRASTRUCTURE BLOCKED
- OWNER DEFERRED
- POST-RELEASE ARCHITECTURE
- NEXT MARKETPLACE MILESTONE
- NOT APPLICABLE — reason

Never delete work merely to improve completion numbers.

---

## 42. Release gate

Do not request owner merge authorization until:

- P0 known defects = 0
- P1 known defects = 0
- reachability/dead-capability census complete
- supplier arc complete
- professional role arcs complete
- Admin operational arcs complete
- tracker reconciled
- current-release marketplace capabilities complete
- security negatives green
- migration-from-empty green
- populated upgrade green
- performance reviewed
- reliability reviewed
- mobile visual QA complete
- Arabic/RTL complete
- accessibility complete
- SEO complete
- AI release gate complete
- ACC-4 fresh-account cross-role acceptance complete
- full tests green
- typecheck green
- production build green
- working tree clean
- local SHA == remote SHA

Then open one release-candidate PR to main.

Prove PR #43 containment and supersede/close it appropriately.

---

## 43. Merge request format

Only when ready, report:

BUILDHUB GLOBAL RELEASE CANDIDATE READY FOR OWNER MERGE AUTHORIZATION

- PR
- HEAD SHA
- BASE SHA
- commit count
- changed files
- migrations
- test count
- P0 = 0
- P1 = 0
- role arcs
- marketplace
- Admin
- security
- performance
- reliability
- mobile
- RTL
- accessibility
- SEO
- AI
- ACC-4
- infra SKIPs
- production modified = NO

Do not merge main without explicit owner authorization.

---

## 44. Staging delivery

Local success is not staging evidence.

After owner authorizes merge:

1. verify exact merged SHA
2. recover/inspect Render deployment chain
3. verify migrations
4. deploy exact authorized main SHA
5. verify `/version`
6. run pinned staging QA
7. produce owner acceptance checklist

Only then can status become STAGING VERIFIED.

Only after the owner opens the correct build and sees the expected product can status become OWNER DELIVERED.

---

## 45. Production

No production deploy without explicit owner authorization.

No production DB mutation.

No payment activation.

Staging acceptance is not production authorization.

---

## 46. Current immediate sequence

Unless a higher-priority real defect appears, continue:

1. supplier commercial arc — finish withdrawal/customer-decision/messaging/dashboard/trust joins
2. Contractor / Engineer / Architect / Project Manager arcs
3. Admin operational arcs
4. tracker reconciliation
5. fix P0/P1 join defects
6. current-release global B2B marketplace enhancements
7. performance / reliability
8. mobile / RTL / accessibility / visual QA
9. SEO / AI release gates
10. ACC-4
11. final release-candidate PR readiness

Do not stop between these ordinary steps.

---

## 47. Final principle

Do not optimize for:

“many implemented features”

or

“large test count.”

Optimize for:

**one trustworthy, connected, premium construction marketplace that a real buyer,
supplier, professional and administrator can use from beginning to end.**

Every important capability must satisfy:

CAN THE USER FIND IT?

CAN THE USER COMPLETE IT?

DOES THE NEXT SYSTEM KNOW IT HAPPENED?

CAN THE OTHER PARTY SEE THE CORRECT CONSEQUENCE?

If any answer is no, it is not finished.
