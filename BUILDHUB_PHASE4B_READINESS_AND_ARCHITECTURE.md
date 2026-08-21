# BuildHub — Phase 4B Readiness & Architecture

Branch: `claude/phase4b-readiness-architecture`, created from `claude/phase4a-final-gate` @ `2cd8af3e5c89aa309e17e813f1bca59f0ffc1c20`. This is a discovery and design document. **No implementation was performed.** No Stripe/Paymob/Fawry objects were created, no credentials configured, no schema migrated, no code written beyond this file.

---

## 0. How to read this report

Sections 1–4 are **READ**: what actually exists today, verified against source, not assumed. Section 5 is **MAP**: the full requirements matrix. Section 6 is **PROVIDER VERIFICATION**: the Egypt payment-provider comparison. Section 7 is **ARCHITECTURE**: the proposed design. Section 8 is the **READINESS GATE** verdict, per the task's own required outline (items 1–12).

---

## 1. What already exists (READ)

Verified by direct source inspection of the current repository, not inferred from business requirements.

### 1.1 No billing/payment code exists anywhere
A repository-wide search for `stripe|billing|subscription|payment|paymob|fawry` turned up zero real hits outside: quotation "payment terms" (an unrelated project-management field), two unused `DEFAULT_ADMIN_SETTINGS` placeholder strings (`transactionFeePercent`, `commissionPercent` — dead config, never read anywhere), and generic "Billing"/"Subscription" labels in `ComponentShowcase.tsx` (a UI-kit demo/storybook page with no real logic). **Phase 4B's billing domain is a greenfield build.**

### 1.2 Schema (`drizzle/schema.ts`) — 21 tables, none billing-related
`users, revokedSessions, userAccountAuditEvents, projects, milestones, tasks, documents, registrationDocuments, registrationDocumentSubmissions, registrationReviewEvents, productQuestions, products, rfqs, quotations, messages, notifications, reviews, progressReports, disputes, adminSettings, dailyLogs, expenses`. No `subscriptions`, `plans`, `entitlements`, or `payments` table exists.

`adminSettings` is a generic key/value store (`settingKey`, `value`, `updatedBy`, `updatedAt`) already used for platform-wide toggles (maintenance mode, registration enabled, etc.). It is suitable for **global** billing configuration (e.g., a feature flag), but not for per-vendor subscription state, which needs its own relational table.

### 1.3 Vendor/RFQ/reputation/analytics — code-complete, per Phase 4A
- **Vendor identity**: `users.userRole` (`homeowner | contractor | engineer | architect | supplier | project_manager`), `providerRoles` constant, `approvedProviderProcedure` middleware (role + `onboardingStatus === 'approved'` gate).
- **Profile**: `profileRouter` — `getPublic`/`getOwn`/`update`/`uploadAvatar`, explicit `PUBLIC_PROFILE_COLUMNS` allowlist (`id, name, bio, avatar, location, userRole, verified, createdAt`). **No portfolio field or table of any kind.**
- **Reputation**: `reviews` table, `reviewsRouter.statsForUser`/`forUser` — live `AVG`/`COUNT`, `verified = true` filter, the single approved definition since Phase 4A.6.2 (reconfirmed correct across every surface as of Phase 4A.6.9).
- **RFQ/leads**: `rfqs` (broadcast — any homeowner posts, publicly listed via `rfq.list`), `quotations` (`providerId` FK, `submitQuotation` gated by `approvedProviderProcedure` only — **no category/role matching between an RFQ and eligible providers**; any approved provider of any role can quote on any open RFQ).
- **Analytics**: `analyticsRouter.myStats` — self-scoped submitted/accepted/win-rate/avg-response-time, one aggregate query.
- **Admin**: `adminRouter` — user management, compliance queue, disputes, settings; strict allowlist discipline (`ADMIN_USER_LIST_COLUMNS`, `COMPLIANCE_APPLICANT_COLUMNS`) established across 4A.6.7 and the cumulative audit.

### 1.4 Vendor directory / marketplace visibility — **currently a static mock, not real data**
`client/src/pages/VendorsDirectory.tsx` (routes `/marketplace/vendors`, `/marketplace/vendors/:id`) imports `VENDORS` from `client/src/lib/marketplaceData.ts` — a 208-line **hand-authored, hard-coded array** of fictional vendors ("OfficeWorks Egypt", etc.), not a tRPC query against the real `users` table. The only real, database-backed vendor-facing page is `/vendor/:id` (`VendorProfile.tsx`, single-vendor view via `profile.getPublic`). **There is currently no real "browse/search/filter all vendors" feature at all.** This was not previously flagged in any Phase 4A report because it was out of that phase's scope (profile/reputation/analytics, not directory/discovery) — it becomes directly relevant now because featured placement and visibility tiers are meaningless without a real directory to rank vendors within. See §5 and §7.5.

### 1.5 No team/organization/multi-location model
No `team`, `organization`, or `branch(es)` concept exists anywhere in the schema. One `users` row = one person = one account. "Multiple team members" / "Multiple branches/locations" (Premium) would require new relational modeling, not configuration.

### 1.6 Notifications — in-app only, no email/SMS
`server/notifications.ts`'s own header comment confirms: `notifyUser`/`notifyUsers` write only to the in-app `notifications` table today; email/SMS/push are explicitly deferred, "once BUILDHUB_EMAIL_*/BUILDHUB_SMS_* credentials exist." **No outbound email exists.** This directly affects trial-ending, payment-failure, and renewal-reminder notifications — they can only be delivered in-app for now, unless Phase 4C's email infrastructure lands first or in parallel.

### 1.7 Scheduled/background jobs — a real primitive already exists
`server/_core/heartbeat.ts` provides `createHeartbeatJob`/`updateHeartbeatJob`/`deleteHeartbeatJob`/`listHeartbeatJobs`, calling a cron-scheduled callback to an `/api/scheduled/*` endpoint. This is directly reusable for billing background work (trial-expiration sweeps, grace-period downgrades) — **no new job infrastructure needs to be invented.**

### 1.8 Environment/secrets
`server/_core/env.ts`'s `ENV` object currently has no payment-related keys (`appId, cookieSecret, databaseUrl, oAuthServerUrl, ownerOpenId, isProduction, forgeApiUrl, forgeApiKey`). No `STRIPE_*`/`PAYMOB_*`/`FAWRY_*` variables exist anywhere in the codebase or `.env` handling.

### 1.9 Generic analytics/event infrastructure
No generic event-log/funnel-tracking table exists. Business metrics today are computed as ad-hoc SQL aggregates per feature (`analytics.myStats`, `admin.analyticsSummary`) directly from timestamped rows (`users.createdAt`, `quotations.createdAt`, etc.), not from a stored event stream. A `client/index.html` Umami web-analytics script tag exists but is unconfigured (`%VITE_ANALYTICS_ENDPOINT%`/`%VITE_ANALYTICS_WEBSITE_ID%` placeholders, confirmed unset in this sandbox's dev-server logs) — it is not a functioning system today.

---

## 2. What needs configuration (no new code)

- Global billing feature flags (e.g., "billing enabled") via the existing `adminSettings` key/value mechanism.
- Provider API keys/webhook secrets once a provider is approved (§6) — environment variables only, never committed.

## 3. What needs implementation (new code, existing data model largely sufficient)

- Billing domain logic (plans, subscription lifecycle, entitlement checks) — see §7.
- Vendor billing UI, admin billing visibility.
- Enquiry-allowance enforcement on `submitQuotation` (see §5, Requirement 7.1).

## 4. What requires new schema

- A `vendorSubscriptions` (or equivalent) table — see §7.1.
- A `founderOfferEnrollments`/eligibility-tracking mechanism — see §5, Requirement 5.
- A monthly usage-counter table for enquiry allowance — see §5, Requirement 7.1.
- **Prerequisite, not itself Phase 4B**: a real, database-backed vendor directory/search endpoint to replace the static mock (§1.4) — featured placement and visibility tiers have nothing to attach to until this exists.

---

## 5. Requirements matrix (MAP)

| # | Requirement | Current state | Evidence | Status | Technical work | Dependency | Risk |
|---|---|---|---|---|---|---|---|
| 1 | FREE tier — permanent, no payment | No plan concept exists; every account is implicitly unrestricted today | `users` table has no plan/tier field | NOT CURRENTLY SUPPORTED | New `plan` field/derived state + entitlement default | 7.1 (schema) | Low |
| 2 | PROFESSIONAL/PREMIUM pricing (EGP 499/4,990, 999/9,990) | No pricing config exists | — | NEW DATA/MODEL REQUIRED | Central `plans` config (§7.3), not hard-coded in UI/routers | Provider (§6) | Low — values are approved, just need one source of truth |
| 3 | Annual pricing presented as discounted annual option | No pricing UI exists | — | IMPLEMENTATION REQUIRED | Plan config carries both intervals; UI copy computes/display the discount | 7.3 | Low |
| 4 | Founder offer (299/699 for 6 months, configurable, time-limited, centrally represented) | Nothing exists | — | BUSINESS CLARIFICATION REQUIRED + NEW DATA/MODEL | See detailed gap analysis below | 7.1, 7.3 | Medium |
| 5 | 30-day trial for paid tiers, FREE permanent | No trial concept exists | — | NEW DATA/MODEL REQUIRED | `trialEndsAt` on subscription row; provider-specific trial config (§6) | Provider | Low |
| 6 | Never delete vendor data on downgrade/trial-expiry/cancellation/failed payment | Already true by default — no code path anywhere deletes `users`/`reviews`/`products`/`rfqs`/`quotations` rows on any account-status change (confirmed: only `admin.deleteDummyUser` ever deletes a user row, and only for `isDummy` test accounts) | `server/routers.ts` — no `db.delete(...)` call tied to plan/trial/payment state anywhere | ALREADY IMPLEMENTED (as an absence of destructive code) | None — must remain true; add a regression test asserting no billing code path calls `db.delete` on business tables | — | Low, but must be explicitly tested (§8) |
| 7.1 | Qualified-enquiry allowance (5/30/unlimited per month) — **CRITICAL, see below** | RFQs are broadcast; any approved provider of any role may submit a quotation on any open RFQ; no per-vendor lead-matching/routing exists | `rfqRouter.submitQuotation` — `approvedProviderProcedure` only, no category/role match against the RFQ | BUSINESS CLARIFICATION REQUIRED | See detailed gap analysis below | 7.1 schema (usage counter) | Medium-High |
| 7.2 | Basic marketplace visibility (FREE) / higher search visibility (Pro) / highest eligible visibility (Premium) | No real, database-backed vendor directory exists at all (§1.4) | `VendorsDirectory.tsx` renders static mock data | NOT CURRENTLY SUPPORTED | Build a real directory/search endpoint first (prerequisite, not itself a plan feature); then a visibility-tier sort/boost on top of it | Prerequisite feature, outside Phase 4B's stated scope but blocking it | High |
| 8 | Basic reviews (FREE) vs. no differentiation implied for Pro/Premium | Reviews already dynamic, public, uniform for all vendors regardless of plan | `reviewsRouter` | ALREADY IMPLEMENTED | None — reviews must not be gated by plan (§10 explicitly forbids linking paid placement to reviews/trust) | — | Low |
| 9 | Ability to apply for verification (FREE) | Compliance/onboarding pipeline already exists | `registrationRouter`, `admin.reviewComplianceDocument` | ALREADY IMPLEMENTED | None | — | Low |
| 10 | Basic portfolio (FREE) / full portfolio (Pro) / expanded portfolio+media (Premium) | No portfolio feature exists in any form — not even an unlimited/ungated version | Confirmed by grep: zero matches for "portfolio" anywhere in schema or routers | NOT CURRENTLY SUPPORTED | New feature end-to-end: table, storage-backed media, CRUD endpoints, UI — this is a real feature build, not a tier gate on an existing one | New feature, outside strict billing scope | Medium — must not be silently promised |
| 11 | Basic vs. expanded service/product categories | `userRole` is a single enum category; `products` table exists but is `supplierId`-scoped only (marketplace catalog for suppliers, not a general vendor-category tagging system) | `drizzle/schema.ts` | PARTIALLY IMPLEMENTED / NEW DATA MODEL if multi-category tagging beyond one role is intended | Needs business clarification: does "category" mean the existing single `userRole`, or a new multi-tag capability? | — | Medium |
| 12 | Lead management, quote management (Professional) | `rfq.myList`, `rfq.myQuotations`, `QuotationComparison` already exist and are role-appropriate | `rfqRouter` | ALREADY IMPLEMENTED | None — these are not currently plan-gated; decide whether they should become Professional-exclusive or remain universal | Business clarification | Low |
| 13 | Advanced profile analytics / performance statistics / vendor performance insights | `analytics.myStats` exists (submitted/accepted/win-rate/response-time) — this is the entire current analytics surface, already available to every approved provider regardless of plan today | `analyticsRouter` | ALREADY IMPLEMENTED (basic) / IMPLEMENTATION REQUIRED (to plan-gate it, and to build anything "advanced" beyond the 4 existing metrics) | Gate `analytics.myStats` behind entitlement; define what "advanced" adds beyond the 4 existing metrics | Business clarification on what "advanced" means | Medium |
| 14 | Promotional offers, category positioning, premium profile treatment | None of this exists | — | NOT CURRENTLY SUPPORTED | New feature work, largely dependent on the directory prerequisite (Requirement 7.2) | 7.2 | Medium |
| 15 | Multiple branches/locations, multiple team members (Premium) | No data model at all (§1.5) | — | NOT CURRENTLY SUPPORTED — largest gap in the plan | A real multi-user-per-account or organization model — this is a significant feature, not a tier flag | New architecture, likely a later phase | High — must not be promised as "coming in 4B" without a scoping decision |
| 16 | Priority support (Premium) | No support-ticketing system exists | — | NOT CURRENTLY SUPPORTED | Likely an operational/staffing commitment, not engineering | Business/ops | Low (not a code dependency) |
| 17 | Featured placement (separate monetization capability, §10 of the business spec) | No placement/ranking system exists at all — depends entirely on Requirement 7.2's prerequisite | — | NOT CURRENTLY SUPPORTED | New `featuredPlacements` table/flag, applied on top of the (not-yet-built) real directory | 7.2 (blocking) | High |
| 18 | Refunds (7-day window, abuse controls, billing-error handling) | No refund mechanism exists | — | PROVIDER DEPENDENCY | Provider refund API (§6) + admin authorization flow | Provider, legal review (§11 of business spec) | Medium |
| 19 | Cancellation (access continues to period end, downgrade at end) | No subscription state exists to cancel | — | NEW DATA/MODEL REQUIRED | Subscription-row `cancelAtPeriodEnd` flag + webhook-driven downgrade job | 7.1, 7.7 | Low |
| 20 | Failed payment / grace period / downgrade | No payment-state tracking exists | — | NEW DATA/MODEL + BUSINESS CLARIFICATION (grace-period length not yet approved) | Subscription `status` state machine + heartbeat job | 7.1, 7.7, owner decision on grace length | Medium |
| 21 | Admin visibility into plan/subscription/billing status | `admin.users`/`admin.complianceQueue` allowlist pattern already established and reusable | `ADMIN_USER_LIST_COLUMNS` | CONFIGURATION-ADJACENT (pattern exists, needs new columns from the new table) | Extend the allowlist pattern to the new subscription table — never expose provider secrets/raw tokens | 7.1 | Low — pattern is proven |
| 22 | Billing analytics funnel (registration → ... → renewal → cancellation) | No generic event log exists (§1.9) | — | IMPLEMENTATION REQUIRED, design decision below | Derive from existing timestamped tables via query-time aggregation (recommended, matches "don't build a second analytics architecture") vs. a new event-log table (larger, not recommended for 4B) | — | Medium |
| 23 | Currency — EGP only at launch, architecture must not hard-code | No currency handling exists yet (RFQ/quotation `currency` fields already default to `'EGP'` as a free-text/enum-ish string, not validated against a currency table) | `quotations.currency` | PARTIALLY IMPLEMENTED (precedent exists) | Plan config carries an explicit `currency` field per price, defaulting to EGP; never hard-code "EGP" inside logic, only in config/seed data | — | Low |

### Requirement 7.1 — the "qualified enquiry" gap, in full

The current RFQ model is **broadcast, not routed**: any homeowner posts an RFQ, and any approved provider — regardless of role/category match — may submit a quotation on it (`submitQuotation` has no category-matching check against the RFQ). Two different, both-plausible readings of "qualified-enquiry allowance" exist, and they gate **different actions**:

- **Reading A — a cap on quotations a vendor may submit per month.** Fully and exactly attributable today: `quotations.providerId` is a hard FK, so "how many quotations has this vendor submitted this calendar month" is a precise, non-approximated count. This requires only a usage-counter check inserted into `submitQuotation`, no new schema beyond a lightweight monthly-counter table (or a query-time `COUNT(*) ... WHERE providerId = ? AND createdAt >= start_of_month`, which needs no new table at all).
- **Reading B — a cap on how many RFQ leads a vendor may view full details of per month**, independent of whether they choose to quote. This is also attributable (a new "RFQ detail viewed" event would need to be recorded, since no such event exists today), but gates a different screen (RFQ browsing, not quoting) and requires new tracking that does not exist.

**Recommendation:** Reading A (cap on quotations submitted) is the pragmatic Phase 4B definition — it uses the existing, exactly-accurate `quotations` data with no new event-tracking, and naturally maps "an enquiry" to "a lead the vendor acted on," which is also the version least likely to frustrate a vendor mid-browse. This is presented as a recommendation, not a decision made on the business's behalf — **the owner should confirm Reading A before implementation**, since Reading B is equally defensible and common in real freemium-marketplace products.

**What must NOT happen, per the task's own instruction:** inventing a fake "qualified" filter (e.g., silently treating every submitted quotation as "qualified" without disclosing that no category-matching exists) would misrepresent the feature. If the business intent is genuinely "vendors should only be shown enquiries matching their category," that is a **separate, larger feature** (RFQ-to-vendor category routing) that does not exist today and is not scoped into this readiness assessment.

### Requirement 4 — the founder-offer gap, in full

The business rules state the founder offer "must be configurable... time-limited... centrally represented... must not require duplicated hard-coded pricing... must have clearly defined eligibility... must have a clearly defined expiration behavior." Two of these are genuinely undefined and must be confirmed before implementation, not invented:

1. **Eligibility rule**: is the founder offer available to (a) every vendor who subscribes before a fixed calendar cutoff date, (b) the first N vendors to subscribe (a counted cohort), or (c) manually admin-granted per vendor? Each implies a different check (`createdAt < cutoff` vs. a counter vs. an admin-set flag on the account).
2. **What happens after the 6 discounted months**: does the vendor roll onto standard pricing automatically (499/999), or does the offer's expiration trigger a re-confirmation/notice first? The business spec says "must have a clearly defined expiration behavior" but does not itself define it.

**Recommendation:** eligibility by calendar cutoff (a) is the simplest, cleanest to implement and audit (`users.createdAt < FOUNDER_OFFER_CUTOFF`, one config value, no counter-race conditions), and automatic roll-to-standard-pricing at month 6 (matching how Decision 3's trial already behaves) is the most consistent behavior. **Both need explicit owner confirmation before implementation** — this is flagged, not decided.

---

## 6. Payment provider verification (STEP 3)

**Evidence-quality disclosure**: direct fetches to `paymob.com`/`developers.paymob.com` were blocked by this sandbox's network egress proxy. The comparison below is built from web search results returning aggregator/community/GitHub-hosted documentation excerpts and news coverage current as of this report's date, not a first-party document Claude read directly page-by-page. Treat every provider-capability claim below as **"credibly reported, not personally verified against primary docs in this session"** — a follow-up pass with direct docs access (or the owner's own provider account/sales contact) should confirm before committing to an integration.

| Capability | Paymob | Fawry | Stripe |
|---|---|---|---|
| Recurring subscriptions | Yes — dedicated Subscriptions Module (create/list/update/suspend/resume plans, per-customer subscriptions billed against tokenized cards) | Recurring billing supported, framed around recurring invoices/reference numbers rather than a documented subscription-object API | Yes — Stripe's core product, most mature subscription API in the industry |
| Tokenized payment methods | Yes — cards tokenized on Paymob's gateway; supports MIT (merchant-initiated transactions) for unattended recurring charges | Present in ecosystem (card payment flows exist) but subscription-specific tokenization documentation is thinner than Paymob's | Yes — mature, first-class |
| EGP settlement | Yes | Yes | Not applicable — no direct Egypt merchant account (see below) |
| Webhooks | Yes — transaction callbacks on success/decline | Yes — server callback with `messageSignature` | Yes — mature |
| Webhook signature verification | Yes — documented HMAC-SHA512 process (sort params lexicographically, concatenate, HMAC with secret) | Yes — documented `messageSignature` = SHA-256(`merchantCode + merchantRefNumber + secureKey`) | Yes — `stripe.webhooks.constructEvent`, industry-standard |
| Idempotency support | Not explicitly confirmed in sources found; standard practice would be to enforce it application-side regardless (§7.6) | Not explicitly confirmed | Yes — native idempotency-key support, most mature of the three |
| Refunds | Yes — documented refund (for captured/settled transactions) and void (for same-day uncaptured transactions, auto-voided after 14 days if uncaptured) | Yes — Refund API for settled orders | Yes — mature, partial/full |
| Cancellation | Implied via subscription "suspend/resume" controls in the Subscriptions Module | Not clearly documented for a subscription object (see recurring-billing caveat above) | Yes — mature, `cancel_at_period_end` native support |
| Trial support | Not explicitly confirmed in sources found — would need to be modeled application-side (delay first charge) if not native | Not confirmed | Yes — native `trial_period_days` |
| Sandbox/test environment | Yes — test/live mode via different API keys/integration IDs on the same regional base URL | Yes — separate sandbox environment confirmed (`developer.fawrystaging.com`) | Yes — extensive test mode |
| Merchant onboarding (Egypt) | Established local PSP, "typically faster onboarding" for Egypt-regulated merchants per third-party sources; standard KYC (company registration, beneficial ownership) | Long-established Egyptian fintech/payment aggregator; presumably similarly Egypt-native onboarding | **Egypt is not a Stripe-supported country for a direct merchant account as of this report.** Workaround exists only via incorporating a legal entity in a Stripe-supported country (e.g., UK) — a business/legal decision, not an engineering one |
| Regulatory context | Both Paymob and Fawry operate as regulated PSPs under Egypt's Central Bank (CBE) framework; CBE issued new PSP/PSO licensing rules in June 2025 with a transition period to June 2026 — using an already-licensed local PSP (either) avoids BuildHub needing its own payment-processor license | | Not directly applicable without the entity workaround above |
| Marketplace/split-payment capability | Not confirmed in sources found, and **not needed for Phase 4B** — this phase is vendor→platform subscription billing, not customer→vendor transaction splitting. Revisit only if a future phase adds in-platform payments between customers and vendors | Not confirmed | Has Stripe Connect for this, but irrelevant while Stripe isn't directly available in Egypt |
| GCC expansion relevance | Explicitly serves Egypt, Saudi Arabia, UAE, and Oman under one integration per sources found — directly useful for the "avoid hard-coding currency/region" architecture requirement | Egypt-focused; GCC reach not confirmed | N/A while unavailable |

### Recommendation

**Paymob**, for a test-mode integration to begin architecture validation, with the following caveats made explicit rather than assumed:

- Its documented Subscriptions Module and clear, verifiable HMAC webhook process are the best-evidenced fit for exactly what Phase 4B needs (recurring vendor subscriptions with tokenized cards).
- Its stated multi-country reach (Egypt/KSA/UAE/Oman) aligns with the architecture's own requirement to avoid hard-coded currency/region assumptions for future GCC expansion.
- **This is not a final commitment** — before any real integration work, obtain the account team's direct confirmation of: native trial support (or the need to model it application-side), explicit idempotency guarantees on webhook delivery, and current onboarding-document requirements for a BuildHub-specific merchant account. Fawry should be kept as a documented fallback/alternative, not dismissed — its recurring-billing product may prove equally capable once verified against primary documentation with real account access. **Stripe remains correctly out of consideration for direct use at Egypt launch**, per §16 of the business requirements, and needs no further evaluation unless a foreign-entity structure is separately decided.

This recommendation is a starting point for the architecture in §7, not an authorization to integrate — per this task's explicit instruction, no provider integration code will be written until this readiness report is reviewed.

---

## 7. Architecture (STEP 4)

### 7.1 Database model

```
plans (seed/reference data, not per-vendor)
  id            varchar PK          e.g. 'free' | 'professional' | 'premium'
  name          varchar
  createdAt / updatedAt

planPrices (one plan can have multiple prices: monthly/annual, and a founder variant)
  id                 int PK
  planId             FK -> plans.id
  interval           enum('month','year')
  amount             decimal(10,2)     -- EGP minor-unit-safe (store as decimal, not float)
  currency           varchar(3)         default 'EGP' -- never hard-coded in logic
  isFounderOffer     boolean default false
  founderOfferMonths int nullable       -- e.g. 6
  providerPriceId    varchar nullable   -- the provider's own Price/Plan object id, set once created there
  active             boolean default true
  createdAt / updatedAt

vendorSubscriptions (one row per vendor's current/historical subscription)
  id                  int PK
  userId              FK -> users.id (unique per active subscription; historical rows keep FK, no unique constraint across all time)
  planId              FK -> plans.id
  status              enum('trialing','active','past_due','canceled','incomplete')
  provider            varchar            -- 'paymob' | future providers, never assumed single-provider in the schema
  providerCustomerId  varchar nullable
  providerSubscriptionId varchar nullable
  currentPeriodStart  timestamp
  currentPeriodEnd    timestamp
  trialEndsAt         timestamp nullable
  cancelAtPeriodEnd   boolean default false
  founderOfferAppliedPriceId FK -> planPrices.id nullable
  createdAt / updatedAt
  index on userId, index on status, index on currentPeriodEnd (for the heartbeat sweep)

billingEvents (append-only audit trail — Phase 4A's userAccountAuditEvents pattern, reused for billing)
  id          int PK
  userId      FK -> users.id
  subscriptionId FK -> vendorSubscriptions.id nullable
  action      varchar   -- 'trial_started','subscribed','renewed','payment_failed','canceled','refunded','downgraded', etc.
  actorId     FK -> users.id nullable (admin-initiated actions)
  source      varchar   -- 'webhook' | 'admin' | 'vendor'
  note        text nullable
  createdAt

enquiryUsage (monthly counter, only if Requirement 7.1's Reading A is confirmed)
  id          int PK
  userId      FK -> users.id
  yearMonth   varchar(7)  -- '2026-08'
  count       int default 0
  unique index on (userId, yearMonth)
```

All FKs follow the existing Phase 3C convention (explicit `onDelete`/`onUpdate`, RESTRICT-favoring — `vendorSubscriptions`/`billingEvents` should use `RESTRICT` on `userId` like most of the schema, **not** `CASCADE`, since a subscription/billing record must never silently vanish if a user row is ever removed — this matches the requirement to never destroy business/historical data).

### 7.2 API model (tRPC, matching existing router conventions)

```
billingRouter
  plans.list                    publicProcedure   — the 3 plans + prices, for pricing-page display
  subscription.getMine           protectedProcedure — the caller's own subscription (self-scoped, ctx.user.id only)
  subscription.createCheckout    approvedProviderProcedure — starts a provider Checkout session for a chosen plan/price
  subscription.createPortalSession approvedProviderProcedure — provider Customer Portal link (self-service cancel/change)
  subscription.cancel            approvedProviderProcedure — sets cancelAtPeriodEnd, mirrors provider cancellation
  webhook (raw Express route, NOT a tRPC procedure — see §7.6)
  admin.subscriptions            adminProcedure — explicit allowlist (§7.9), no payment credentials ever returned
  admin.refund                   adminProcedure — authorized refund initiation, logged to billingEvents
```

Every mutation that could change plan/price is `approvedProviderProcedure`-gated and reads `ctx.user.id` only — never a client-supplied `userId`, matching the discipline already established for every other endpoint in this codebase (`profile.update`, `analytics.myStats`, etc. — see the Phase 4A cumulative audit's own repeated confirmation of this pattern).

### 7.3 Provider abstraction (§17 of the business requirements)

```
Billing Domain (server/billing/*.ts)
  — owns: plans, vendorSubscriptions, entitlements, billing periods, trial state,
    cancellation state, payment state, downgrade state
  — never imports a provider SDK directly

PaymentProviderAdapter (interface)
  createCustomer(user) -> providerCustomerId
  createCheckoutSession(user, priceId) -> checkoutUrl
  createPortalSession(providerCustomerId) -> portalUrl
  cancelSubscription(providerSubscriptionId, atPeriodEnd: boolean) -> void
  refund(providerTransactionId, amount?) -> refundId
  verifyWebhookSignature(rawBody, signatureHeader) -> parsed event | throws

PaymobAdapter implements PaymentProviderAdapter   (server/billing/providers/paymob.ts)
StripeAdapter implements PaymentProviderAdapter   (not built now — interface proves the abstraction holds)
```
This mirrors the existing external-service pattern already in this codebase (`server/_core/oauth.ts`, `server/storage.ts`, `server/_core/heartbeat.ts` — each isolates one third-party integration behind a small, typed module). The billing domain calls only the interface; a future second provider (Stripe, once viable, or a GCC-market provider) is a new adapter file, not a rewrite.

Plan/price configuration itself lives in `planPrices` (§7.1) as **data, not code** — the founder offer's price, duration, and active window are all rows, never hard-coded numbers duplicated across the checkout flow, the pricing page, and the entitlement checker. This directly satisfies the business requirement "must not require duplicated hard-coded pricing."

### 7.4 Subscription/trial/payment/cancellation/failed-payment lifecycles

```
signup (FREE, implicit)
  → vendor clicks "Upgrade" → createCheckoutSession(plan, trialDays=30)
  → provider redirects back → webhook: subscription created, status='trialing', trialEndsAt=+30d
  → [30 days pass]
     → vendor added a payment method during trial (provider-dependent, see §6 open question)
        → webhook: invoice.paid → status='active', currentPeriodEnd=+1 interval
     → vendor did not subscribe
        → heartbeat job (daily) finds trialEndsAt < now AND status='trialing' with no successful charge
        → status='canceled', plan reverts to FREE, billingEvents: 'trial_expired_downgraded'
        → vendor row, reviews, products, rfqs, quotations, all business data: UNTOUCHED

renewal (recurring)
  → provider auto-charges the tokenized card at period end
  → webhook: invoice.paid → currentPeriodEnd extended, billingEvents: 'renewed'
  → webhook: invoice.payment_failed → status='past_due', billingEvents: 'payment_failed'
     → grace period: LENGTH NOT YET APPROVED (see §7.4.1) — entitlements preserved during grace
     → grace period elapses without a successful retry
        → status='canceled' (non-renewal), plan reverts to FREE
        → paid entitlements removed; all business data preserved

voluntary cancellation
  → vendor calls subscription.cancel OR uses the provider Customer Portal
  → cancelAtPeriodEnd=true immediately; access continues, no immediate change
  → at currentPeriodEnd: heartbeat job sets status='canceled', plan reverts to FREE
  → billingEvents: 'canceled_by_vendor'

refund
  → admin-initiated only (per §11 of the business requirements — no self-service refund UI approved yet)
  → adapter.refund() called; billingEvents: 'refunded', amount, actorId (the admin) recorded
  → does NOT automatically alter subscription status — a separate, explicit admin action if access should also be revoked
```

**7.4.1 — grace period is explicitly unresolved.** Per the business requirements' own instruction ("NO GRACE PERIOD HAS BEEN APPROVED YET... do not invent one"), this architecture defines the *mechanism* (a `past_due` status that preserves entitlements until a heartbeat job downgrades it) without hard-coding a duration. **Recommendation for owner approval**: a 3-day grace period with one automatic retry (a common Paymob/industry default), configurable via `adminSettings` (not hard-coded), so it can be tuned without a redeploy. This is a recommendation, not a decision made on the business's behalf.

### 7.5 Featured placement architecture (kept deliberately separate from trust/verification, per §10 of the business requirements)

```
featuredPlacements
  id          int PK
  userId      FK -> users.id
  source      enum('plan_entitlement','purchased_addon')  -- ties back to §8 Decision 4's eventual answer
  startsAt    timestamp
  endsAt      timestamp
  active      boolean (derived/cached from startsAt/endsAt, or computed at query time)
```
This table is **structurally independent** of `users.verified` and the `reviews` table — nothing in the featured-placement code path ever writes to either, satisfying "paying for placement must never automatically create verification... must never alter reviews... must never manipulate trust scores." A directory/search result would compute two entirely separate things per vendor: an **organic relevance score** (unrelated to billing — e.g., reputation, response rate, recency) and a **paid placement flag** (from this table), and the UI must visibly label the latter (e.g., a "Featured" badge), never blend them into one ranking number that hides which part was purchased.

**This entire feature has no directory to attach to yet** — see §1.4/§5 Requirement 7.2. Building the real, database-backed vendor directory is a prerequisite this report surfaces but does not scope as a Phase 4B deliverable itself; it should be sequenced explicitly (§7.10) rather than silently assumed to already exist.

### 7.6 Webhook security (§18 of the business requirements)

```
POST /api/billing/webhook   (raw Express route, registered BEFORE any JSON body-parser
                              middleware that would consume the raw body — signature
                              verification requires the exact, unparsed payload bytes)

1. Read raw body + signature header.
2. adapter.verifyWebhookSignature(rawBody, header) — throws on mismatch, returns 400 immediately, no further processing.
3. Extract the provider's event id. Check a `processedWebhookEvents(eventId PK, processedAt)` table —
   if already present, return 200 immediately (idempotent no-op), matching the pattern already used
   for revokedSessions' PK-based dedup lookup in this codebase (Phase 4A.6.6).
4. If new: process the event, write the eventId to processedWebhookEvents in the same transaction
   as the state change, so a crash between "processed" and "recorded" can't cause a silent double-process
   on redelivery.
5. Webhook handlers update ONLY vendorSubscriptions/billingEvents — the webhook is the single source of
   truth for payment state; the client-side UI never sets subscription status directly.
```

### 7.7 Entitlement architecture (§19 of the business requirements)

```
server/billing/entitlements.ts

const PLAN_ENTITLEMENTS: Record<PlanId, Entitlements> = {
  free:         { enquiryAllowance: 5,  visibilityTier: 'standard', analyticsLevel: 'basic', ... },
  professional: { enquiryAllowance: 30, visibilityTier: 'boosted',  analyticsLevel: 'advanced', ... },
  premium:      { enquiryAllowance: null /* unlimited */, visibilityTier: 'top', analyticsLevel: 'advanced', ... },
};

async function getEntitlements(userId): Promise<Entitlements>
  — reads the vendor's current vendorSubscriptions row (status active/trialing → its plan;
    anything else → 'free'), returns the matching PLAN_ENTITLEMENTS row.
  — this is the ONE function every plan-gated check calls. No router scatters its own
    "if (user.plan === ...)" logic — mirrors how approvedProviderProcedure is already the
    single gate for "is this user an approved provider," reused rather than duplicated
    everywhere a role check is needed.

entitledProcedure(requiredFeature) — a tRPC middleware factory, same shape as the existing
  approvedProviderProcedure/adminProcedure pattern, so gating a new or existing endpoint by
  plan is a one-line change, not a scattered inline check.
```
Values (`5`, `30`, `499`, etc.) live in `PLAN_ENTITLEMENTS`/`planPrices`, never duplicated in client code — the client renders whatever `subscription.getMine` returns, never re-derives its own copy of the rules (closing the exact class of risk called out in §18: "Vendors cannot manipulate plan IDs or prices from the client" — the client has no authority to compute its own entitlement, only to display the server's answer).

### 7.8 Admin model

Extends the already-proven allowlist pattern:
```
ADMIN_SUBSCRIPTION_COLUMNS = {
  userId, planId, status, provider, currentPeriodStart, currentPeriodEnd,
  trialEndsAt, cancelAtPeriodEnd, founderOfferAppliedPriceId, createdAt, updatedAt,
} as const;
```
Deliberately excludes `providerCustomerId`/`providerSubscriptionId` (opaque provider references with no admin-facing value and a theoretical enumeration/social-engineering risk if ever leaked) and, obviously, any card data (which BuildHub's own database will never hold at all — see §7.9).

### 7.9 Security model (§18 of the business requirements, mapped to this design)

| Requirement | How this architecture satisfies it |
|---|---|
| Never trust client subscription status | `entitledProcedure` re-reads `vendorSubscriptions` server-side on every gated request — same "always re-fetch, never cache into the JWT" discipline already proven in Phase 4A.6.8's account-status re-check |
| Entitlements server-authoritative | §7.7 — one server function, never duplicated client-side |
| Verify webhook signatures | §7.6 step 2, mandatory, fails closed |
| Idempotent webhook processing | §7.6 step 3-4, PK-based dedup table |
| Replay protection | Signature verification + idempotency table together — a replayed valid-but-old event is either a no-op (already processed) or, if genuinely new-to-us but stale, still reflects real provider state, which is the correct source of truth |
| Payment secrets server-side only | Provider keys live only in `ENV`-style server config, mirroring the existing `forgeApiKey` pattern — never sent to the client bundle |
| No raw card storage | Never handled — Checkout/Portal are provider-hosted, BuildHub's server never receives a card number (avoids PCI scope entirely) |
| No credentials in source control | Same discipline already followed for `JWT_SECRET`/`DATABASE_URL` throughout this engagement |
| Vendor billing access self-scoped | `subscription.getMine` reads `ctx.user.id` only, no `userId` input parameter anywhere in the billing router — the exact structural pattern (no client-suppliable identity field) already used by `profile.getOwn`/`analytics.myStats` |
| Vendors cannot manipulate plan IDs/prices from client | Checkout session is created server-side from a server-selected `planPrices` row; the client sends a plan *choice* (e.g., `'professional-annual'`), the server resolves the actual price, never trusting a client-supplied amount |
| Vendors cannot access another vendor's billing | Same self-scoping as above — structurally impossible, not just runtime-checked |
| Subscription state transitions auditable | `billingEvents`, append-only, mirrors `userAccountAuditEvents`'s existing, already-proven pattern |
| Refunds authorized | `admin.refund` is `adminProcedure`-gated, logged with `actorId` |
| Admin billing visibility excludes credentials | §7.8 allowlist |

### 7.10 Migration strategy

1. New tables only (`plans`, `planPrices`, `vendorSubscriptions`, `billingEvents`, `enquiryUsage` if Reading A is confirmed, `processedWebhookEvents`, `featuredPlacements`) — **zero changes to any existing table**, zero risk to Phase 3C's FK/index work, consistent with this whole engagement's demonstrated discipline of never touching `0012_broken_nightmare.sql`.
2. Seed `plans`/`planPrices` with the approved FREE/Professional/Premium values (§4 of the business requirements) as the migration's own seed data — not a manual admin-panel entry step, so the values are versioned and reviewable in the PR diff.
3. Every new FK uses `RESTRICT` (matching Phase 3C's established convention), except where a genuine cascade makes sense (none identified here — billing history should never silently vanish).
4. The prerequisite real vendor-directory feature (§1.4) is **not** a migration this report scopes — it is called out as a sequencing dependency (§7.10 below), to be scoped in its own right when reached.

### 7.11 Rollback strategy

- All new tables are additive; rolling back is dropping tables that nothing else depends on (no existing table gained a new column or FK from this work), so a rollback is low-risk by construction.
- Entitlement checks (`entitledProcedure`) fail closed if `vendorSubscriptions` is unreachable or a row is malformed (treat as `free`), never fail open into unpaid access to a paid feature — but also never fail open into blocking `free` functionality, since `free` requires no subscription row to exist at all.
- Webhook processing is idempotent (§7.6), so a rollback-and-redeploy during a provider retry window cannot double-charge or double-process — the provider will simply redeliver, and the dedup table absorbs it.
- No production payment credentials will exist until explicitly authorized (per the task's own instruction), so there is no "live money" rollback scenario to plan for at this stage — only test-mode data, which can be reset freely.

---

## 8. Readiness gate (STEP 5)

1. **What already exists**: vendor identity/roles, profile, dynamic reputation, provider analytics (basic), RFQ/quotation flow, admin allowlist discipline, a reusable scheduled-job primitive, an audit-log pattern directly reusable for billing events.
2. **What needs configuration**: a global billing-enabled flag via the existing `adminSettings` mechanism.
3. **What needs implementation**: everything in §7 — billing domain, provider adapter, checkout/portal/webhook endpoints, entitlement gating, vendor billing UI, admin billing visibility, enquiry-allowance enforcement.
4. **What requires new schema**: `plans`, `planPrices`, `vendorSubscriptions`, `billingEvents`, `processedWebhookEvents`, `featuredPlacements`, optionally `enquiryUsage` — all additive, zero changes to existing tables.
5. **Provider recommendation**: Paymob, for a test-mode start, with Fawry as a documented fallback — see §6's caveats on evidence quality.
6. **Provider limitations**: trial-support and idempotency guarantees not confirmed in available sources for either Egypt provider; Stripe correctly excluded from direct use at Egypt launch.
7. **Remaining business decisions**: the 8 decisions already presented at the prior gate, still open, plus two new ones this report surfaces precisely because they block implementation, not because they were missed before: (a) Reading A vs. B for "qualified enquiry" (§5, Requirement 7.1), and (b) founder-offer eligibility rule + post-offer behavior (§5, Requirement 4). Grace-period length (§7.4.1) remains explicitly unapproved per the business requirements' own instruction.
8. **Security risks**: none identified beyond the standard, already-designed-for set in §7.9 — no gap found between the approved security requirements and this architecture's coverage of them.
9. **Migration risks**: minimal — additive-only schema, no existing table touched, matching this engagement's established, zero-incident migration discipline since Phase 3C.
10. **Rollback strategy**: additive tables are trivially reversible; idempotent webhook design removes the double-processing risk class entirely; no live payment state exists yet to complicate a rollback.
11. **Exact implementation sequence**: as given in the authorizing task (4B.1 → 4B.17), unchanged — this report does not propose a different order, only fills in what each step now concretely means given §7.
12. **Is Phase 4B ready for implementation?** — see the verdict below.

---

## Final verdict

# PHASE 4B — NOT READY — EXACT BLOCKERS

Not a "not ready" on engineering grounds — the architecture in §7 is complete, internally consistent, and requires no unapproved technical judgment calls to begin building. It is not ready because implementation would require silently resolving business questions this report is explicitly instructed not to invent an answer to:

1. **Provider selection is not yet confirmed** — §6's recommendation (Paymob, test-mode) needs owner sign-off, plus the primary-documentation gaps noted (trial support, idempotency guarantees) verified directly against a real account before code is written against assumed behavior.
2. **"Qualified enquiry" definition** (§5, Requirement 7.1) — Reading A recommended, not decided.
3. **Founder-offer eligibility rule and post-offer behavior** (§5, Requirement 4) — recommendation given, not decided.
4. **Grace-period length** (§7.4.1) — explicitly forbidden to invent; a 3-day/one-retry default is recommended for approval.
5. **The vendor-directory prerequisite** (§1.4/§5 Requirement 7.2) — featured placement and visibility-tier entitlements cannot be meaningfully implemented until a real, database-backed vendor directory replaces the current static mock. This is not itself a Phase 4B task, but its absence blocks two of Phase 4B's named capabilities (§10, and the visibility differentiators in §7-§9 of the business requirements) unless the owner either (a) authorizes scoping that prerequisite alongside 4B, or (b) explicitly defers featured placement/visibility tiers to a later phase and launches 4B.1–4B.13 (subscriptions/billing/entitlements minus placement/visibility) first.
6. **Portfolio, multi-branch, and multi-team entitlements** (§5, Requirements 10 and 15) reference features that do not exist in any form. These should be explicitly descoped from the *initial* Professional/Premium feature list (or clearly labeled "coming soon") rather than presented to vendors as already-purchasable — a business decision on messaging, not an engineering blocker, but one that must be made before any vendor-facing plan-comparison page ships.

Once decisions 1–4 are made, decision 5's sequencing choice is picked, and 6's messaging is resolved, implementation can begin at **4B.1 (Billing schema/domain)** exactly as architected in §7, with no further discovery work needed first.
