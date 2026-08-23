# BuildHub — Phase 4B Final Blocker Authorization

Branch: `claude/phase4b-final-blocker-authorization`, created from `claude/phase4a-final-gate` @ `2cd8af3e5c89aa309e17e813f1bca59f0ffc1c20` (the latest approved Phase 4A baseline, per instruction — not from the two prior discovery-only Phase 4B branches, since neither of those changed the approved baseline). This document covers **READ → TARGETING DESIGN → PAYMOB FINAL VERIFICATION → READINESS DECISION → IMPLEMENTATION PLAN** only. **No implementation was performed.** No schema migrated, no code written, no credentials configured, no Paymob objects created.

---

## 1. Qualified-enquiry implementation design

### 1.1 What was inspected (READ)

- **Provider roles** (`providerRoles` constant, `server/routers.ts`): exactly 5 — `contractor, engineer, architect, supplier, project_manager`. A single coarse enum per vendor account, no sub-specialization field.
- **Product/service categories**: `products.category`/`products.subCategory` exist but are scoped to the `supplier` role's own marketplace catalog only (`marketplaceRouter`) — not a general vendor-service taxonomy, and not usable for contractor/engineer/architect/project_manager categorization at all. **Also newly noticed while re-inspecting this router for this task**: `marketplaceRouter.list` accepts a `category` input parameter but never applies it to the query — an existing, unrelated, pre-Phase-4B bug, out of this task's scope, not touched here, noted only for transparency.
- **RFQ category data** (`rfqs.category`): a free-text `varchar(100)`, nullable. In practice constrained by the only UI path that writes it — the RFQ-creation form's fixed 9-value dropdown: `Materials, Labor, Complete Project, Engineering, Design, Furniture, Maintenance, Renovation, Custom Services` (`client/src/pages/RFQPage.tsx`'s `CATEGORIES` constant) — but this is a **client-side-only** constraint; `rfq.create`'s Zod schema accepts any string, and nothing server-side validates it against this list.

### 1.2 The core design problem, restated precisely

There is no existing, reliable data connecting a **profession** (`contractor`, `engineer`, ...) to a **project-type category** (`Renovation`, `Design`, ...) — they are two different taxonomies that were never designed to cross-reference each other. Building a role→category mapping table would require BuildHub (or me) to assert domain claims like "an `engineer` account is eligible for `Design` RFQs but not `Furniture` RFQs" — genuine business/product classification, not an engineering inference, and exactly what I was told not to invent in the prior addendum.

### 1.3 Recommended minimum mechanism: vendor self-declared categories, not an invented role↔category table

Rather than inventing the mapping's *content*, the smallest safe design puts the classification in the hands of the party who actually knows it — the vendor:

```
vendorCategories (new table)
  id         int PK
  userId     FK -> users.id, onDelete: restrict
  category   varchar(100)   -- one of the same 9 values already defined in RFQPage.tsx's
                             -- CATEGORIES constant, promoted to a single shared source of
                             -- truth (see 1.6) instead of being duplicated
  createdAt
  unique index on (userId, category)
```

A vendor selects, from the **same existing 9-value list** already shown to homeowners when they create an RFQ, which categories describe the work they do (multi-select — see 1.5). No new vocabulary is invented; the existing RFQ-creation taxonomy is reused for both sides of the match, so a homeowner's "Renovation" RFQ and a vendor's "Renovation" self-tag compare by exact string equality — no fuzzy matching, no inferred professional-to-category mapping, nothing guessed.

This satisfies "deterministic, explainable, and based only on data that BuildHub can reliably maintain" more strictly than a role-based mapping would: BuildHub does not need to correctly guess an entire industry's specialization patterns — it needs only to let each vendor state their own.

### 1.4 Exactly how an RFQ becomes eligible for a vendor

```
An RFQ is eligible for a vendor if:
  vendor.userRole ∈ providerRoles                          (existing gate, unchanged)
  AND vendor.onboardingStatus === 'approved'                (existing gate, unchanged)
  AND (
    rfq.category IS NULL
    OR rfq.category = ''
    OR rfq.category ∈ (vendor's declared vendorCategories)  (new)
  )
  AND rfq.status = 'open'                                   (existing field, unchanged)
```

### 1.5 Vendors with multiple relevant categories

Trivial by construction: `vendorCategories` is a one-to-many table, so a vendor may declare as many of the 9 categories as apply. Eligibility is an OR across all of them — an RFQ matching *any* declared category is eligible. No new logic needed beyond the join itself.

### 1.6 RFQs with insufficient classification data — recommendation, not a silent decision

Today, `rfqs.category` is optional and a meaningful fraction of RFQs may have no category at all. Two options, with a recommendation:

- **Option A (recommended)**: treat an uncategorized RFQ as eligible for *every* approved provider (fail open toward visibility) — a real customer's request should not become invisible to every vendor merely because an optional field was skipped. This is the default in the eligibility rule above (`rfq.category IS NULL OR ''` → eligible for all).
- **Option B**: treat an uncategorized RFQ as eligible for *no one* until categorized (fail closed) — simpler to reason about, but risks silently starving real customer requests of any vendor attention.

Alongside this, **going forward**, `rfq.create`'s Zod schema should require `category` (`z.string().min(1)` instead of `.optional()`), reusing the same 9-value list, validated against it rather than accepting arbitrary text — so the gap shrinks over time instead of growing. This is a one-line validation change with no migration implications for existing rows. **This entire subsection is a recommendation for approval, not a decision made on the business's behalf** — per the instruction to report the exact configuration needed rather than invent it.

### 1.7 One shared source of truth for the category list (closing a small but real risk)

Currently the 9-category list exists only as a client-side constant in `RFQPage.tsx`. Recommend promoting it to `shared/` (the same directory pattern already used for `shared/const.ts`, `shared/compliance.ts`, `shared/projectFeatures.ts`) as a single exported array, imported by both the RFQ-creation form and the new vendor-category-selection UI — so the two taxonomies can never drift apart by one file being edited without the other.

---

## 2. Required schema/data changes

Exactly one new table, additive only, no change to any existing table:

```
vendorCategories
  id         int PK autoincrement
  userId     int NOT NULL, FK -> users.id (onDelete: restrict, onUpdate: restrict — matching
             the Phase 3C convention already used throughout the schema)
  category   varchar(100) NOT NULL
  createdAt  timestamp defaultNow
  unique index on (userId, category)
  index on category  (for the eligibility join's WHERE category = ? direction)
```

Plus, from the entitlement-counting design (§3): `enquiryUsage` (already scoped in the original readiness report, §7.1) — a monthly counter table, and one new dedup table (§3.3) to make counting idempotent. Both additive, both already anticipated in the architecture, neither requires touching `users`, `rfqs`, or any Phase 3C-protected table.

---

## 3. Entitlement counting design

### 3.1 What "consuming" a qualified enquiry means

The approved definition describes *availability*, not action — so the design must gate **access to full RFQ detail**, not quoting behavior (already correctly excluded by the approved definition) and not mere list-browsing (counting every list-page load would exhaust a Free vendor's monthly allowance just by having the page open, which does not match "genuine opportunities available to the vendor" as a meaningful gate). The consumption event is: **a vendor requests the full detail of one specific eligible RFQ, for the first time this calendar month.**

### 3.2 Monthly reset behavior

```
enquiryUsage
  id        int PK
  userId    FK -> users.id, onDelete: restrict
  yearMonth varchar(7)   -- '2026-08', computed server-side from the current date, never
                          -- client-supplied
  count     int default 0
  unique index on (userId, yearMonth)
```
The counter is scoped to `(userId, yearMonth)` — there is no explicit "reset" operation to run; a new month simply has no row yet, and the first consumption event of that month creates one starting at 1. This avoids a scheduled job needing to zero out counters (nothing to forget to run), and makes historical usage-by-month trivially queryable for the billing-analytics funnel already scoped in the original readiness report.

### 3.3 Guaranteeing the same RFQ is never counted twice (refreshes, duplicate calls, UI double-clicks)

```
enquiryConsumptions
  id        int PK
  userId    FK -> users.id
  rfqId     FK -> rfqs.id
  yearMonth varchar(7)
  createdAt timestamp defaultNow
  unique index on (userId, rfqId)   -- NOT per-month: once a vendor has unlocked a given
                                     -- RFQ's detail, re-viewing it in a later month must
                                     -- never re-charge them for the same lead
```
Request flow for "view RFQ detail":
```
1. Confirm eligibility (§1.4).
2. Check enquiryConsumptions for (userId, rfqId) — if a row already exists, serve the detail
   immediately, no counter change (idempotent: a refresh, a duplicate double-click, or a
   second tab all resolve to the same already-unlocked state, matching the exact "insert ...
   ON DUPLICATE KEY" dedup pattern already used by this codebase's revokeSession/webhook-style
   idempotency, per the original readiness report's §7.6).
3. If no row exists: check the vendor's current-month usage against their plan's
   enquiryAllowance (§3.4). If under the limit (or unlimited/Premium), insert into
   enquiryConsumptions AND increment enquiryUsage.count in the same transaction, then serve
   the detail. If at the limit, return a clear "upgrade to see more" response — never a
   silent partial result.
```
The `unique index on (userId, rfqId)` in `enquiryConsumptions` is what makes step 2 airtight regardless of how many times the request is retried, refreshed, or fired from multiple tabs — the database itself, not application-level debouncing, is what prevents double-counting.

### 3.4 Server-authoritative enforcement

The limit check reads `PLAN_ENTITLEMENTS[currentPlan].enquiryAllowance` (already designed in the original readiness report, §7.7) and the live `enquiryUsage` row inside the same tRPC procedure that serves the RFQ detail — never a value cached in a JWT, never a count trusted from the client. This is the same "always re-fetch, never trust client state" discipline already proven for account-status re-checking in Phase 4A.6.8 and reused throughout this architecture.

### 3.5 What is explicitly NOT counted (confirmed against the approved rule)

Quotations submitted, messages sent, page views of the RFQ *list* (as opposed to a specific RFQ's detail), and any client-side event are all excluded by construction — the only write path to `enquiryUsage`/`enquiryConsumptions` is the server-side detail-fetch procedure in §3.3, and nothing else in the codebase touches these tables.

---

## 4. Paymob verification matrix

**Environment constraint, stated plainly and acted on per instruction**: this session has no Paymob account, API key, or sandbox credentials of any kind. Per the explicit instruction — "if access to the required Paymob test account is unavailable: STOP the payment integration portion and report exactly what information/account access is required. Do not fabricate credentials or test results" — **no row in this table can be marked TEST-ACCOUNT-VERIFIED.** That column is included so the distinction is visible, not omitted.

This pass fetched primary-source material directly where the egress proxy allowed it (Paymob's own official GitHub organization — `github.com/PaymobAccept`) rather than relying only on search-result summaries, which is a meaningfully stronger evidence tier than the prior two reports used. `paymob.com` and `developers.paymob.com` themselves remain blocked by this sandbox's proxy for direct fetching.

| Capability | Status | Evidence |
|---|---|---|
| Recurring subscriptions | DOCUMENTATION-CONFIRMED | Paymob's own GitHub repo (`PaymobAccept/API-Postman-Collections`), fetched directly this pass: "Subscription Module... recurring billing, supporting weekly, bi-weekly, monthly, quarterly, and annual cycles" |
| Tokenization | DOCUMENTATION-CONFIRMED | Same repo: tokens generated "after a successful 3DS transaction," enabling saved-card/one-click charges — **new integration detail this pass**: tokenization is gated on a completed 3DS challenge, relevant to designing the first-charge/checkout flow |
| EGP billing | DOCUMENTATION-CONFIRMED | Consistent across all sources this and the prior pass; Paymob is an Egypt-native PSP |
| 30-day trial | NOT VERIFIED | No source found (this pass or prior) documents a native trial-period parameter on a subscription plan. Architecture continues to model trial application-side regardless (delay first charge, do not depend on provider-native trial semantics) — this NOT VERIFIED status does not block the design, only confirms the fallback approach is the right one to rely on |
| Recurring renewal | DOCUMENTATION-CONFIRMED | Same subscription module source |
| Failed-payment handling / retry behavior | DOCUMENTATION-CONFIRMED (mechanism exists) / NOT VERIFIED (exact default cadence) | Confirmed this pass, directly from Paymob's own repo: plan creation supports "retrial logic and reminder days for failed payments" — the mechanism is real; the specific default retry count/spacing is not stated in any source found and remains unconfirmed |
| 7-day grace-period compatibility | DOCUMENTATION-CONFIRMED (compatible by design) | The architecture's `graceEndsAt` deadline is independent of provider retry timing by design (§5 of the prior addendum) — compatible regardless of Paymob's exact retry cadence, so this doesn't block on the NOT VERIFIED item above |
| Cancellation | DOCUMENTATION-CONFIRMED | Same repo, explicit this pass: subscriptions can be "suspend[ed], resume[d], or cancel[ed] programmatically" — cancel confirmed as its own lifecycle action, not merely inferred from suspend/resume as the prior report phrased it |
| Refunds | DOCUMENTATION-CONFIRMED | Same repo: "Refund & Void & Capture" collection, full/partial reversal |
| Webhook delivery | DOCUMENTATION-CONFIRMED (from a different, previously-found source) / NOT CONFIRMED IN THIS PASS'S DIRECT FETCH | The Postman-collection repo fetched directly this pass does not itself mention webhooks (noted explicitly by the fetch). The HMAC webhook page (`developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac`) was identified by search in the prior pass but could not be fetched directly (domain blocked) — its existence as a real, named documentation page is good evidence, but this pass could not independently re-confirm its contents first-hand |
| Webhook authentication/signature validation | DOCUMENTATION-CONFIRMED (search-derived, not re-verified this pass) | HMAC-SHA512 process described in the prior report — unchanged, not independently re-fetched this pass |
| Idempotency requirements | NOT VERIFIED | No source, either pass, confirms whether Paymob's webhook delivery includes its own event-id for dedup, or guarantees at-least-once delivery. The architecture does not depend on this being confirmed — §3.3 and the original readiness report's §7.6 idempotency design is enforced entirely on BuildHub's own side (a dedup table keyed by the provider's event id, if present, or by a derived idempotency key otherwise), which is the correct posture regardless of what Paymob itself guarantees |
| Subscription status synchronization | DOCUMENTATION-CONFIRMED (webhooks exist as the mechanism) / NOT VERIFIED (exact event payload/types) | The general transaction-callback mechanism is confirmed (prior pass); the specific event *names* and payload shape for subscription-specific state changes (e.g., is there a `subscription.canceled` event distinct from a generic transaction callback?) were not found in either pass |
| Billing-period information | NOT VERIFIED | No source examined states whether a subscription object exposes its own `current_period_end` equivalent, or whether BuildHub must compute it from the billing interval itself |
| Sandbox/test capability | DOCUMENTATION-CONFIRMED | Confirmed both passes: test/live mode via different API keys on the same regional base URL |
| Merchant/account requirements | DOCUMENTATION-CONFIRMED (general) / NOT VERIFIED (BuildHub-specific) | General KYC/company-registration requirements confirmed via third-party sources (prior pass); the exact document checklist for a BuildHub merchant account specifically was not found and would need direct contact with Paymob |
| Settlement requirements | DOCUMENTATION-CONFIRMED | Confirmed prior pass: Paymob Accept dashboards, settlement/refund/payout reports, reconciliation explicitly accounting for subscriptions |
| API limitations | NOT VERIFIED | No rate limits, plan-count limits, or other API constraints were found in either pass |

**Summary**: every core lifecycle capability required by the approved subscription model (recurring billing, tokenization, retry/dunning mechanism, cancellation, refunds, sandbox) is **DOCUMENTATION-CONFIRMED** from Paymob's own published material, now including a direct fetch of Paymob's own GitHub-hosted documentation rather than search summaries alone. **Zero items are TEST-ACCOUNT-VERIFIED**, because no test account exists in this environment. Several second-order details (exact retry cadence, webhook event payload shapes, idempotency guarantees, BuildHub-specific onboarding checklist) remain genuinely unconfirmed and are exactly the kind of detail that requires either primary-documentation access this sandbox cannot reach, or a real account.

**Exactly what is needed to close this gap**: a Paymob sandbox/test merchant account (email/password or API test key issued by Paymob after a lightweight signup, typically self-service for test mode per the "test and live use the same regional base URL, mode controlled by keys" pattern already confirmed) would let a follow-up session directly exercise: creating a subscription plan and confirming the actual retrial/reminder configuration options, triggering a real test-mode webhook and inspecting its payload/event-type, and confirming the current-period/renewal-date fields a subscription object actually returns. **This is the exact account access this report is stopping to request, per instruction, rather than fabricating results for.**

---

## 5. Remaining blockers

1. **Paymob test/sandbox account access** — the only hard blocker. Everything else in this report is now fully specified.
2. **Approve or amend the two recommendations in §1.6** (uncategorized-RFQ fail-open behavior, and making `category` required going forward) — low-stakes, quick to confirm, not a redesign trigger either way.
3. Carried forward, unchanged, from the prior addendum and not touched by this task (out of scope per "do not reopen unrelated work"): founder annual pricing (flagged, not decided), and the portfolio/multi-branch/multi-team feature-messaging decision.

---

## 6. Final Phase 4B readiness decision

Evaluating the two gate criteria exactly as specified:

**A. Is the qualified-enquiry targeting architecture technically defined and implementable?** **Yes.** §1–3 give a complete, deterministic, server-authoritative, idempotent design using one new small table (`vendorCategories`) plus the two usage-tracking tables already anticipated in the original architecture — no invented business mapping, no AI, no scoring system, exactly the minimum the task authorized.

**B. Has Paymob test/sandbox capability been sufficiently verified for the required subscription lifecycle?** **No.** Every capability is documentation-confirmed from primary-ish sources (including a direct fetch of Paymob's own GitHub documentation this pass), but zero capabilities are test-account-verified, because no test account exists in this environment. Per the explicit instruction, this is reported rather than glossed over or fabricated.

# PHASE 4B — NOT READY

**Exact remaining blocker: Paymob sandbox/test merchant account access.** This is the only item blocking a READY classification — the targeting architecture (criterion A) is fully resolved, and every other blocker from the prior two reports has now been closed.

---

## 7. Exact Phase 4B implementation sequence (prepared for when both criteria are met)

Per the newly-specified 9-phase structure, each with its own isolated branch, explicit scope, tests, `tsc`, production build, security verification, regression verification, final report, and stop condition — no phase combined with another, none skipped:

| Phase | Scope | Depends on |
|---|---|---|
| **4B.1** | Billing/domain foundation — `plans`, `planPrices`, `vendorSubscriptions`, `billingEvents`, `processedWebhookEvents` schema; the provider-agnostic `PaymentProviderAdapter` interface (no real adapter yet) | Nothing outstanding |
| **4B.2** | Plan and entitlement system — `PLAN_ENTITLEMENTS`, `entitledProcedure` middleware, founder-offer eligibility/expiration logic (§3–4 of the prior addendum) | 4B.1 |
| **4B.3** | Real vendor directory + targeting — the `marketplaceRouter.vendors` endpoint (prior addendum §6), `vendorCategories` table and self-declaration UI, the RFQ-eligibility join (§1.4 of this report), `enquiryUsage`/`enquiryConsumptions` (§2–3 of this report) | 4B.1, 4B.2 |
| **4B.4** | Subscription lifecycle — trial, renewal, cancellation, failed-payment/grace-period state machine, all against the adapter interface (no real provider calls yet, or against a mocked adapter) | 4B.1, 4B.2 |
| **4B.5** | Payment provider integration — the real `PaymobAdapter`, checkout, webhook endpoint and signature verification, wired to 4B.4's state machine | **Blocked on Paymob test-account access (§5)** |
| **4B.6** | Featured placement — `featuredPlacements` table, the organic-vs-paid separation design (prior addendum §7) | 4B.3, 4B.2 |
| **4B.7** | Admin billing controls — subscription visibility (allowlisted, no credentials), manual refund authorization, founder-offer oversight | 4B.1, 4B.5 |
| **4B.8** | Commercial analytics — the funnel/KPI set from the original readiness report §21, derived via query-time aggregation over the now-real billing tables, not a new event-log architecture | 4B.1–4B.7 |
| **4B.9** | Full billing/security/E2E audit — the complete test matrix from the original readiness report §25 (trial, renewal, failed payment, cancellation, refund, duplicate/replayed webhook, cross-vendor isolation, founder pricing, annual pricing, Arabic/RTL, mobile, regression) | All prior 4B phases |

4B.1–4B.4 and 4B.6–4B.8 do not depend on Paymob access and could, if the owner wishes, proceed once authorized — only **4B.5** (and, transitively, the parts of 4B.7/4B.9 that require a real payment flow to test against) is blocked on the account-access gap in §5.

---

**STOP.** No implementation performed. Awaiting Paymob test-account access (or an alternative provider decision) and confirmation of §1.6's two recommendations before any 4B phase begins.
