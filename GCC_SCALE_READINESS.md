# BuildHub — GCC / Multi-Market Scale Readiness

## Purpose

BuildHub is launching from Egypt, but the architecture must not trap the product in Egypt.

The owner wants BuildHub to be able to expand into GCC markets without a second platform, a forked codebase, a destructive rewrite, or country-specific hacks spread through UI and business logic.

This document defines the **prepare-now architecture**.

It does **not** authorize launching any non-Egypt market yet.

Read together with:

- `CLAUDE.md`
- `PRODUCT_NORTH_STAR.md`
- `OWNER_DECISIONS.md`
- current migrations/schema

The principle:

> ONE platform, many markets; explicit market context, configurable rules, shared core domains.

Do not create separate Saudi/UAE/Qatar applications.

Do not hard-code Egypt assumptions into new work.

---

# 1. Market is a first-class domain concept

Introduce a canonical market/country concept using ISO 3166-1 alpha-2 codes.

Initial target vocabulary should be architecture-ready for:

- EG — Egypt
- SA — Saudi Arabia
- AE — United Arab Emirates
- QA — Qatar
- KW — Kuwait
- BH — Bahrain
- OM — Oman

A market configuration should be able to define, at minimum:

- countryCode
- display name EN/AR
- enabled / launch state
- default locale(s)
- default currency
- supported currencies
- default timezone / timezone policy
- phone calling context
- address labels/schema
- tax policy reference
- legal/terms version
- compliance profile
- search/discovery availability
- payment-provider configuration when enabled

Use configuration/data, not scattered switch statements.

---

# 2. Current Egypt-specific coupling found in the repository

The current release candidate still contains architecture that will block clean GCC expansion if it is allowed to spread.

Examples confirmed in the current repository:

- `products.currency` defaults to `EGP`
- `quotations.currency` defaults to `EGP`
- other commercial records also default to `EGP`
- `shared/billing.ts` explicitly declares EGP as the launch and only supported billing currency
- Product Form visibly says `Price (EGP)`
- RFQ basket copy says `Catalogue value: EGP ...`
- RFQ response uses subscription `BILLING_CURRENCY` as the quotation currency
- quotation comparison still uses `common.egp` in budget/difference presentation
- Marketplace/Product presentation contains Egypt-specific wording
- vendor country/city exist largely as free text
- provider service coverage is free text
- users/projects/RFQs rely heavily on a generic free-text `location`
- pricing formatting uses Egypt-oriented locale assumptions in places

These are acceptable launch-era constraints only if they stop expanding now.

Do not add new Egypt-only assumptions.

---

# 3. Separate four different location concepts

Never use one free-text `location` field to answer every geography question.

BuildHub needs distinct concepts.

## Account / person location

Where a user is based.

This is profile data and may be optional.

## Business legal country

Where a supplier/professional business is registered.

This affects compliance/legal identity.

## Service coverage

Where a provider is willing/eligible to work or deliver.

This may span multiple countries/regions.

## Project / RFQ location

Where the actual project or sourcing requirement exists.

This must drive:

- supplier matching
- regulatory context
- delivery/serviceability
- default commercial currency where policy says so
- local marketplace relevance

Do not infer one from another.

---

# 4. Structured geography

Move toward structured geography while preserving free-text address lines for humans.

Core fields should support:

- countryCode
- administrativeArea / state / province / emirate / governorate
- city
- postalCode where applicable
- addressLine1
- addressLine2
- latitude/longitude only where genuinely needed

Do not make "Governorate" a universal field name.

UI labels should be market-aware.

Keep a human display address, but do not use it as the authoritative matching key.

---

# 5. Provider service-area model

Free-text `serviceCoverage` can remain descriptive copy, but matching must eventually use normalized records.

Create a canonical provider service-area model capable of representing:

- country-wide coverage
- administrative-area coverage
- city coverage
- delivery vs on-site service where relevant

Example concept:

`providerServiceAreas(providerId, countryCode, adminAreaCode?, cityCode?, coverageType, active)`

RFQ/provider matching should use normalized coverage, not substring matching against "Cairo, Giza".

Cross-border suppliers should be possible explicitly.

---

# 6. Project and RFQ market identity

Project country is a first-class business fact.

Every project should ultimately have:

- countryCode
- normalized project geography
- timezone
- default commercial currency or explicit currency policy

Every RFQ should snapshot enough market context to remain historically understandable even if the project later changes.

At minimum:

- project/requirement countryCode
- currency
- delivery/service location
- relevant category/specification

Regulatory AI/context should prefer the project/RFQ country rather than the user's account country.

The repository already has jurisdiction knowledge for Egypt and GCC markets; connect that knowledge to explicit project market context instead of guessing from text.

---

# 7. Currency architecture — critical before GCC

Do not treat "currency" as a label appended to a two-decimal number.

GCC expansion makes this immediately unsafe.

Some currencies use three fractional digits.

Therefore a universal `decimal(..., 2)` money model is not sufficient as the long-term multi-market representation.

Before enabling GCC commercial transactions, choose one canonical money strategy:

## Preferred

Integer minor units + ISO currency code + currency metadata for scale.

OR

## Acceptable transitional model

A decimal precision capable of the maximum supported currency scale, with currency-specific validation/formatting.

Never:

- round every currency to two decimals
- derive quotation currency from subscription billing currency
- assume EGP in UI text
- concatenate symbols manually

Use `Intl.NumberFormat` or one canonical money formatter with explicit locale + currency.

---

# 8. Separate marketplace currency from subscription billing currency

These are different domains.

## Marketplace transaction/sourcing currency

Used for:

- product price
- RFQ budget
- quotation
- project sourcing comparison

## BuildHub subscription/payment currency

Used for:

- vendor plan
- promotional package
- future advertising spend
- invoices

Do not use `BILLING_CURRENCY` to determine a quotation currency.

The current RFQ response coupling to `BILLING_CURRENCY` must be removed before multi-market enablement.

An RFQ should define/derive its own commercial currency.

A quotation should either inherit that currency or deliberately select from currencies the RFQ allows.

---

# 9. Product architecture for multiple markets

Do not clone the same product row once per country merely to change price/availability.

Separate product identity from market offer where scale requires it.

Long-term pattern:

## Product core

- identity
- supplier
- taxonomy
- specifications
- media
- technical documents

## Market offer / availability

- productId
- marketCode
- active/listable
- currency
- price / price-on-request
- MOQ
- lead time
- delivery coverage
- availability
- market-specific compliance/certification where relevant

This allows one supplier/product to operate in Egypt, Saudi Arabia and UAE without three unrelated products.

For current release, do not perform a risky rewrite; design additive migrations toward this model.

---

# 10. Tax architecture

No VAT/tax percentage should be hard-coded globally.

Create a tax-policy abstraction capable of varying by:

- market
- effective date
- product/service type where required
- seller registration/tax status
- B2B/B2C treatment where applicable
- inclusive/exclusive display policy

Keep tax calculation separate from base prices.

Do not implement tax law from memory.

Each market launch requires current verified legal/tax configuration and owner/legal approval.

---

# 11. Compliance and verification by market

A "Verified" badge must not mean the same paperwork in every country.

Create a compliance-profile architecture.

Example dimensions:

- identity
- business registration
- professional licence
- tax registration
- trade/commercial registration
- category-specific licence/certification
- document expiry

Country/role determines required document types.

A supplier verified for Egypt is not automatically verified for Saudi Arabia or UAE.

Public badges should be scoped/worded accordingly.

---

# 12. Registration identifiers

Do not store every market's business identity in one generic `registrationNumber` forever.

Prepare a typed business-identifier model, e.g.:

- identifierType
- value
- countryCode
- issuingAuthority
- issuedAt
- expiresAt
- verificationStatus

Examples may differ by market.

Do not expose these identifiers publicly unless policy explicitly allows it.

---

# 13. Phone numbers

Normalize phone numbers in E.164 form where possible.

Store:

- normalized E.164 value
- optional display/local form only if needed

Do not validate all numbers with Egyptian assumptions.

Country selector and phone parsing should be market-aware.

---

# 14. Time and timezone

Store event timestamps in UTC.

Display in an explicit market/user/project timezone.

Deadlines, quotation validity and campaign start/end must not depend on the server's timezone.

A cross-border buyer and supplier may view the same event from different zones; the authoritative event must remain unambiguous.

---

# 15. Units and measurements

Construction data should not assume one display convention even if most target markets use metric.

Maintain canonical units and conversions where needed.

Category schemas should define valid units.

Do not bury units inside free-text product names.

---

# 16. Search and discovery by market

Search must understand market scope.

A user should be able to distinguish:

- suppliers physically/legal based in a market
- suppliers serving a market
- products available in a market
- professionals licensed/verified for a market
- cross-border supply

Default discovery should prioritize the selected/project market, not hide cross-border options that are legitimately serviceable.

Sponsored/Featured targeting must also include market scope.

---

# 17. Market selector and user context

Do not force users to create another account per country.

One account may operate across markets.

Persist an active market context for browsing.

Project/RFQ market overrides generic browsing preference when operating inside a project/sourcing workflow.

Future public URL strategy should support market-specific SEO, for example market-aware paths/canonical metadata, without cloning the application.

Do not implement a route migration blindly during the release candidate; preserve the architectural ability.

---

# 18. Localization

Arabic and English remain first-class.

Country expansion must not create six different translation systems.

Use one translation architecture plus market-specific content/config where terminology genuinely differs.

Support:

- market-aware address labels
- currency formatting
- local dates/numbers
- legal copy versions
- market-specific help/compliance guidance

Avoid flag-as-language UX: country and language are separate choices.

---

# 19. Analytics must carry market dimension

All meaningful growth/marketplace analytics should be able to segment by market.

Applicable events should carry or derive:

- marketCode
- project/RFQ country where applicable
- user active market where applicable

This includes:

- search
- category view
- product impression
- provider impression
- Sponsored/Featured impression
- click
- inquiry
- RFQ
- quotation
- referral
- campaign

Do not mix Egypt and GCC performance into one number when market context matters.

---

# 20. Referral / promotion / marketing market scope

Referral Campaigns, Featured, Sponsored and Marketing Center must be able to scope eligibility by market when required.

Examples:

- Saudi launch campaign
- UAE supplier acquisition campaign
- Egypt-only Featured placement
- GCC-wide supplier campaign

Do not create duplicate campaign engines per country.

Add market targeting to the canonical campaign/placement models.

---

# 21. Billing / payment provider abstraction

The repository already has provider abstraction concepts. Preserve them.

Before enabling payments in multiple markets, the billing domain must support:

- market-specific plan catalogue
- supported currency
- tax
- provider
- price/version effective date
- invoice requirements
- refund semantics

Do not encode a global plan price in EGP and convert it at runtime.

Each approved market/currency price should be an explicit product/price decision.

---

# 22. Data residency and infrastructure

Do not assume one infrastructure topology will satisfy every future enterprise/GCC requirement.

Prepare portability:

- storage provider abstraction
- database backup/export
- environment-specific secrets
- region-aware deployment configuration
- market-independent object keys
- no Egypt-specific hostname coupling

Before launching any country, verify that country's current privacy/data-hosting requirements and enterprise procurement expectations.

Do not make legal claims from architecture assumptions.

---

# 23. Legal / policy versioning

Terms, privacy, seller policies, dispute terms and commercial policies may vary by market and effective date.

Persist policy acceptance with:

- policy type
- version
- market
- acceptedAt
- user/account

Do not overwrite historical policy text and lose which terms governed an earlier transaction.

---

# 24. Country rollout controls

Add/prepare centralized market feature flags.

A market can be:

- disabled
- internal QA
- invitation/beta
- public

Capabilities may also be market-gated:

- buyer registration
- supplier registration
- public marketplace
- RFQ creation
- provider quoting
- Sponsored campaigns
- subscriptions/payments

Do not enable a market because a country appears in a dropdown.

---

# 25. Admin market operations

Admin needs market context.

Global Super Admin may see all markets.

Future restricted market Admins should be able to be scoped to one or more markets without leaking other-market records.

Admin search/filter/analytics should support market.

Do not implement market-scoped Admin authority casually; it is a security boundary and needs server-side tests.

---

# 26. Regional SEO

When country-specific marketplace content is launched, support:

- market-specific canonical URLs
- hreflang for Arabic/English where appropriate
- country/market landing pages
- localized titles/descriptions
- structured data using real local business/product information
- correct sitemap segmentation

Do not create thin duplicated pages for every country/category combination.

Only index markets with real public supply/content.

---

# 27. Migration strategy from Egypt-first data

Use additive, backward-compatible migrations.

Recommended sequence:

1. introduce market configuration
2. add nullable/explicit countryCode fields where the domain requires them
3. add canonical currency handling
4. backfill only facts BuildHub can legitimately know
5. prompt/require users to complete missing geography where needed
6. introduce normalized service areas
7. decouple quotation currency from billing currency
8. introduce market offer model for products when needed
9. switch matching/search to normalized geography
10. retire obsolete free-text-only logic after proof

Do not infer country from a business name or phone number.

Historical Egypt-launch records may be backfilled to EG only where owner/business context confirms that is truthful.

---

# 28. Multi-market test matrix

Before a GCC market is enabled, run a market test matrix.

At minimum cover:

- EG / EGP
- one 2-decimal GCC currency
- one 3-decimal GCC currency
- Arabic
- English
- buyer in market A sourcing provider in market A
- provider based in A serving B
- provider not serving project market
- RFQ currency
- quotation currency
- product availability
- tax config
- compliance requirements
- phone/address formatting
- timezone/deadline
- search/filters
- Featured/Sponsored market targeting
- Admin market filtering
- no cross-market authorization leak

Expand across SA/AE/QA/KW/BH/OM before public enablement.

---

# 29. Launch strategy

Architect for all target GCC markets now.

Operationally launch **one new market at a time**.

Do not simultaneously enable every GCC country simply because the schema supports them.

For each launch:

1. market configuration
2. legal/tax/compliance review
3. supply acquisition
4. marketplace content quality
5. local category/service coverage
6. staging market acceptance
7. controlled beta
8. production enablement
9. monitor real demand/supply metrics
10. expand

Shared code, market-specific configuration.

---

# 30. Current-release preparation vs future rollout

## CURRENT RELEASE — prepare now

- stop adding EGP/Egypt hard-codes
- introduce canonical market configuration
- define canonical money/currency formatter
- separate sourcing currency from billing currency
- add explicit project/RFQ market/country architecture
- prepare structured provider service areas
- make new analytics/campaigns market-aware
- keep compliance architecture country-aware
- create regression tests that reject new hard-coded Egypt currency assumptions outside approved compatibility code
- document additive migration path

Do not destabilize the current release with a giant destructive rewrite.

## NEXT REGIONAL-READINESS MILESTONE

- normalized geography migrations
- product market offers
- compliance profiles per country
- market-scoped discovery
- multi-currency commercial flows
- market-scoped Admin/analytics
- market-specific legal/policy acceptance

## BEFORE EACH GCC GO-LIVE

- current law/tax/privacy/compliance verification
- local supply readiness
- payments if enabled
- market-specific staging acceptance
- performance/availability review
- owner launch authorization

---

# 31. Acceptance principle

A future GCC launch should be mostly:

CONFIGURE
→ LOAD LOCAL SUPPLY
→ VERIFY POLICY/COMPLIANCE
→ TEST
→ ENABLE

not:

FORK CODE
→ REWRITE MONEY
→ REWRITE ADDRESS
→ REWRITE COMPLIANCE
→ REWRITE SEARCH
→ REWRITE ADMIN.

If expansion requires a country-specific code fork, this architecture has failed.


---

# 32. OWNER POLICY — HOW BUILDHUB KNOWS THE MARKET

This section resolves the owner question about Egypt vs GCC identity, login, RFQs,
quotations and subscriptions.

## The governing rule

**Do not use IP/geolocation as business truth.**

IP/browser location may be used only to SUGGEST an initial market to a signed-out
visitor.

It must never silently determine:

- legal/business country
- project country
- RFQ market
- quotation currency
- tax treatment
- compliance eligibility
- provider serviceability
- subscription billing country

The authoritative market comes from explicit business records.

---

# 33. ONE GLOBAL LOGIN, NOT ONE LOGIN PER COUNTRY

A BuildHub user should have **one account**.

Do not create:

- Egypt account
- Saudi account
- UAE account

for the same person.

After login, BuildHub resolves an **active market context** for navigation and
discovery.

Resolution order:

1. market attached to the object being worked on (project/RFQ/etc.)
2. user's last explicitly selected active market, if still enabled
3. user's explicit default market
4. if exactly one market is available, use it
5. otherwise show a market chooser

IP location may preselect the chooser on first visit but never silently commit
the selection.

The header/workspace should eventually expose a market switcher for users who
operate across more than one enabled market.

Changing active market changes DISCOVERY CONTEXT.

It does not rewrite existing projects/RFQs/quotations.

---

# 34. ACCOUNT COUNTRY VS MARKET CONTEXT

Keep these facts separate.

## User home/default country

A profile/preference.

Useful for UX defaults.

Not authoritative for commercial transactions.

## Business legal country

Where a supplier/professional business is registered.

Authoritative for that business identity and compliance profile.

## Served markets

Where a provider is willing and approved to work/deliver.

Authoritative for marketplace/RFQ serviceability.

## Active browsing market

What marketplace the user is currently browsing.

A session/user preference.

## Project country

Where the actual construction project is located.

Authoritative for project workflows.

## RFQ country/market

Where the requirement must be delivered/performed.

Authoritative for supplier matching and quotation context.

A user may therefore:

live in Egypt,
run a UAE-registered company,
browse Saudi Arabia,
and quote a Bahrain project

without those facts being confused.

---

# 35. SIGNUP / ONBOARDING COUNTRY QUESTIONS

Do not ask one ambiguous field called "Country" and reuse it everywhere.

## Buyer / homeowner

Ask/default:

- default browsing market

When creating a project, require:

- project country
- region/admin area
- city/location as appropriate

## Supplier / professional

Ask:

- legal/business registration country
- primary business location
- markets served

Compliance requirements are derived from legal/operating market, not IP.

Users can later add served markets subject to applicable compliance/approval.

---

# 36. PROJECT MARKET — SOURCE OF TRUTH

Project creation must explicitly establish:

- countryCode
- normalized geography
- timezone
- project/sourcing currency default

The form may default these from active market but must make the country visible
and changeable before save.

Once commercial records exist, changing project market/currency must be tightly
controlled and must never silently reinterpret historical RFQs/quotations.

---

# 37. STANDALONE RFQ MARKET — EXPLICIT

If an RFQ belongs to a project:

RFQ market defaults/inherits from the project.

If an RFQ is standalone:

the requester must explicitly answer a question equivalent to:

**Where must this requirement be supplied/performed?**

Select:

- country/market
- region/city where useful

The RFQ stores a market snapshot.

Do not derive RFQ country from:

- requester nationality
- requester IP
- supplier country
- current UI language

---

# 38. RFQ CURRENCY — EXPLICIT COMMERCIAL SOURCE OF TRUTH

Every RFQ must have an explicit commercial currency.

Resolution:

1. default from the RFQ/project market configuration
2. show it clearly to requester
3. requester confirms it before publishing
4. persist it on the RFQ

For the first regional architecture, prefer **one currency per RFQ**.

This makes quotation comparison exact and avoids hidden FX assumptions.

Later, BuildHub may support multi-currency RFQs only with an explicit conversion
policy and exchange-rate snapshot architecture.

Do not introduce that complexity prematurely.

---

# 39. HOW BUILDHUB KNOWS THE QUOTATION CURRENCY

A supplier should NOT choose quotation country/currency from scratch.

The quotation belongs to an RFQ.

Therefore:

**Quotation currency = RFQ currency**

by default and, for the initial multi-market architecture, by rule.

The quotation form should display something like:

Project market: Saudi Arabia
RFQ currency: SAR

and the currency field should be read-only.

Example:

Buyer in Egypt creates a project in Jeddah.

Project:
country = SA

RFQ:
market = SA
currency = SAR

An Egyptian supplier approved to serve Saudi Arabia responds.

Quotation:
currency = SAR

The supplier's own country and BuildHub subscription currency do NOT change the
quotation currency.

This is the correct commercial model.

---

# 40. RFQ DISTRIBUTION / WHO RECEIVES IT

Supplier eligibility for an RFQ is determined server-side from the RFQ context.

Applicable signals:

- RFQ market/country
- provider served markets/service areas
- provider category/capability
- compliance/verification required for that market
- invitation
- project relationship
- entitlement/allowance
- RFQ visibility rules

A supplier does not need to be logged into the same market at the moment the RFQ
is created in order to receive a legitimate notification/opportunity.

Example:

Supplier operates in EG and SA.

Active UI market today:
EG

A new eligible Saudi RFQ arrives.

BuildHub may still:

- create the opportunity
- send the notification
- show market badge SA
- surface it in the supplier Opportunity Centre

The active market selector is a browsing context, not an authorization wall.

Opportunity Centre should be filterable/groupable by market.

---

# 41. CROSS-BORDER SUPPLIER MODEL

A provider has:

- legalCountryCode
- approved/served markets
- normalized service areas

Example:

Legal country: EG
Served markets: EG, SA
Saudi service areas: Riyadh, Jeddah

That supplier can be eligible for a Saudi RFQ if:

- category matches
- geography/serviceability matches
- Saudi compliance requirements are satisfied
- other entitlement/security rules pass

No second account is needed.

---

# 42. PRODUCT MARKET OFFERS

Marketplace browsing follows active/project market.

A product core may be global to the supplier.

Market availability/pricing belongs to a market offer.

Example:

Product:
Smart Light Switch

EG offer:
EGP 1,500
serves Cairo/Alexandria

SA offer:
SAR 120
serves Riyadh/Jeddah

UAE:
not offered

A Saudi buyer should not see the Egyptian EGP offer as though it were locally
available.

Cross-border offers may be shown only when the supplier explicitly supports the
buyer's market and delivery/commercial policy.

---

# 43. SUBSCRIPTION — DO NOT COUPLE IT TO RFQ/QUOTATION

BuildHub subscription is a separate commercial relationship between BuildHub
and the provider.

It must never determine:

- project country
- RFQ country
- RFQ currency
- quotation currency

The current use of `BILLING_CURRENCY` in RFQ quotation flow is launch-era debt
and must be removed before regional enablement.

---

# 44. IDEAL SUBSCRIPTION ARCHITECTURE

Use three layers.

## A. Account / business

One provider identity.

## B. Subscription contract

Defines:

- plan
- billingMarket
- billingCurrency
- billing interval
- price/version
- tax/invoice context
- payment provider reference
- lifecycle

## C. Entitlement scope

Defines WHERE the subscription benefit applies.

An entitlement may be:

- GLOBAL
- REGION (future, e.g. GCC)
- MARKET_SET
- SINGLE_MARKET

This prevents the architecture from forcing a business decision too early.

Example:

A future PRO plan may be sold in Saudi Arabia in SAR but grant:

- core storefront features globally
- 20 qualified enquiries/month in SA
- Sponsored capability in SA only

Another future commercial policy could grant GCC-wide access without changing
the subscription engine.

---

# 45. OWNER-FRIENDLY DEFAULT SUBSCRIPTION POLICY

Recommended product experience:

**one BuildHub account and one Billing Center.**

Do not force the user to maintain separate logins or disconnected billing pages
per country.

At launch in each market:

- approved plan prices are explicit per billing market/currency
- the user sees exactly what market(s) the plan covers
- entitlements state their scope
- market-specific add-ons/promotions remain market-scoped

Do not dynamically FX-convert an Egyptian plan price into SAR/AED and call it a
Saudi price.

Each market price must be an approved catalogue price/version.

---

# 46. WHEN MULTIPLE SUBSCRIPTION CONTRACTS ARE ALLOWED

Architect to support more than one billing contract for the same business only
where legally/commercially necessary.

Examples:

- different BuildHub contracting entity
- separate tax invoice jurisdiction
- enterprise commercial agreement
- separate market-specific paid package

But do not REQUIRE one subscription per market by default.

That would create needless customer friction.

Prefer:

one business
→ one Billing Center
→ one or more explicit contracts only when necessary
→ scoped entitlements

---

# 47. QUOTA / ENQUIRY ALLOWANCE SCOPE

Usage counters must eventually include entitlement scope.

For example:

PRO entitlement:
20 qualified enquiries/month
scope = SA

Opening an EG opportunity must not consume SA quota.

If a future plan is GLOBAL:

the global allowance is shared according to that plan's terms.

Never infer scope from currency.

Never reset usage because a user switches active market.

---

# 48. REFERRALS / FEATURED / SPONSORED / MARKETING

All growth benefits should be able to carry market scope.

Referral reward example:

Temporary Featured
scope = SA
duration = 30 days

Sponsored campaign:

entity = product 123
market = AE
category = Lighting

Do not let a Saudi commercial grant silently promote the entity in every market.

---

# 49. MARKET CONTEXT IN THE UI

Users should always understand the market of a commercial object.

Use subtle, consistent context:

- market/country name or badge
- currency
- project location

Especially on:

- RFQ cards
- RFQ detail
- quotation form
- quotation comparison
- Opportunity Centre
- Lead Centre
- Product offer
- Marketing campaigns
- Billing/entitlements

Do not make the user guess whether a price is EGP, SAR or AED.

---

# 50. COUNTRY / MARKET CHANGE RULES

Changing active browsing market:
safe, preference only.

Changing provider served markets:
requires validation/compliance where applicable.

Changing project market:
restricted once downstream commercial records exist.

Changing RFQ market/currency after publication:
do not silently allow.

Preferred policy:

- before publish: editable
- after publish with no supplier engagement: controlled correction with audit
- after supplier engagement/quotation: immutable; cancel/reissue if necessary

Changing quotation currency:
not allowed independently of RFQ under the initial regional model.

---

# 51. SESSION / TOKEN DESIGN

Do not encode one permanent country into authentication identity as though it were
a security role.

Authentication answers:

**Who are you?**

Market context answers:

**Which market are you browsing/operating in?**

Project/RFQ answers:

**Where is this business requirement actually located?**

Keep those concerns separate.

A request may carry active market context, but server authorization must resolve
the authoritative market from the domain record when acting on an existing
project/RFQ/quotation.

---

# 52. GOLDEN REGIONAL EXAMPLE

A supplier:

Business registered:
Egypt

Serves:
Egypt + Saudi Arabia

BuildHub subscription:
billed in EGP under an Egypt billing contract

A homeowner:

Lives:
UAE

Creates project:
Jeddah, Saudi Arabia

Project:
market = SA

RFQ:
market = SA
currency = SAR

The Egyptian supplier is eligible because:

- serves SA
- serves Jeddah
- category matches
- Saudi compliance passes
- entitlement allows the opportunity

Supplier receives the opportunity even if their currently selected UI market is
Egypt.

Supplier submits quotation:

SAR 150,000

because the quotation inherits the RFQ currency.

Their BuildHub subscription is still billed in EGP.

No conflict exists because sourcing currency and platform billing currency are
different domains.

This is the intended architecture.


---

# 53. CORRECTION — MONEY SCALE AND UNKNOWN MARKET SAFETY

Two implementation details in the first regional-foundation pass must be corrected before GCC readiness can be considered strong.

## A. Currency fraction digits are currency metadata

The canonical money formatter must not globally cap currencies at two fractional digits.

Some supported GCC currencies use three fractional digits.

Therefore formatting and validation must derive the permitted fraction digits from ISO currency metadata or an explicit canonical currency table.

Requirements:

- EGP/SAR/AED/QAR may use their correct supported scale
- KWD/BHD/OMR must not be rounded to two digits merely because the UI formatter was written for Egypt
- database precision must support the maximum enabled currency scale before those markets are enabled
- arithmetic/comparison must never silently round a stored commercial value to the wrong currency scale

Do not hard-code `maximumFractionDigits: 2` as the platform-wide rule.

## B. Invalid explicit market codes must not become Egypt

Legacy records with no market may safely resolve through the documented Egypt launch backfill/default.

But an **explicit unknown/corrupt market code** must not silently resolve to EG.

Distinguish:

- null/undefined legacy market → documented launch default/backfill path
- valid known market → that market
- invalid explicit market code → reject / return null / surface data-integrity error as appropriate

Otherwise corrupted `ZZ` data can become an Egyptian RFQ, currency or compliance decision without anyone noticing.

Update tests accordingly.

These are release-safe correctness fixes and should be completed before regional readiness is called complete.

---

# 54. THE SETTLED MULTI-MARKET CONTRACT

Owner authorization: GCC enablement is an active objective. Egypt plus the six
registered GCC markets must be supportable, and the GCC markets enabled once
their technical, compliance, staging and owner-acceptance gates pass.

This section records the **architecture and its invariants**. It is not a
history of how the decisions were reached. Where it disagrees with an earlier
section or with a root-level report, this section is current.

Authorization is not activation. Every market in `shared/markets.ts` other than
Egypt remains `enabled: false` throughout Phases 0-3, and `enabled` is the only
thing that decides.

## A. Work location is the commercial authority

The chain, and nothing may short-circuit it:

```
where the work is required
  -> BuildHub market
  -> RFQ transaction currency
  -> quotation currency
```

A project states its country explicitly. A project-backed RFQ inherits that
market **server-side**. A standalone RFQ captures the work country explicitly.
The RFQ's currency is derived from its market on the server, and a quotation
inherits the RFQ's currency without choosing it.

Free-text address and city are **not** parsed to infer a market. A requirement's
location is a property of the job, not of the form it was typed into.

## B. What may never determine a commercial market

- IP address
- browser geolocation
- browser locale
- the active-market browsing preference
- the account's subscription billing currency
- the provider's legal country, physical location or nationality

Geolocation may **suggest** a market to a signed-out visitor. `suggestMarket` is
named for that and returns null rather than a fallback. A suggestion that
becomes a stored commercial fact without an explicit human choice is a defect.

## C. Cross-border commerce is intentional, not suspicious

A user registered in one country may request work in another enabled country,
and an eligible provider based in one country may serve another enabled market.

| requester | work location | market | currency |
|---|---|---|---|
| Egypt | Oman | OM | OMR |
| Oman | Saudi Arabia | SA | SAR |
| Saudi Arabia | UAE | AE | AED |

Where the account's country and the selected work country differ, the product
**confirms** — it states the work country, the currency consequence and the
account difference, and offers continue or change. It does not block, and it
does not frame a legitimate cross-border request as a risk signal.

## D. Provider identity has four separate parts

1. **legal / home country** — where the business is registered
2. **primary operating market** — where it mainly works
3. **additional served markets** — where else it is willing to work
4. **per-market status / approval** — whether BuildHub has approved it *there*

These are four facts, not one. Approval in Egypt does **not** imply approval in
Saudi Arabia, UAE, Qatar, Kuwait, Bahrain or Oman, and approval in a GCC market
does not imply approval in Egypt. A provider does not become discoverable in
every market because GCC is enabled globally.

## E. Service offers are per-market and independently priced

The same provider offering the same service in three markets has **three
offers**, each with its own entered price:

```
provider X + service Y + OM  ->  25.000 OMR / m2
provider X + service Y + SA  -> 260.00  SAR / m2
provider X + service Y + AE  -> 250.00  AED / m2
```

Changing one must not mutate another. Uniqueness is enforced on service plus
market under canonical provider/service ownership.

**No FX-derived authoritative pricing.** BuildHub does not convert an approved
price in one market and present the result as another market's price. A
converted figure is an estimate wearing a commercial offer's clothes.

## F. Legacy EGP rows are classified by evidence

A historical EGP service price does not prove an Egypt market offer. Rows are
classified, not assumed:

- `PROVEN_EG` — evidence establishes the denomination and the market
- `REMEDIATION_REQUIRED` — it does not

For remediation-required rows: preserve the historical value, do not relabel the
currency, do not FX-convert, do not publish into a new market. The provider
confirms or re-enters before that market offer becomes commercially active.

## G. Money carries its denomination explicitly

Every stored monetary figure must be denominated by something on or above its
own row. A number whose currency a reader has to infer from a neighbouring
table is undenominated, whatever the neighbour happens to say today.

`rfqItems.unitPriceSnapshotCurrency` is the worked example: the RFQ's currency
is the authority, a product that agrees contributes its price and that currency,
and a product that disagrees contributes **no snapshot at all** — not a
converted one and not a relabelled one.

## H. Currency precision comes from the registry

`CURRENCY_FRACTION_DIGITS` is the single authority. KWD, BHD and OMR have
**three** minor digits; EGP, SAR, AED and QAR have two.

- storage precision and display precision are different concerns
- an unknown currency has **no** scale rather than a defaulted two
- raising scale without raising precision silently costs integer headroom
- rate, percentage, rating and quantity columns are not money and are not widened

Migration 0063 widened the eight market-denominated money columns.
`server/moneyScale.test.ts` re-derives the census each run, so a new scale-2
money column fails the build rather than waiting to be noticed.

## I. Tax stays explicit

There is no `market.defaultVatRate`. A market does not imply a tax rate. An
unstated VAT rate is **NULL, not zero** — carried on the rate, which is echoed
as nullable precisely so a reader can tell "0% VAT" from "VAT not stated". A
dedicated tax architecture remains a separate, unauthorized workstream.

## J. The implicit-market resolver is the pacing mechanism

`DEFAULT_MARKET` is a **backfill value**: it records what a row written before
markets existed meant. It is not the market of a new commercial record.

New commercial writes that state no market of their own go through
`resolveImplicitMarket()`:

| enabled markets | behaviour |
|---|---|
| exactly one | resolve it |
| zero | refuse |
| more than one | **refuse** |

The third row is the point. Enabling a second market does not quietly change
what those paths write — it makes them throw until each has been given explicit
market authority. Activation cannot outrun the work.

This rule must not be weakened to make a flag turn green. Mutation coverage
proves an Egypt/default fallback cannot silently return.

## K. Compliance extends the canonical architecture

`COMPLIANCE_REQUIREMENTS_BY_MARKET` keyed by market and role is the only
mechanism. There are not six GCC compliance engines, and ordinary requirement
differences are expressed as **configuration, never as `if Oman` / `if Saudi`**.

A market with no confirmed requirement set returns **empty**, never Egypt's. An
empty list is a visible gap that stops an onboarding; a wrong list sends a
professional to the wrong ministry. `getComplianceRequirements` takes a required
market: there is no default to fall through.

**Jurisdictional requirements are verified data, not model output.** BuildHub
does not populate them from assumption. A market whose requirements are
unconfirmed is `ACTIVATION BLOCKED — COMPLIANCE CONFIGURATION INCOMPLETE`, which
blocks that market's activation and does **not** block building the
architecture.

## L. Market interest is informational only

A provider expressing interest in a disabled market does not become approved
there, discoverable there, eligible for matching there, able to publish a
commercial offer there, or able to quote work there. Interest never weakens the
enabled-market guard.

## M. Project market is a dedicated lifecycle operation

Never part of a generic project update — changing a project's market changes the
jurisdiction, currency and compliance basis of everything hanging off it.

| state | behaviour |
|---|---|
| no RFQ | controlled change permitted, with audit |
| draft / unpublished RFQ | dedicated controlled change with correct cascade and user notice |
| published RFQ | refuse — canonical close/recreate path |
| quotation exists | hard refusal |
| award / contract exists | hard refusal |

## N. One canonical eligibility predicate

Discovery and matching converge on one mechanism:

```
market enabled
  AND provider approved for that market
  AND the applicable service offered in that market
  AND existing visibility / category / project / business rules satisfied
```

Country-specific conditionals scattered through routers and components are the
failure mode this replaces. The market registry and this predicate are the
authority.

## O. Activation gates, and owner website acceptance

Per-market, reported factually and without ranking:

- schema / precision ready
- work-location flow ready
- provider eligibility ready
- market-specific service offers ready
- compliance configuration verified or missing
- automated regression pass / fail
- deployed staging pass / blocked
- owner website acceptance pass / pending / fail

Currency decimal scale is **one** gate, not the gate. SAR, AED and QAR having
two minor digits does not make Saudi Arabia, UAE or Qatar activation-ready; they
need the same multi-market architecture as the rest.

Release discipline for every user-facing candidate:

```
implementation -> code gate -> exact SHA -> staging deploy
  -> /version verified -> deployed matrix -> OWNER WEBSITE ACCEPTANCE
  -> explicit production activation -> production verification
```

**Owner website acceptance is never inferred from automated evidence**, and
production activation is never inferred from a merge to `main`. A market is not
launched because it appears in a dropdown.

---

# 55. FOUR WORDS THAT ARE NOT SYNONYMS

Every confusion in this workstream has been one of these four being read as
another. They are listed first because the rest of this section is unreadable
without them.

| | what it means | where it lives | what it does NOT imply |
|---|---|---|---|
| **market REGISTERED** | BuildHub's code knows this market exists and has its currency, timezone and names | a row in `MARKETS` | nothing commercial whatsoever |
| **market ENABLED** | BuildHub operates here today | `enabled: true` on that row | that any provider is approved here |
| **provider APPROVED** | BuildHub has assessed this business for THIS market | a `providerMarkets` row at `approved` | that they offer any particular service here |
| **service OFFERED** | this service has a live, independently priced offer in this market | a `serviceOfferingMarkets` row at `active` | that the market is enabled |

A database row is not an enabled market. All six GCC markets are registered,
none is enabled, and rows may legitimately exist for them during development
without making them discoverable, matchable or quotable. `enabled` is the only
thing that decides, and `marketEligibility` checks it **first and
independently** so no combination of rows can substitute for it.

# 56. TWO CURRENCY DOMAINS THAT MUST NEVER MERGE

**Commercial transaction currency** is what a buyer and a provider transact in.
It is derived from where the work is:

```
work location -> market -> RFQ currency -> quotation currency
```

Server-derived at every step. A provider cannot select it; a client cannot send
it; a conflicting client value is refused rather than overridden.

**BuildHub subscription / billing currency** is what a provider pays BuildHub.
It is `BILLING_CURRENCY` — **EGP only**, with no payment provider connected.

The two are independent in both directions, and this is enforced rather than
documented:

- a quotation's currency does not follow the provider's subscription. This was
  the owner's original finding: quotation currency was taken from the supplier's
  billing plan.
- billing does not follow provider market, project market, RFQ currency or
  service-offer currency.
- `vendorSubscriptions.priceAmount` stays `DECIMAL(10,2)` while billing is
  two-digit, guarded by a test that fails if `SUPPORTED_CURRENCIES` ever gains a
  three-digit currency.
- the billing limitation does **not** block multi-market commerce. Oman work is
  denominated in OMR while billing remains EGP, because they are different
  questions.

Do not invent multi-currency subscription billing inside this workstream.

# 57. PHASE 2 — MARKET-SPECIFIC SERVICE OFFERS (LANDED)

`serviceOfferings` is the **service**: what a provider does, in which category.
`serviceOfferingMarkets` is the **offer**: what they charge for it in one
market. One row per `(serviceOfferingId, marketCode)`, enforced by a unique
constraint — a second row would mean two live prices for the same work in the
same place with nothing to say which a buyer is quoted.

Offers are independent by construction. Changing the Saudi price cannot touch
the Omani one because they are different rows.

**There is no currency column on the offer.** The currency is derived from the
market at the point of use. A stored currency beside a stored market is a pair
that can disagree, and `marketCode = 'OM', currency = 'EGP'` is the row this
workstream exists to prevent; validating at the write closes that only for paths
that use the validator. With no column the state is not representable, and the
client cannot send a currency because it is not an input field.

No FX anywhere. BuildHub does not convert an approved price in one market and
present the result as another market's price.

## Legacy classification

`currency = 'EGP'` is **necessary and never sufficient**. Migration 0061
defaulted that column reasoning that every offering "was created by a provider
in the one market BuildHub operates, priced in Egyptian pounds". That blanket
claim is false and a real external user disproved it: a vendor operating in Oman
whose listing showed EGP because the platform had nothing else to write. The
column records what nobody contradicted, not what anybody chose.

`PROVEN_EG` requires all four:

1. the stored currency is EGP
2. an **approved** legacy Egyptian registration instrument — tax card,
   commercial registration or tax registration, with `marketCode IS NULL`,
   because the column did not exist and Egypt is the only requirement set ever
   configured
3. an approved Egypt row in `providerMarkets`
4. a free-text country that does not contradict Egypt

The country field **disqualifies and never asserts**. Every condition can only
shrink the proven set, which is what makes being wrong survivable: a false
negative asks a provider to confirm their own price; a false positive publishes
a number in a currency they never chose.

`REMEDIATION_REQUIRED` is everything else, and is the column **default**. Such a
row keeps its value and original denomination, is never relabelled, converted or
published into any market, and waits for the provider to confirm or re-enter it.

## Cutover

The per-market row is the authoritative source for market-specific service
commerce. Legacy `priceMin` / `priceMax` / `currency` remain physically for one
bounded rollback release and are **READ-NEVER / WRITE-NEVER** in authoritative
flows, guarded by tests on both the read and write paths. Two live pricing
systems would leave no answer to which price a buyer is quoted.

# 58. PHASE 3 — WORK-LOCATION AUTHORITY (LANDED)

## The chain

A project states its country explicitly. A project-backed RFQ inherits it
**server-side**. A standalone RFQ captures it explicitly. The RFQ's currency is
derived from its market; a quotation inherits the RFQ's currency and the provider
cannot select one.

**A conflict refuses.** If a client sends a market alongside a `projectId` and
the two disagree, the request is rejected rather than resolved. Silently
discarding the submitted value is the right outcome by the wrong route: a client
that believes it is filing an Omani RFQ against a Cairo project would get a Cairo
RFQ with no indication anything was overridden, and the figures a supplier later
quotes would be in a currency the requester never saw chosen.

A project whose market is no longer enabled also refuses, rather than falling
through to the implicit market.

## What may never determine it

IP, browser geolocation, browser locale, the active-market browsing preference,
free-text city or address, the requester's account country, the provider's
country, the subscription currency. None is an input to any market decision —
guaranteed by absence from the function signatures rather than by documentation.

## Low-friction compatibility, bounded

While exactly one market is enabled, the work-location field renders nothing: a
selector with one option is a dead choice. The server resolves the single market
through `resolveImplicitMarket()`, which **refuses** once more than one is
enabled — so the quiet path cannot outlive the condition that justifies it. The
field appears the day there is something to choose.

## Cross-border is confirmed, not warned

An Egyptian developer building in Oman is a customer, not an anomaly. Where the
account country and work country differ, the product states the work location,
the resulting quotation currency and the account difference, and offers continue
or change. No warning colour, no alert role, no "are you sure".

## One eligibility predicate

```
market ENABLED
  AND provider APPROVED for that market
  AND an ACTIVE offer for the service in that market   (service-level questions)
  AND the existing category / visibility / project / business rules pass
```

`marketEligibility` is the only place this is answered. Four conditions
assembled in five routers is how one of them goes missing in one of them, and
the one that goes missing is the one nobody tests. Market interest, legal
country, IP and billing are not parameters, so no caller can pass one in place
of an approval.

## Project market change

A dedicated operation, never a field on `projects.update` — behind the same
mutation that edits a title, a client POSTing a project object back could move a
live commercial relationship between countries as a side effect of a rename.

| state | behaviour |
|---|---|
| no RFQ | allowed, with a required reason and an audit event |
| draft / unpublished RFQ | dedicated cascade (unreachable today: `rfqs.status` has no draft state) |
| published RFQ (`open`/`closed`/`awarded`) | refuse — close and recreate |
| any quotation exists | hard refuse |
| accepted quotation / award | hard refuse |

Blockers are evaluated strongest-first, so the reason a user is given is the most
specific true one: a project with an award also has quotations and a published
RFQ. A no-op is refused, so no audit records a jurisdiction change that did not
happen. The currency follows the market, or jurisdiction and money disagree.

# 59. WHAT IS STILL MISSING BEFORE ANY MARKET IS ENABLED

Engineering is not the remaining gate. These are:

- **verified compliance configuration** per market and role.
  `COMPLIANCE_REQUIREMENTS_BY_MARKET` has Egypt populated and the six GCC
  markets empty, and returns **empty** rather than Egypt's for an unconfigured
  market — an empty list stops an onboarding, a wrong list sends a professional
  to the wrong ministry. These are verified data, never model output. Every GCC
  market is `ACTIVATION BLOCKED — COMPLIANCE CONFIGURATION INCOMPLETE`.
- **deployed staging verification** of the exact candidate SHA.
- **owner website acceptance** of the market behaviour, in EN and AR.
- **explicit owner authorization** of the activation change itself, presented
  before it is made.

Currency decimal scale is one gate, not the gate. SAR, AED and QAR having two
minor digits does not make Saudi Arabia, UAE or Qatar activation-ready.
