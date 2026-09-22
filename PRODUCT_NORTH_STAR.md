# BuildHub — Revolutionary Product North Star

## Status

This is an **owner-level product directive** and must be read together with:

- `CLAUDE.md`
- `OWNER_DECISIONS.md`
- `REACHABILITY_CENSUS.md`
- `todo.md`
- latest release-candidate Git history

It exists because the current product can be technically correct while still feeling ordinary.

The owner requirement is stronger:

> BuildHub must become a premium, differentiated, construction-specific B2B sourcing and procurement platform whose product depth, information architecture, trust model, supplier growth tools and connected workflows make it difficult to replace.

This is not a request to copy Alibaba, Alimama, Material Bank, Thomasnet, Amazon Business, Houzz, Stripe, Linear, Airbnb or any other product.

Use the **quality and capability bar**, not their branding.

---

# 1. Explicit non-acceptance of the current Marketplace information architecture

The current Marketplace Hub is **not the target**.

Specific problems visible in the current owner-preview build include:

1. A large Featured Products strip can appear with no Featured Providers beside it.
2. Premium Featured product cards can render with missing imagery.
3. “Browse by category” currently shows many small product categories before the higher-level marketplace destinations.
4. Product taxonomy and marketplace verticals are mixed at the same hierarchy level.
5. The Products macro-card currently emphasizes the number of categories rather than the number of real products.
6. The homepage platform statistics do not currently include the real number of public/listable products.
7. QA/test identities can dominate staging marketplace previews, making visual review look artificial even when engineering is correct.
8. Category tiles use inconsistent visual treatment and low-fidelity iconography; missing glyphs are unacceptable.
9. Marketplace sections still feel like separately evolved pages rather than one coherent sourcing system.
10. The marketplace is not yet displaying the full BuildHub strategic advantage: products + suppliers + professionals + projects + RFQs + quotations + technical documents + trust + analytics.

These are not cosmetic details. They are information-architecture and positioning defects.

---

# 2. North-star marketplace mental model

BuildHub is not a catalogue.

BuildHub is not merely a directory.

BuildHub is not merely an RFQ website.

BuildHub should become:

## THE CONSTRUCTION SOURCING GRAPH

A buyer begins with any one of:

- a product
- a specification
- a category
- a supplier
- a professional
- a project
- a BOQ line
- an RFQ
- a technical requirement

and can move naturally into the rest of the BuildHub graph.

Example:

`Lighting Product → Supplier → Save → Project → RFQ → Quotation → Compare → Message → Technical Document → Decision → Review / Dispute`

That connected graph is the strategic product.

---

# 3. Marketplace top-level information architecture

Do not mix marketplace verticals with product taxonomy.

The marketplace should have a clear first-level model such as:

## Products
Physical materials, equipment, furniture, systems and components.

## Suppliers
Manufacturers, distributors, dealers and material suppliers.

## Professionals
Architects, engineers, designers, project managers and consultants.

## Contractors & Services
Contractors, installers, finishing companies and specialist services.

## RFQ / Sourcing
Post requirements, manage sourcing requests and connect them to the marketplace.

These are the MACRO destinations.

Only after a user chooses a macro destination should the relevant taxonomy dominate.

Example:

Marketplace
→ Products
→ Materials
→ Flooring
→ Porcelain Tile
→ Product

NOT:

Marketplace
→ 12 tiny product categories
→ giant Products card below them.

---

# 4. Marketplace Home — required revolutionary structure

The Marketplace Home should be redesigned around sourcing intent.

Recommended structure:

## A. Sourcing Hero

Primary question:

**What do you need for your project?**

One strong universal search.

Search across authorized public:

- products
- suppliers
- professionals
- services
- brands
- categories

Primary CTA:

**Post an RFQ / Get Quotes**

Secondary actions:

- Browse Products
- Find Suppliers
- Find Professionals

Do not make the hero decorative. It should start sourcing.

## B. Marketplace Scale / Trust Strip

Use real, query-backed numbers only.

Potential metrics:

- public/listable Products
- approved Suppliers
- verified Professionals
- active RFQs / sourcing opportunities where public disclosure is appropriate
- product categories

The number of PRODUCTS must be restored as a real marketplace metric.

Do not substitute “55 categories” for “number of products.”

Outage != zero.

## C. Choose what you are sourcing

Large premium navigation modules for:

- Products
- Suppliers
- Professionals
- Contractors & Services

This appears BEFORE the detailed product taxonomy.

These are not generic cards. Each should communicate what can be done inside.

## D. Featured Marketplace

BuildHub editorial selection should not be product-only.

Use a balanced premium composition such as tabs/carousels/sections:

- Featured Suppliers
- Featured Products
- Featured Professionals
- Featured Services / Contractors where editorially applicable

Only show real curated entities.

If a particular type has no curated records, degrade gracefully without making the marketplace look broken.

Featured editorial slots should require minimum presentation quality.

A product with no usable image should normally NOT qualify for a premium Featured Product hero/card.

A provider with an empty profile should normally NOT qualify for a premium Featured Provider card.

Editorial curation should protect BuildHub’s visual quality.

## E. Top Product Categories

Now show the canonical product taxonomy.

Use a limited number of high-value categories, not a wall.

Use:

- consistent professional iconography or imagery
- category title
- optional real listing count if useful
- clear “View all categories”

No emojis.
No missing-glyph squares.
No mixed visual language.

## F. Recommended / Relevant Discovery

When there is enough real context, support:

- Recommended for your project
- Based on saved categories
- Related suppliers
- Similar products

Start deterministic and explainable.

## G. Sponsored Discovery

Commercial placement should have a clearly labelled dedicated surface.

Do not visually confuse it with editorial Featured.

## H. Why Source on BuildHub

Trust/value section using real platform capabilities:

- verified providers
- structured RFQs
- quotation comparison
- project-linked sourcing
- secure messaging
- technical documents
- review/dispute history

No invented testimonials or scale claims.

---

# 5. Product-count requirement

Restore the real public product count as a first-class metric.

The current `platformStats` contract should be extended so public owner-facing stats can truthfully include a count such as:

`publicProducts`

Definition must be exact and documented.

Recommended definition:

products currently visible/listable in the public marketplace under the canonical lifecycle/visibility rules.

Do NOT count:

- drafts
- withdrawn/archived
- hidden
- invalid
- QA-only production-excluded content

Use the same public visibility predicate as marketplace product discovery.

The Marketplace Products macro-card should display:

**X Products**

not:

**55 Categories**

as its primary marketplace-scale statistic.

Category count can remain secondary where useful.

---

# 6. Featured eligibility quality gate

Premium editorial surfaces must have quality requirements.

A Featured Product should normally require:

- active/public lifecycle
- valid canonical category
- useful title
- supplier
- usable primary image
- enough specification/commercial detail to evaluate
- no moderation/compliance block

A Featured Provider should normally require:

- approved/public provider
- useful profile
- category/specialty
- location/coverage where applicable
- valid public identity
- image/logo/avatar or an intentional premium fallback
- no compliance suspension

If editorial Admin chooses an incomplete entity, Admin should be warned before activation.

Do not silently show broken-image premium content.

---

# 7. Product discovery — world-class standard

Product search should progressively support real category-specific faceting.

Universal facets:

- category
- subcategory
- supplier
- brand
- location/origin where applicable
- price / price on request
- unit
- availability where reliable
- lead time
- warranty
- verification
- Featured
- Sponsored

Category-dependent attributes:

Tiles:
- dimensions
- finish
- material
- thickness
- application

Lighting:
- wattage
- color temperature
- IP rating
- indoor/outdoor
- controls

HVAC:
- capacity
- efficiency
- power
- application

Doors:
- material
- fire rating
- dimensions
- acoustic rating

Do not create one enormous generic product form.

Use category schemas.

---

# 8. Product detail — sourcing page, not catalogue page

A premium Product Detail page should support the sourcing decision.

Applicable information:

- strong image/media gallery
- product identity
- supplier identity
- category breadcrumbs
- specifications
- variants
- price/unit if real
- Price on Request otherwise
- MOQ
- lead time
- warranty
- certification / technical documents
- applications
- related products
- related supplier products
- Q&A
- verified reviews if eligible

Primary sourcing actions:

- Add to RFQ
- Request Quote
- Contact Supplier
- Ask a Question
- Save
- Compare
- Request Sample where applicable

All actions must connect to canonical BuildHub systems.

---

# 9. Supplier storefront — Alibaba-class but construction-native

A provider storefront should be substantial enough for a buyer to assess a business before contacting it.

Required/applicable sections:

- cover/header identity
- logo
- company overview
- verified credentials
- specialties
- categories
- service regions
- products
- services
- Supplier Showcase
- portfolio
- public project experience
- certifications
- technical capabilities
- business hours
- reviews
- response metrics when statistically meaningful
- Q&A / contact
- RFQ / quote actions

The storefront should have its own search/filter over the supplier catalogue where scale requires it.

Supplier can customize content within controlled design-system boundaries.

Do not allow arbitrary HTML/CSS that destroys consistency/security.

---

# 10. Supplier Showcase

Supplier Showcase is a supplier-controlled “shop window.”

It is distinct from:

- Featured = BuildHub editorial
- Sponsored = paid/commercial placement

Supplier Showcase may highlight selected own products/services in the supplier storefront.

It should NEVER imply BuildHub endorsement.

---

# 11. Buyer Sourcing Workspace

Create a coherent sourcing workspace.

Core concepts:

## Saved Products

## Saved Suppliers

## Shortlists

## Project Boards / Sourcing Boards

Organize saved products/providers by project or sourcing need.

## Compare

Products
Suppliers where objectively useful
Quotations

## RFQ Basket

Turn selected products/specifications into one structured sourcing request.

## Received Quotations

Compare commercial and technical terms.

## Messages

Canonical communications.

## Documents

Technical sheets, drawings, specifications, quotation attachments.

Do not scatter these concepts across unrelated favorites mechanisms.

---

# 12. Thomasnet-style evaluate and shortlist

BuildHub should allow buyers to:

Search
→ Evaluate
→ Shortlist
→ Contact / Request Quote

Supplier comparison should use objective facts, not a subjective winner score.

Possible fields:

- verified credentials
- categories
- locations
- certifications
- products
- portfolio
- review summary
- response metrics
- applicable experience

Buyer chooses.

---

# 13. Material Bank-style material workflow

For applicable construction/finishing materials, BuildHub should progressively add:

- rich specification data
- technical document downloads
- material boards/project boards
- Request Sample
- save materials to project
- compare materials
- supplier rep communication

Sample ordering may initially be an inquiry/request workflow.

Do not fake logistics fulfillment before logistics exists.

---

# 14. RFQ Opportunity Market — Alibaba-class supplier acquisition

Supplier Opportunity Centre should become a major product.

Supplier can find real eligible RFQs through:

- category
- specialty
- geography
- capability
- verification
- invitation
- project relationship
- entitlement

States:

- Recommended
- Invited
- Available
- Opened
- Responded
- Declined
- Closed

Explain recommendation where useful.

Examples:

- Matches Lighting
- Serves Jeddah
- Invited by Buyer
- Matches your approved category

No fake AI match percentage.

---

# 15. Lead Centre / supplier CRM

BuildHub should help a supplier manage commercial opportunity, not merely list RFQs.

Possible pipeline:

- New Opportunity
- Invited
- Qualified
- Opened
- Quote Sent
- Follow-up
- Accepted / Won
- Closed / Lost

Only use states backed by actual lifecycle.

Provide:

- opportunity reference
- buyer/project context where authorized
- dates
- last activity
- next action
- message status
- quotation status

Dashboard summarizes.
Lead Centre manages.

---

# 16. Alimama-style Marketing Center — construction marketplace version

Supplier-side Marketing Center is a strategic moat.

It should manage:

- Sponsored Products
- Sponsored Providers
- Category placement
- Search/keyword placement
- Marketplace placement
- campaign start/end
- category scope
- geography where legitimate
- status
- entity/creative
- impressions
- clicks
- profile/product views
- inquiry actions
- Add-to-RFQ actions
- quotation opportunity attribution where defensible

Payment remains deferred.

Until payments exist, campaign access can come from:

- plan entitlement
- Admin grant
- promotional credit
- referral benefit

No fake budget.
No fake CPC.
No fake revenue.

---

# 17. Keyword and demand intelligence

BuildHub should progressively create a real marketplace-intelligence layer.

Supplier insights can include aggregated real data such as:

- top searched categories
- top searched terms
- rising RFQ categories
- regional demand
- unanswered/undersupplied RFQs
- category demand gaps
- products receiving views but no inquiries
- storefront completeness opportunities

Use minimum sample thresholds.

Never expose private buyer/supplier information.

Never fabricate “Trending.”

---

# 18. Search as a moat

Search should become a serious asset.

Architecture target:

- bilingual Arabic/English normalization
- synonyms
- aliases
- brand names
- category ontology
- transliteration support where useful
- typo tolerance
- attribute faceting
- provider capability search
- relevance ranking
- commercial Sponsored separation

Search discovery may be fuzzy.

Stored category assignment/business writes remain deterministic.

---

# 19. Construction taxonomy / specification graph

This is a major defensive asset.

The canonical taxonomy should evolve from a flat category list into a construction product/service ontology.

Examples of relationships:

Category
→ subcategory
→ product type
→ specification schema
→ compatible services
→ typical professional/provider capabilities
→ certifications
→ technical documents
→ RFQ attributes

Over time, this lets BuildHub understand the difference between:

“Lighting”
and
“IP65 outdoor 3000K architectural wall washer.”

Competitors can copy pages.

A deeply normalized domain graph is harder to copy.

---

# 20. BOQ / specification intelligence — strategic moat

Near-term strategic milestone:

Buyer uploads:

- BOQ
- specification sheet
- Excel
- PDF
- schedule

BuildHub assists with:

- extracting line items
- matching canonical categories
- identifying missing information
- grouping RFQ lots
- suggesting relevant supplier capability
- linking products
- producing structured sourcing packages

AI suggestions must be reviewable.

Never silently convert uncertain AI guesses into authoritative project data.

This is one of BuildHub’s strongest potential barriers to entry.

---

# 21. Technical compliance comparison

Long-term quotation comparison should go beyond price.

For structured RFQ lines, BuildHub should help compare:

- requested specification
- supplier offered specification
- compliance / deviation
- quantity
- price
- lead time
- warranty
- certification
- attachment
- revision

Where AI assists with document reading, show evidence/source and uncertainty.

Do not claim engineering compliance without evidence.

---

# 22. Construction trust graph

Trust should become data-rich and defensible.

Potential verified dimensions:

- identity
- business registration
- professional license
- business documents
- category capability
- certification
- project history
- quotation history
- review integrity
- moderation history

Verification is never bought through advertising.

Sponsored ≠ Verified.

Featured ≠ Verified.

---

# 23. Project-linked sourcing — BuildHub's unique advantage

Generic B2B marketplaces are product/seller centric.

BuildHub should be PROJECT centric.

Every sourcing object should be able to connect to a project where appropriate:

Saved Product
→ Project

Shortlist
→ Project

RFQ
→ Project

Quotation
→ Project

Documents
→ Project

Expenses
→ Project

Review/Dispute
→ Project/RFQ/Quotation

This creates workflow history and switching cost.

---

# 24. Main Home page — premium strategic redesign

The main BuildHub homepage should not primarily sell a list of generic features.

It should communicate BuildHub’s unique sourcing proposition.

Recommended hierarchy:

## Hero

**Source. Compare. Build.**
or another concise owner-approved proposition.

Universal sourcing search.

Primary CTA:
Post an RFQ

Secondary:
Explore Marketplace

## Real Platform Proof

Real public product count
Approved suppliers
Verified professionals
Active projects/RFQs where meaningful

No fake scale.

## Three core jobs

Source Products
Find Trusted Providers
Manage Project Sourcing

## Live Marketplace Preview

Featured suppliers
Featured products
Top categories

## How sourcing works

Discover
→ Shortlist
→ RFQ
→ Compare
→ Collaborate

## For Suppliers

Get discovered
Find RFQs
Quote
Manage Leads
Promote
Measure performance

## Trust

Verification
Structured records
Reviews
Disputes

## Strong final CTA

No repetitive generic feature-card wall.

---

# 25. Remove low-quality visual signals

Current/future release must reject:

- broken image placeholders in premium Featured sections
- emoji category icons
- missing-glyph squares
- QA usernames as prominent owner-demo marketplace content
- tiny chips used as primary navigation
- arbitrary colored cards
- repetitive generic cards
- huge empty card space
- weak hierarchy
- fake counts
- raw technical states
- generic “View” buttons everywhere

Every premium surface must have deliberate content and presentation.

---

# 26. Staging visual-data policy

Staging needs test personas for functional acceptance.

But owner visual QA should not be dominated by ugly QA identities.

Create a clear separation:

## Functional QA data
May use explicit QA identities.

## Owner visual showcase data
May use clearly labelled **Staging Demo** entities designed to exercise the real data model and all visual states.

Never allow demo/test records into production.

Never represent staging demo records as real companies.

Owner screenshots must clearly identify staging build/environment.

---

# 27. Design language direction

BuildHub should feel:

- architectural
- precise
- confident
- premium
- information-rich
- calm
- industrial/professional

Not:

- playful consumer app
- generic admin template
- crypto dashboard
- AI-generated card wall
- marketplace clone

Use strong grid discipline, typography, media, technical data presentation and restrained color.

---

# 28. Moat / barrier-to-entry strategy

The defensibility does NOT come from having more menu items.

The moat comes from five connected flywheels.

## A. Supply Graph

More verified suppliers
→ richer catalogues
→ better discovery
→ more buyers
→ more RFQs.

## B. Demand Graph

More buyer searches/RFQs
→ stronger demand intelligence
→ better supplier listing/marketing decisions
→ better supply coverage.

## C. Project Graph

More projects
→ more BOQs/specs/RFQs/quotes/documents
→ better structured sourcing context
→ higher switching cost.

## D. Trust Graph

More verified transactions/engagement
→ stronger review/history/capability evidence
→ better buyer confidence.

## E. Marketing Graph

More impressions/clicks/inquiries
→ better marketplace promotion insights
→ higher supplier ROI
→ stronger supplier retention.

The product architecture should intentionally reinforce these flywheels.

---

# 29. Revolutionary capability sequence

Do not build everything simultaneously without release discipline.

## CURRENT GLOBAL RELEASE — must visibly feel premium

1. Marketplace information architecture redesign
2. restore real product count
3. premium macro marketplace navigation
4. balanced Featured Suppliers + Products + Professionals
5. premium Featured eligibility rules
6. coherent category discovery
7. provider storefront quality
8. product detail quality
9. Save / Shortlist
10. Contact Supplier
11. Add to RFQ
12. Request Quote / supplier-specific RFQ
13. supplier Opportunity Centre
14. Lead Centre
15. Supplier Showcase
16. Marketing Center foundation
17. Sponsored Product / Provider presentation
18. real analytics foundation
19. premium main homepage redesign
20. world-class visual QA across all release routes

## NEXT MARKETPLACE MOAT

1. project boards / material boards
2. Request Sample
3. advanced category-specific faceting
4. keyword demand intelligence
5. saved searches / alerts
6. richer supplier comparison
7. technical document library
8. enhanced seller recommendations
9. sitewide curated campaigns

## STRATEGIC MOAT

1. BOQ/specification ingestion
2. structured line-item sourcing
3. technical compliance matrix
4. construction taxonomy/specification graph
5. demand/supply intelligence
6. project-linked procurement memory
7. evidence-grounded AI sourcing copilot
8. regional standards/certification intelligence
9. integrations/API ecosystem

## FUTURE AFTER PAYMENT

1. CPC/CPM billing
2. paid campaign budgets
3. marketplace billing
4. escrow/order assurance if owner chooses and legal/financial architecture exists

## FUTURE AFTER TEAM/ORG

1. procurement teams
2. approval chains
3. shared supplier lists
4. organization workspaces
5. enterprise procurement controls

---

# 30. Release acceptance for the Marketplace revolution

Do not call the Marketplace world-class until the following are visually and functionally true.

## Home

- real product count restored
- value proposition is sourcing-focused
- no fabricated proof
- marketplace preview balanced

## Marketplace Home

- macro verticals are clear
- product taxonomy is subordinate to Products
- Featured is not product-only when curated providers/professionals exist
- missing images do not dominate premium sections
- no emoji/missing-glyph category presentation
- search starts a sourcing journey
- RFQ CTA is prominent
- Featured / Sponsored / Organic hierarchy is clear

## Products

- rich cards
- useful filters
- save/compare
- Add to RFQ
- supplier connection
- product detail supports sourcing

## Providers

- professional storefront
- objective evaluation information
- save/contact/request quote
- relevant products/services
- verification/trust

## Supplier workspace

- opportunities
- leads
- quotations
- marketing
- analytics
- listing completeness

## Buyer workspace

- saved
- shortlist
- compare
- RFQ basket
- quotations
- messages
- project linkage

## Admin

- editorial Featured control
- commercial Sponsored control
- placement inventory
- campaign visibility
- marketplace quality/completeness warnings

## Visual

- desktop/mobile
- Arabic/English
- no weak inner pages
- premium empty/loading/error states
- cohesive design system

---

# 31. Final strategic principle

BuildHub should not win because it has “many features.”

BuildHub should win because a buyer can move from:

**need → discovery → specification → shortlist → RFQ → quotation → collaboration → decision → project history**

without leaving the platform,

while a supplier can move from:

**storefront → discovery → opportunity → quote → relationship → marketing → analytics → growth**

inside the same marketplace.

The deeper BuildHub connects these two journeys to real construction data, project context, specifications and trust evidence, the harder it becomes to replace.
