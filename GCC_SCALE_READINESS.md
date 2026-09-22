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
