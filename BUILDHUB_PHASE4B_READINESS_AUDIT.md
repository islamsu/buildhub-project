# BuildHub — Phase 4B Readiness Audit

**Branch:** `claude/phase4b-readiness-audit-hardening`
**Baseline SHA:** `54918a2` (tip of `claude/phase4b4-subscription-lifecycle`)
**Date:** 2026-08-20
**Scope:** inspection only. **No code was changed to produce this report.**

---

## 0. Correction to the stated starting position

The commissioning brief's §0 describes the project as "Phase 4A complete, 347/347
tests passing". That is out of date. Verified this session:

| | Brief §0 | Actual |
|---|---|---|
| Tests | 347/347 | **598 / 598 passing** (40 files) |
| Phases | 4A complete | **4B.1, 4B.2, 4B.3, 4B.4 complete**; 4B.5 blocked |
| TypeScript | clean | clean |

Four monetization phases already shipped. This audit therefore reports what is
**already complete** as prominently as what is missing — and the two things it found
are not what the brief anticipates.

**Headline finding 1.** The billing engine is complete and **almost entirely
unreachable from the user interface.** A vendor cannot see their plan, upgrade, or
cancel. None of that is blocked by the payment provider.

**Headline finding 2.** There is a cluster of **launch-blocking security and
configuration defects unrelated to billing**, not surfaced by any previous phase
because no previous phase looked at boot configuration, transport hardening, or error
handling. At least one is severe.

---

## 1. Current monetization implementation — **ALREADY COMPLETE**

`shared/billing.ts` (218 lines) is the single source of truth for every commercial
value: plan ids, EGP-only currency, `TRIAL_DAYS = 30`, `GRACE_PERIOD_DAYS = 7`,
`FOUNDER_OFFER_MONTHS = 6`, the full `PLANS` table (Professional 499/4,990; Premium
999/9,990; founder 299/699 monthly), and `resolvePrice()` as the only function
permitted to resolve a price. No commercial value is duplicated anywhere else.

It also carries an `ENTITLEMENT_ENFORCEMENT` honesty ledger stating, per entitlement,
which phase actually enforces it — see §9.

## 2. Existing subscription models — **ALREADY COMPLETE**

`vendorSubscriptions` (23 columns, `UNIQUE(userId)`, indexed on `status`,
`currentPeriodEnd`, `trialEndsAt`, `gracePeriodEndsAt`) is a single-row-per-vendor
live state machine. `billingEvents` is its append-only audit trail (actor, from/to
status, source, note, timestamp).

Provider columns (`provider`, `providerCustomerRef`, `providerSubscriptionRef`,
`providerPriceRef`) are all nullable and provider-agnostic by name. **No card, CVV,
token, or credential data is stored anywhere.**

## 3. Existing vendor plan logic — **ALREADY COMPLETE**

`server/billing/`:
- `domain.ts` — pure transitions, no I/O. `deriveBillingState()` resolves entitlements
  from stored state **and current time**, so a lapsed trial or expired grace period
  resolves to FREE whether or not any sweep has run. Fails closed on malformed rows.
- `entitlements.ts` — `resolveVendorEntitlements()`, the single entitlement authority.
- `lifecycle.ts` — orchestration. Every transition runs inside one transaction holding
  a `SELECT … FOR UPDATE` row lock; every operation reports `applied`/`noop`/`rejected`
  so repeats never double-apply.
- `service.ts` — the only layer that reads/writes billing tables; explicit column
  allowlists (`VENDOR_SUBSCRIPTION_COLUMNS`, `ADMIN_SUBSCRIPTION_COLUMNS`).

Nine lifecycle states are **derived, never stored** — the database keeps exactly one
`status` column, so no second state system can disagree with the first.

## 4. Existing RFQ / lead infrastructure — **ALREADY COMPLETE**

Phase 4B.3 delivered deterministic RFQ → vendor targeting on a shared nine-value
taxonomy (`shared/rfqCategories.ts`), vendor self-declared categories, and
transactional qualified-enquiry counting with two-layer database concurrency defence
(`UNIQUE(userId, rfqId)` plus a `FOR UPDATE` range lock over `(userId, yearMonth)`).

Live-verified: 12 simultaneous requests on a FREE plan granted exactly 5.

An RFQ that cannot be classified is eligible for **nobody** — the documented
conservative fallback. It stays visible in the ordinary listing; it simply never
becomes a targeted qualified enquiry.

## 5. Existing admin capabilities — **PARTIAL**

33 admin procedures exist across users, dummy accounts, compliance, billing,
targeting, disputes, settings and audit. One admin page (`AdminDashboard.tsx`,
6 tabs).

**Complete:** user management, invitations, freeze/unfreeze, compliance queue with
per-document review and bulk decisions, audit trail, CSV export.

**NEEDS IMPLEMENTATION:**
- **No admin billing UI.** All 10 billing/lifecycle procedures are API-only — no tab,
  no nav entry, no client call site anywhere.
- **No reviews moderation.** No admin procedure touches `reviews`, and
  `reviews.submit` hardcodes `verified: true` (`routers.ts:898`), so the `verified`
  filter is never a moderation gate.
- **No category management** — RFQ categories are a shared constant; product
  categories are hardcoded client-side.
- **No admin RFQ or quotation visibility** beyond a count.
- **No admin broadcast/notification capability.**

**Defects found:**
- **The `disputes` table has no insert path.** Admin can list and update disputes, but
  no `db.insert(disputes)` exists anywhere in the repo — the queue is structurally
  always empty. The brief's §34 dispute workflows do not exist.
- **8 of 10 admin settings are inert** — `maintenanceMode`, `registrationEnabled`,
  `reviewApprovalRequired`, `autoVerifyKyc` and others are stored and rendered but read
  by no server logic. Only the founder-offer cut-off is wired.
- `admin.verifyUser` (`routers.ts:1537`) writes **no audit event**, unlike every
  neighbouring mutation.
- **Fraud Detection tab is a static empty state** with no backend.

## 6. Existing analytics — **PARTIAL, with fabricated data shipping**

**Exists:** `analytics.myStats` — vendor performance (quotations submitted/accepted,
win rate, average response time), self-scoped with no input, rendered by
`VendorAnalytics.tsx`. Honest: division-by-zero yields `null`, not a fake zero.

**NEEDS IMPLEMENTATION:** there is **no product/business event framework** — no event
table, no `track()` helper, no recording of registration, RFQ creation, or
subscription events. The brief's §27 event list does not exist. Both "analytics"
surfaces compute ad-hoc SQL aggregates at read time; `admin.analyticsSummary` performs
an unbounded full-table read and buckets by month in JavaScript.

**DEFECT — fabricated business data in the admin UI.** `AdminDashboard.tsx:28` defines
`MONTHLY_USERS` (Jan 120 → Jun 580 users) and line 152 falls back to it whenever the
real query returns empty. `admin.analyticsSummary` has its own hardcoded fallback at
`routers.ts:1445`. **On a fresh production deployment the owner would be shown invented
growth charts.**

**DEFECT — the shipped build requests a broken URL.** `client/index.html:19-22` carries
an Umami tag whose `%VITE_ANALYTICS_ENDPOINT%` / `%VITE_ANALYTICS_WEBSITE_ID%`
placeholders are never substituted; they appear verbatim in `dist/public/index.html`.
Inherited scaffold boilerplate, not an integration.

## 7. Existing payment-related code — **BLOCKED BY PAYMENT PROVIDER**

`server/billing/provider.ts` defines the `PaymentProvider` interface
(`createCustomer`, `createCheckoutSession`, `cancelSubscription`, `refund`,
`verifyAndParseWebhook`) plus a `NormalisedProviderEvent` vocabulary shaped from
BuildHub's own lifecycle, deliberately not from any provider's API.

`NullPaymentProvider` throws loudly on every operation rather than silently
no-opping. `isPaymentProviderConfigured()` reports honestly.

**No adapter exists.** Phase 4B.5 confirmed two independent blockers: no Paymob
credentials anywhere in the environment, and all Paymob domains rejected by the
network policy. See `BUILDHUB_PHASE4B5_PAYMOB_INTEGRATION.md`.

## 8. Database changes required — **NEEDS IMPLEMENTATION** (none blocked)

Two additive tables, both buildable now without a provider:

1. **Billing-history record.** `billingEvents` stores status transitions only — no
   amount, currency, or period. Worse, `vendorSubscriptions.priceAmount` is
   **overwritten in place** on every plan change (`domain.ts:352,479,500,527`), so
   price history is destroyed. Nothing exists to show a vendor as "here is what you
   were charged, when, for what period". The brief's §6 requires an invoice/billing
   record.

2. **Provider-event / idempotency table.** `provider.ts:52` declares `eventId` "used
   for idempotent processing (Phase 4B.5)" — with **no storage behind it**. Webhook
   deduplication is currently not implementable. The `qualifiedEnquiries` unique-index
   dedup pattern proven in 4B.3 is the model to follow.

No destructive change is required anywhere. Existing FK convention is RESTRICT.

## 9. Entitlement changes required — **NEEDS BUSINESS DECISION**

The `ENTITLEMENT_ENFORCEMENT` ledger, verified against the code:

| Entitlement | Status |
|---|---|
| `qualifiedEnquiriesPerMonth` | enforced (4B.3) |
| `serviceCategoryLimit` | enforced (4B.3) |
| `analyticsLevel` | enforced (4B.2) |
| `visibilityLevel` | deferred to 4B.6 — paid ranking deliberately forbidden |
| `featuredPlacementEligible` | deferred to 4B.6 |
| `portfolioLevel` | **`not-implemented`** |
| `promotionalCapability` | **`not-implemented`** |
| `branchLimit` | **`not-implemented`** |
| `teamMemberLimit` | **`not-implemented`** |

**Four of nine entitlements have no product feature behind them.** Confirmed: no
portfolio, branch, or team-member table exists; those words appear only in entitlement
definitions, tests, i18n strings, and the superseded mock data file. Yet the approved
business model lists "Full portfolio capability", "Promotional offers", "Multiple
branches" and "Multiple team members" as PROFESSIONAL/PREMIUM benefits at
EGP 499–999/month.

**Owner decision, deliberately not resolved here.** No live exposure exists today
because no checkout exists — nothing can be sold. Per owner instruction this is
flagged and the plan table is left untouched, to be revisited before payments
activate.

## 10. Security changes required — **NEEDS IMPLEMENTATION (urgent)**

Ten findings. All are payment-independent. A1–A9 are addressed in the hardening slice
that follows this audit; A10 is deferred because it needs storage-header work.

| # | Finding | Evidence |
|---|---|---|
| **A1** | **An empty `JWT_SECRET` boots successfully and signs sessions.** `getSessionSecret()` returns `new TextEncoder().encode("")`. Every env var is `process.env.X ?? ""`; there is no schema, no assertion, no throw. A misconfigured deploy signs session JWTs with a zero-length key and nothing reports it. | `_core/env.ts:3`, `_core/sdk.ts:157-159` |
| **A2** | **Session revocation fails OPEN on DB outage.** The code documents this as deliberate graceful degradation, but it silently disables the control Phase 4A.6.8 built. A revoked token becomes valid again during a blip. | `db.ts:55-63` |
| **A3** | **tRPC leaks internal error messages unconditionally**, and stack traces whenever `NODE_ENV` is not exactly `production`. No `errorFormatter`, no `onError`. Storage-config strings and DB-layer messages reach unauthenticated callers. | `_core/index.ts:42-45`, `storage.ts:12-14` |
| **A4** | **The React error boundary renders raw stack traces into production UI** and reports nothing (no `componentDidCatch`) — errors are displayed and discarded. | `ErrorBoundary.tsx:37-39` |
| **A5** | **No brute-force protection on password login or invitation completion.** `auth.completeInvitation` is unauthenticated, unthrottled, and sets a password from a guessable token. The only rate limiter in the codebase guards `ai.chat`. | `routers.ts:108`, `:1210`; `rateLimit.ts:51` |
| **A6** | **Avatar uploads are broken.** `authorizeStorageKey` has no `avatars/` branch, so the fail-closed default returns 403 to every non-admin — while avatars are actively written to that prefix. | `storageProxy.ts:66` vs `routers.ts:1021` |
| **A7** | **`trust proxy` is never set** — cookie `secure` is derived from an untrusted hop, and the IP-keyed limiter is bypassable by spoofing `x-forwarded-for`. Combined with `sameSite:"none"` and no CSRF token anywhere. | `cookies.ts:11-22,45`; `rateLimit.ts:41-46` |
| **A8** | **Production port binding is nondeterministic** — the server scans 20 ports and silently binds a different one, with only a `console.log`. An orchestrator's routing would point at the wrong port. | `_core/index.ts:22-29,54-59` |
| **A9** | **`db:push` runs `generate` before `migrate`** — used in a deploy pipeline it would author new migrations from current schema rather than applying reviewed ones. No apply-only script exists. | `package.json:13` |
| **A10** | **Upload type checks trust the client-declared `contentType`.** No magic-byte sniffing; `image/svg+xml` passes every image path (script-bearing); `text/*` on project documents admits `text/html`; no `Content-Disposition`. *(Deferred — needs storage-header work.)* | `shared/projectFeatures.ts:5`, `storage.ts:64` |

**To trace, not assume.** `messages.send` with `type:'quotation'` checks only that the
quotation *exists*, not that the sender is party to it (`routers.ts:775`), and
`MessagesPage.tsx:252` exposes a free-text "Quote ID" field. The *viewing* path was
guarded by the Phase 4A IDOR fix, so this is probably an enumeration oracle rather
than disclosure — but the brief's §14 warns explicitly against assuming one IDOR fix
settles the class. Flagged for the authorization sweep.

## 11. Testing gaps — **PARTIAL**

598 tests across 40 files. Strong coverage of billing (180 tests), RFQ targeting (71),
authorization for projects/reviews/admin-data/auth/sessions, and database integrity.

**Gaps:**
- **No dedicated authorization test file** for `messages`, `notifications`,
  `marketplace`, `profile`, `registration`, or `analytics`.
- **No end-to-end / browser test infrastructure in the repo** — no `e2e/` directory,
  no Playwright config. Browser verification has been ad-hoc per phase and is not
  reproducible by anyone else.
- **No CI**, so `check`, `test` and `build` never run automatically.
- No test covers boot configuration, transport hardening, or error-shape leakage —
  which is precisely why §10's findings survived four phases.

## 12. Production-readiness gaps — **NEEDS IMPLEMENTATION**

Beyond §10: no CI, Dockerfile, or deploy config of any kind (no `.github/` directory).
No `.env.example` or documented env var list. No structured logging (25 raw
`console.*`), no error tracking, no usable HTTP health endpoint (`system.health`
requires a superjson-encoded input and checks no dependency). No helmet or security
headers; no CORS configuration. No robots.txt, sitemap, canonical URLs, or Open Graph
tags; no SSR, and the bilingual app serves a static `lang="en"` to every crawler.
`client/public/__manus__/debug-collector.js` would be copied into the production build.

A database migration runbook exists (`BUILDHUB_DATABASE_MIGRATION_RUNBOOK.md`) and
states honestly that it has been proven in a sandbox but **not executed against
staging or production**. There is no deployment runbook.

## 13. `project.spent` dependency — **NEEDS BUSINESS DECISION** (unchanged)

Two independent quantities are presented to the same homeowner as cost-to-date:

1. `projects.spent` — a stored scalar, writable only through `projects.update`, which
   **no client code ever writes**. In practice it is permanently `0.00` for every
   project created through the UI. Displayed as **"Total Spent"** on the homeowner
   dashboard and role platform, and used as the numerator of the budget-utilisation bar.
2. `SUM(expenses.amount)` — a live client-side rollup of the itemised expense log,
   displayed as **"Budget Used"** on the project detail page.

Neither derives from the other. `projects.addExpense` never touches `projects.spent`;
there is no trigger, generated column, or reconciliation job.

Two further complications make this non-mechanical: `expenses.currency` is per-row
(default EGP, unvalidated) while `projects.spent` has no currency at all, so a naive
`SUM` would add mixed currencies; and `projects.spent` accepts an arbitrary number
with no relation to `budget` or the log, so it can exceed budget or go negative.

Choosing either direction silently redefines a live number on two screens for every
existing project. **Not guessed. Blocks nothing in the current slice.**

## 14. Payment-provider abstraction requirements — **ALREADY COMPLETE / BLOCKED**

The abstraction is in place and correctly shaped (§7). What Phase 4B.5 needs from the
owner, unchanged: a Paymob sandbox merchant account; its API key, integration ID(s),
iframe ID and HMAC secret supplied via environment or secret store; network allowlist
entries for the Paymob domains; and a publicly reachable webhook endpoint.

One thing the provider integration will need that can be built **now**: the
provider-event idempotency table (§8), which is what makes retried webhooks safe.

## 15. Exact implementation sequence — recommended

| Order | Work | Rationale |
|---|---|---|
| **1** | **Critical hardening (A1–A9)** | Small, surgical, high severity. Nothing should be deployed before these. |
| 2 | **Make billing reachable** | Highest business value per unit of risk; the server side is already built and tested. |
| 3 | **Billing spec gaps** — history record + idempotency table | Required by the brief; unblocks 4B.5's webhook safety. |
| 4 | **Honesty fixes** — remove fabricated fallbacks, fix the analytics tag, label inert settings | Small, and removes the risk of the owner making decisions on invented numbers. |
| 5 | **Production infrastructure** — CI, `.env.example`, health endpoint, logging, helmet, metadata | Required before staging. |
| 6 | **Authorization sweep + A10** | Systematic, across all 114 procedures. |

Deferred: analytics event framework (design after the business events settle);
featured placement (forbidden by the current stop condition); anything needing Paymob.

---

## Classification Summary

| # | Item | Classification |
|---|---|---|
| 1 | Monetization implementation | ALREADY COMPLETE |
| 2 | Subscription models | ALREADY COMPLETE |
| 3 | Vendor plan logic | ALREADY COMPLETE |
| 4 | RFQ / lead infrastructure | ALREADY COMPLETE |
| 5 | Admin capabilities | PARTIAL — NEEDS IMPLEMENTATION |
| 6 | Analytics | PARTIAL — NEEDS IMPLEMENTATION |
| 7 | Payment-related code | BLOCKED BY PAYMENT PROVIDER |
| 8 | Database changes | NEEDS IMPLEMENTATION |
| 9 | Entitlement changes | NEEDS BUSINESS DECISION |
| 10 | Security changes | NEEDS IMPLEMENTATION (urgent) |
| 11 | Testing gaps | PARTIAL — NEEDS IMPLEMENTATION |
| 12 | Production readiness | NEEDS IMPLEMENTATION |
| 13 | `project.spent` | NEEDS BUSINESS DECISION |
| 14 | Provider abstraction | ALREADY COMPLETE / BLOCKED |
| 15 | Implementation sequence | delivered above |

**Vendor-facing UI for billing: NEEDS IMPLEMENTATION** — the single largest gap
between what is built and what a customer can use, and entirely unblocked.

---

## Report

**STATUS — PASS WITH CONDITIONS.** The monetization architecture is in better shape
than the brief assumes; the production posture is in worse shape than any previous
phase revealed.

**BLOCKERS.** None for the next slice. Payment activation remains blocked on Paymob
(external). Two business decisions (§9, §13) block nothing currently in flight.

**RISKS.**
1. A1 is the most serious finding in this audit: a deployment with a missing
   `JWT_SECRET` starts normally and signs sessions with an empty key.
2. Fabricated admin analytics could lead the owner to make business decisions on
   invented numbers.
3. No CI means nothing prevents a regression from reaching a branch.
4. Four paid entitlements have no feature behind them (§9).

**NEXT ACTION.** Critical hardening, A1–A9, each with a regression test.
