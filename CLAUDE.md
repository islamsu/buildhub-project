# BuildHub — Claude Operating Directive

This file is the canonical standing instruction for Claude Code on the BuildHub repository.

It exists so the owner does **not** need to copy/paste long prompts between ChatGPT and Claude.

Read this file at the start of every session and after every fresh fetch. Also read:

- `OWNER_DECISIONS.md` — canonical owner-policy ledger
- `PRODUCT_NORTH_STAR.md` — owner-level marketplace, visual-quality and strategic moat blueprint
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

The current Marketplace Hub is explicitly NOT accepted as the target. Read and execute `PRODUCT_NORTH_STAR.md` as a current owner requirement. Its CURRENT GLOBAL RELEASE items are release work, not optional future ideation.

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

## 44. Staging / owner-preview delivery

Local success is not staging evidence.

**Current owner direction:** the active release candidate should be continuously deployable to a safe staging / owner-preview environment while engineering continues. Do not wait for final merge to let the owner see the product.

Preview cadence:

1. build/test the current release-candidate SHA
2. deploy `claude/buildhub-global-release-candidate` to the isolated staging service whenever technically safe
3. verify `/version` reports the exact expected SHA and `environment: "staging"`
4. run pinned browser/HTTP acceptance against that exact SHA
5. let the owner visually inspect the evolving product
6. continue fixing and redeploying staging as work advances

Staging preview must use isolated staging data/secrets and must never write to production.

A preview deployment may be called **STAGING PREVIEW VERIFIED** only for the exact release-candidate SHA actually served and tested. It is not the final merged-release verification and it is not production authorization.

After the owner later authorizes the final merge:

1. verify exact merged `main` SHA
2. switch/reconfirm staging tracks `main`
3. verify migration state
4. deploy that exact merged SHA
5. verify `/version`
6. run the full pinned staging gate
7. produce the owner acceptance checklist

Only then can the final merged release be called **STAGING VERIFIED**.

Only after the owner opens the correct deployed build and sees the expected product can status become **OWNER DELIVERED**.

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


---

## 48. WORLD-CLASS PRODUCT EXPERIENCE BAR — OWNER REQUIREMENT

The owner requires BuildHub to look and behave at a **very high global standard from top to bottom**.

This is not optional polish.

A technically correct page that looks generic, unfinished, internally inconsistent, visually weak, cramped, noisy, dated or obviously AI-generated is NOT release-ready.

Target the level of craft expected from leading global marketplace, SaaS, fintech and premium digital-product experiences.

Do not copy another company’s visual identity.

Use their level of:

- hierarchy
- restraint
- consistency
- responsiveness
- interaction quality
- information architecture
- trust
- content quality
- perceived speed
- visual polish

as the bar.

The standard applies to **every route**, including forgotten deep pages, settings, empty states, errors and Admin — not only Home and Marketplace.

---

## 49. DESIGN SYSTEM QUALITY

BuildHub must feel like one product designed by one excellent team.

Maintain one coherent system for:

- typography
- type scale
- spacing
- grids
- container widths
- radii
- shadows/elevation
- borders
- icon sizes
- buttons
- inputs
- selects
- tabs
- tables
- cards
- drawers
- dialogs
- badges
- tooltips
- breadcrumbs
- pagination
- skeletons
- empty states
- alerts/toasts

Avoid one-off component styling unless the experience genuinely requires it.

Remove inconsistent duplicate visual patterns.

Do not use arbitrary spacing, random colors or per-page button conventions.

---

## 50. VISUAL HIERARCHY

Every page must answer visually, within seconds:

1. Where am I?
2. What is this page for?
3. What matters most?
4. What can I do next?
5. What requires my attention?

Use deliberate:

- page titles
- supporting copy
- primary CTA
- secondary actions
- section hierarchy
- whitespace
- grouping
- visual emphasis

Do not make every element equally loud.

Do not create dashboard walls of identical cards.

---

## 51. PREMIUM PUBLIC-SITE STANDARD

Public BuildHub surfaces must feel credible enough for a major construction buyer,
developer, consultant, supplier or enterprise procurement team.

Review and refine:

- Home
- Marketplace
- Category
- Search
- Product detail
- Provider storefront
- Professional profile
- Get Quotes / RFQ entry
- About/trust/support surfaces where present
- navigation
- footer

The public site should communicate:

- what BuildHub is
- who it serves
- what can be sourced
- why the marketplace is trustworthy
- how to start
- how to contact/request quotes
- clear differentiation between editorial Featured and commercial Sponsored

No weak placeholder hero copy.
No generic “Lorem ipsum” feel.
No fabricated social proof.

---

## 52. PREMIUM MARKETPLACE STANDARD

Marketplace UI must balance **rich B2B information density** with clarity.

Cards should reveal enough to make a sourcing decision without becoming cluttered.

Provider cards should emphasize applicable:

- identity
- category/specialty
- location/coverage
- verification
- useful real reputation/response information
- meaningful CTA

Product cards should emphasize applicable:

- imagery
- product identity
- supplier
- category
- commercial/specification summary
- meaningful CTA

Do not fill cards with low-value metadata.

Featured, Sponsored and Organic must have clear but tasteful hierarchy.

---

## 53. PREMIUM DASHBOARD STANDARD

Authenticated dashboards must feel like professional workspaces, not template admin panels.

Dashboard pattern:

- concise role-relevant greeting/context
- important KPIs only
- actionable alerts
- compact activity/work previews
- meaningful quick actions
- View All links
- role-specific next steps

Full management belongs on dedicated pages.

Do not use the same dashboard composition for every role merely with changed labels.

---

## 54. PREMIUM ADMIN STANDARD

Admin should resemble a serious operational control plane.

Prioritize:

- excellent information density
- clear state/status
- fast scanning
- strong search
- filters that reflect real workflows
- useful table columns
- keyboard efficiency
- human-readable references
- deep links
- audit/history
- clear dangerous-action confirmations
- excellent loading/error states

Avoid giant cards for dense operational datasets.

Use tables where tables are appropriate.

Use detail panes/pages where investigation requires context.

Admin must still look polished and intentionally designed.

---

## 55. TYPOGRAPHY & CONTENT CRAFT

Typography must be deliberate in both English and Arabic.

Use consistent:

- heading scale
- body size
- line height
- label weight
- numeric emphasis
- table text
- helper text

Do not rely on tiny text to fit too much information.

Avoid excessive bold.

Avoid ALL CAPS except where intentional and visually appropriate.

Arabic typography must be visually balanced and not treated as a translated afterthought.

User-facing copy must be:

- concise
- professional
- human
- specific
- consistent
- action-oriented when appropriate

Remove developer language, raw enums and implementation terminology.

---

## 56. COLOR & BRAND DISCIPLINE

Use a controlled brand palette.

Color should communicate:

- brand identity
- hierarchy
- status
- attention

not decorate randomly.

Status colors must be semantically consistent across the entire product.

Do not rely on color alone for meaning.

Avoid excessive gradients, neon treatments, loud shadows or decorative effects that make the product look cheap.

Premium means controlled, not flashy.

---

## 57. IMAGERY & MEDIA

Images must be:

- sharp
- correctly cropped
- aspect-ratio controlled
- responsive
- lazy-loaded where appropriate
- supported by useful alt text when content-bearing

Avoid distorted provider logos or product images.

Use sensible fallback treatment for missing media.

Do not stretch low-resolution imagery to fill large premium surfaces.

Do not use irrelevant stock imagery merely to make pages look populated.

---

## 58. INTERACTION QUALITY

Every interaction should feel intentional.

Required states where applicable:

- default
- hover
- focus
- active
- pressed
- disabled
- loading
- success
- error

Buttons must not visually jump during loading.

Forms must not double-submit.

Use subtle motion only when it improves orientation/feedback.

Avoid gratuitous animation.

Respect reduced-motion preferences.

Dialogs/drawers should open/close smoothly, trap focus correctly and restore focus.

---

## 59. FORM EXPERIENCE

Forms must be exceptionally clear.

For important forms:

- logical grouping
- clear labels
- required indicators
- useful helper text
- correct defaults
- inline validation
- server validation
- preservation of user-entered data after recoverable errors
- disabled/pending submit state
- duplicate-submit protection
- clear success outcome

Long forms should be segmented where appropriate.

Do not overwhelm a user with a wall of fields.

Do not collect fields the product does not use.

---

## 60. TABLE / DATA EXPERIENCE

For professional datasets:

- server-side pagination where data can grow
- real totals
- meaningful filters
- useful sorting
- search
- responsive strategy
- clear empty/error/loading states
- sticky header where useful
- horizontal overflow contained intentionally
- row actions discoverable but not noisy

Do not silently truncate.

Do not force dense desktop tables into unreadable mobile layouts.

---

## 61. RESPONSIVE CRAFT

Responsive design is not “desktop squeezed smaller.”

At each key width — especially 375, 768 and 1440 — intentionally adapt:

- navigation
- card count
- columns
- tables
- forms
- dialogs
- drawers
- filters
- action placement
- sticky elements
- typography
- whitespace

Primary actions must remain obvious.

No hidden critical control.

No accidental sideways page scroll.

No dialog larger than the usable viewport.

---

## 62. ACCESSIBILITY BAR

Target practical **WCAG 2.2 AA** quality across critical flows.

Verify rendered behavior for:

- keyboard-only use
- visible focus
- logical focus order
- semantic headings
- accessible form labels
- error association
- button/link semantics
- dialog focus
- menu/tab navigation
- table semantics
- useful alt text
- sufficient contrast
- status not communicated by color alone
- reduced motion support
- touch target usability

Accessibility failures on critical journeys are release defects.

---

## 63. PERFORMANCE BAR

Treat perceived speed as part of design quality.

Target strong Core Web Vitals on important public pages where realistic:

- LCP at or below ~2.5s at the 75th percentile
- INP at or below ~200ms at the 75th percentile
- CLS at or below ~0.1 at the 75th percentile

Where production telemetry is unavailable, use representative lab measurements and record the limitation.

Also review:

- first-load JS
- route chunking
- image size
- lazy loading
- repeated network calls
- large payloads
- query efficiency
- expensive rerenders
- skeleton/loading behavior

Do not chase synthetic scores by removing useful product functionality.

---

## 64. RELIABILITY / RESILIENCE BAR

A premium site must remain understandable when something goes wrong.

Every substantial data surface must distinguish:

- loading
- ready
- empty
- error
- stale/refreshing where useful

Users should receive actionable recovery where possible.

Network/database/storage outages must not masquerade as valid business states.

Retry should not duplicate effects.

---

## 65. SECURITY / PRIVACY BAR

In addition to existing server authorization, review release posture for:

- secure session/cookie configuration
- CSRF protection where applicable
- XSS-safe rendering
- secure file serving
- rate limiting / abuse controls
- brute-force protection
- secure password/token handling
- sensitive-data minimization
- safe error messages
- security headers / CSP where architecture supports it
- dependency risk
- secret handling
- auditability of privileged changes

Do not expose PII merely to make a workflow look richer.

Premium trust is partly what users do **not** see leaked.

---

## 66. SEO / DISCOVERABILITY BAR

Public marketplace pages should be technically discoverable and professionally presented to search engines.

For relevant public pages:

- unique title
- useful meta description
- canonical URL
- semantic headings
- descriptive URL
- crawlable meaningful content
- sitemap participation where architecture supports it
- robots behavior
- structured data where accurate and useful
- Open Graph/social metadata where appropriate

Do not expose private/authenticated content for SEO.

---

## 67. LOCALIZATION / ARABIC QUALITY BAR

Arabic is a first-class product language.

Do not accept:

- untranslated English fragments
- raw enums
- broken RTL spacing
- mirrored-but-wrong icons
- mixed alignment
- awkward machine-like copy
- English-only charts/statuses

Review important Arabic screens visually, not only through translation-key coverage.

Arabic copy should read naturally and professionally.

---

## 68. TRUST & CREDIBILITY BAR

Every marketplace trust signal must be earned and explainable.

Examples:

- verification badges
- review counts
- response metrics
- Featured
- Sponsored
- certification
- project history

Never imply endorsement, verification, popularity or quality that the system cannot prove.

Where a metric has insufficient data, prefer omission or “Not enough data” over a misleading percentage.

---

## 69. OBSERVABILITY / OPERATIONS BAR

Global-standard engineering includes operating the product after launch.

Ensure important operations can be diagnosed through appropriate:

- structured logs
- error tracking hooks
- build identity
- audit trail
- request/context correlation where practical
- operational health indicators
- migration state
- failed background-action visibility

Do not expose operational internals to ordinary users.

A critical failure should be diagnosable without guessing which build or user flow produced it.

---

## 70. VISUAL QA / SCREENSHOT GATE

Before final release approval, perform a page-by-page rendered visual review.

At minimum capture/review critical surfaces in:

- English desktop
- English mobile
- Arabic/RTL desktop
- Arabic/RTL mobile

For owner-critical evidence record:

- route
- role
- build SHA
- timestamp
- viewport
- language

Review not only whether the page works, but whether it looks premium.

Flag and fix:

- poor spacing
- inconsistent alignment
- cramped layout
- weak hierarchy
- awkward blank space
- inconsistent button sizing
- broken wrapping
- low-quality empty states
- ugly tables
- misplaced badges
- poor mobile composition
- inconsistent icons
- inconsistent borders/radii
- weak image presentation
- visual imbalance in Arabic

---

## 71. DESIGN CONSISTENCY CENSUS

Perform a bounded consistency census before final release.

Inventory common UI patterns and detect unnecessary variants of:

- primary buttons
- secondary buttons
- destructive actions
- badges
- status chips
- page headers
- table toolbars
- filters
- cards
- empty states
- pagination
- modal layouts

Consolidate materially inconsistent variants into shared primitives where safe.

Do not launch a risky framework rewrite merely to make everything identical.

---

## 72. MICROCOPY / LANGUAGE CENSUS

Review critical user-facing copy for:

- grammar
- spelling
- clarity
- consistency
- tone
- terminology
- bilingual equivalence

Use one term for one concept.

Examples:

Do not alternate between:
Vendor / Supplier
unless they intentionally mean different things.

Do not alternate:
Featured / Promoted / Sponsored
when the business meaning differs.

Do not expose:
snake_case
technical error messages
database terminology
internal procedure names.

---

## 73. NO “AI-GENERATED WEBSITE” LOOK

Avoid common low-quality generated-interface patterns:

- too many gradient cards
- every section inside a rounded box
- excessive icons
- excessive badges
- huge generic hero headings
- repetitive three-card layouts
- random decorative statistics
- excessive animation
- dense walls of text
- inconsistent visual metaphors
- decorative fake dashboards
- generic empty-state illustrations everywhere

BuildHub should look intentionally designed for construction procurement, not assembled from generic components.

---

## 74. CONSTRUCTION-SPECIFIC VISUAL IDENTITY

Without overdecorating, the product should visually feel appropriate to:

- construction
- architecture
- materials
- engineering
- procurement
- professional B2B work

This can come through:

- photography/media choices
- information architecture
- product/spec presentation
- project/RFQ terminology
- supplier/profile structures
- restrained industrial/professional visual language

Do not use cliché hard-hat imagery everywhere.

Domain credibility should come primarily from useful information and workflows.

---

## 75. HOMEPAGE QUALITY GATE

The homepage must be more than attractive.

It should clearly communicate:

- BuildHub value proposition
- buyer path
- provider path
- marketplace path
- Get Quotes / RFQ path
- trust signals
- major categories
- why to use BuildHub
- strong next action

Do not fabricate customer logos, counts or testimonials.

If real proof is unavailable, use product capability and clear explanation rather than fake social proof.

---

## 76. FIRST-TIME USER QUALITY

A fresh user should not need prior knowledge of BuildHub.

For each role, verify:

- clear orientation
- obvious first action
- explanation of empty dashboard
- onboarding progress
- relevant help/context
- no dead end
- no unexplained disabled capability

Fresh-account experience is a premium-quality criterion, not just an ACC-4 test.

---

## 77. TRUSTED DESTRUCTIVE-ACTION UX

Dangerous actions such as:

- delete
- archive
- freeze
- withdraw
- reject
- hide
- revoke
- deactivate

must make consequences clear.

Use confirmation proportional to risk.

Do not use confirmation dialogs for every trivial action.

Require reasons where audit/business policy needs one.

After action, show the actual resulting state.

---

## 78. FINAL WORLD-CLASS RELEASE GATE

The release gate in §42 is necessary but not sufficient.

Before asking for owner merge authorization, also verify:

- no critical page looks obviously unfinished
- no major page uses inconsistent visual primitives without reason
- no public/role/Admin journey contains dead-looking UI
- critical mobile layouts look intentionally designed
- Arabic screens look intentionally designed
- critical empty/error/loading states are polished
- public marketplace hierarchy is premium
- provider storefront is premium
- product detail is premium
- RFQ and quotation flows are premium
- role dashboards are premium
- Admin control plane is professional
- typography/spacing/alignment are consistent
- important interactions have polished states
- visual QA screenshots reviewed
- Core Web Vitals/performance have been assessed
- WCAG 2.2 AA-critical issues are resolved
- SEO/discoverability is complete for public surfaces
- security/privacy/reliability gates remain green

Do not request merge merely because functionality is complete.

**The website must look and feel release-worthy.**

---

## 79. OWNER QUALITY PRINCIPLE

The owner explicitly requires a **very, very high standard from top to bottom**.

Interpret that as:

- no “good enough” hidden pages
- no premium homepage with mediocre inner pages
- no polished buyer side with weak supplier side
- no polished public site with crude Admin
- no strong English with weak Arabic
- no good desktop with broken mobile
- no attractive UI covering dishonest data
- no secure backend behind misleading controls
- no powerful feature that the user cannot find

The quality bar is horizontal across the whole product, not concentrated on a few showcase screens.

If a page is part of the release, it must meet the same product-quality discipline as the rest of BuildHub.
