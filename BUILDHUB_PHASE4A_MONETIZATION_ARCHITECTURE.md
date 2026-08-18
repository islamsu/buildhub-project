# BuildHub — Phase 4A: Monetization & Payment Architecture Discovery

**Mode: READ-ONLY.** No application code, schema, database, dependency, secret, or deployment was modified to produce this report. No Stripe, SendGrid, or Twilio configuration of any kind was performed.

Method: every claim below about "what exists" is sourced from direct reads of `drizzle/schema.ts`, `server/routers.ts`, and the relevant `client/src` pages/data files, cross-checked against `BUILDHUB_BASELINE.md`, `CLAUDE_HANDOFF.md`, `BUILDHUB_TAKEOVER_REPORT.md`/`CLAUDE_ENGINEERING_AUDIT.md.md` (identical content), and the Phase 3C/3C.1/checkpoint reports. Per instruction, where documentation and source code disagree, source code wins and the discrepancy is called out explicitly — this repo has a well-documented history (see `BUILDHUB_TAKEOVER_REPORT.md` §16) of prior audit documents asserting functionality that doesn't exist, and that pattern continues in the two still-uncorrected baseline docs (§1 below).

---

## 1. Current monetization status

Every item below was checked directly against `server/routers.ts` and `drizzle/schema.ts` (zero foreign keys/payments-shaped tables exist per Phase 3C's full 20-table schema read) — not inferred from labels or prior reports.

| Item | Status | Evidence |
|---|---|---|
| Vendor subscriptions | **NOT IMPLEMENTED** | No `subscriptions`/`plans` table exists anywhere in `drizzle/schema.ts` (20 tables total, all enumerated in Phase 3C). No code path checks a subscription state before granting access. |
| Customer subscriptions | **NOT IMPLEMENTED** | Same — no schema, no code. |
| Free vendor accounts | **IMPLEMENTED (by default, not by design choice)** | Every vendor role (`contractor`, `engineer`, `architect`, `supplier`, `project_manager`) that clears compliance review (`onboardingStatus === 'approved'`) gets unlimited access via `approvedProviderProcedure` — there is no paid tier to compare it to, so "free" isn't a deliberate product decision, it's the only tier that exists. |
| Paid vendor accounts | **NOT IMPLEMENTED** | No payment gate anywhere in the provider-approval or access-granting code path. |
| Featured vendor listings | **NOT IMPLEMENTED** | No `featured` (or equivalent) column exists on `users` at all. There is no concept of a featured *vendor* anywhere in the schema or code. |
| Featured services/products | **PARTIALLY IMPLEMENTED** | `products.featured` is a real boolean column; `marketplace.list` sorts by `desc(products.featured)` (`server/routers.ts:375`); `Marketplace.tsx` renders a real bilingual "Featured"/"مميز" badge when `product.featured` is true. **But no mutation anywhere in the entire codebase ever sets `featured: true`** — not in `marketplace.create` (which spreads validated Zod input, and `featured` isn't part of that input schema), not in any admin mutation. The display/sort machinery is fully wired up; the mechanism to actually activate it — paid or free — does not exist. This is inert, not broken. |
| Premium placement | **NOT IMPLEMENTED** | No ranking-boost mechanism beyond the inert `featured` flag above. |
| Lead fees | **NOT IMPLEMENTED** | `submitQuotation` (the vendor's "respond to a lead" action) has zero count/quota/payment check — confirmed by reading the full mutation; any approved provider can submit unlimited quotations to unlimited RFQs at no cost. |
| RFQ access fees | **NOT IMPLEMENTED** | `rfq.list`/`rfq.get` have no payment gate. |
| Quotation fees | **NOT IMPLEMENTED** | Same as lead fees above. |
| Transaction commissions | **DOCUMENTED ONLY — inert admin setting, not a working feature.** | `commissionPercent: '5'` and `transactionFeePercent: '2.5'` exist as default values in `DEFAULT_ADMIN_SETTINGS` (`server/routers.ts:725-726`) and as two numeric input fields in the admin settings UI (`AdminDashboard.tsx:63-64`). An admin can type a number into these fields and it will persist to `adminSettings`. **Nothing in the codebase ever reads either value to calculate, display, or charge anything.** This is a settings placeholder that was scaffolded for a monetization model that was never built — worth noting as a specific, concrete signal of *prior intent* (see §2 discussion below), not as working functionality. |
| Customer service fees | **NOT IMPLEMENTED** | No such concept anywhere. |
| Vendor service fees | **NOT IMPLEMENTED** | No such concept anywhere. |
| Advertising | **NOT IMPLEMENTED** | No ad-serving, ad-slot, or sponsored-content model anywhere. |
| Sponsored listings | **NOT IMPLEMENTED** | Same as featured placement above — no activation mechanism exists. |
| Payment for completed projects | **NOT IMPLEMENTED** | `quotations.paymentTerms` is a free-text field the provider fills in when quoting (e.g., "50% upfront, 50% on completion") — this is descriptive metadata shown to the customer, not a payment mechanism. No money ever moves through BuildHub for project work today. |
| Escrow | **NOT IMPLEMENTED** | No holding-account concept, no Stripe Connect, nothing. |
| Deposits | **NOT IMPLEMENTED** | Same. |
| Milestone payments | **NOT IMPLEMENTED** | `milestones` is a real table, but it is a pure project-scheduling construct (`title`, `dueDate`, `status`, `progress` — no `amount`, no payment linkage of any kind). Do not confuse this with payment milestones; they are unrelated concepts that happen to share a name. |

**The one significant discrepancy between documentation and reality, restated because it directly bears on this phase's scope:** `BUILDHUB_BASELINE.md` §5 states *"Stripe — Subscriptions & payments — Implemented in code"* and *"Email/SMS — Notifications — Backend triggers active"*, and its architecture section (§3) even lists "subscriptions" as an existing table in `drizzle/schema.ts`. **All three claims are false**, confirmed by direct source read (Phase 3C's full schema enumeration, and this phase's fresh grep of the entire `server/` tree for `subscription`/`stripe`/`payment` implementation — zero hits beyond the inert settings field above). This is not a new finding — `BUILDHUB_TAKEOVER_REPORT.md` §12 and §16 documented the same pattern across five *other* now-superseded audit files. `BUILDHUB_BASELINE.md` and `CLAUDE_HANDOFF.md` were never corrected and still carry it. Per this phase's explicit instruction, source code is authoritative; these two docs are wrong on this point and should not be used as a monetization reference.

---

## 2. Current product/business model

BuildHub, as actually built, is a **construction marketplace and project-management tool**, not a payments platform. The real, working core loop is: homeowner posts an RFQ (optionally linked to a project and a marketplace product) → approved providers submit quotations → homeowner accepts one (now correctly transactional and IDOR-safe as of Phase 1) → the parties presumably settle payment for the actual construction work **entirely outside BuildHub** (there is no code path where BuildHub ever touches that money) → the homeowner can later leave a review, and the platform gives them project-management tooling (milestones, tasks, daily logs, expenses, documents, progress reports) to run the job.

This shape — connect buyer and seller, let them negotiate and transact off-platform, monetize the connection itself rather than the transaction — is structurally closer to a lead-generation/directory marketplace (Thumbtack, Bark, Houzz Pro) than to a transactional marketplace (Upwork, Airbnb) that needs to move money between parties. The existence of the *inert* `commissionPercent`/`transactionFeePercent` admin-settings fields suggests someone earlier in this project's history considered a commission model and scaffolded a settings slot for it, but never built the calculation, collection, or payout logic — so this is a signal of prior *intent*, not of an actual architectural commitment either way.

**A UI/data discrepancy worth flagging explicitly, since the phase asks what the UI "suggests":** `client/src/lib/marketplaceData.ts` (per this engagement's own working notes on the Marketplace Hub feature) defines static catalog data for `Designer` and `FinishingCompany` entity types, rendered via dedicated directory pages (`DesignersDirectory.tsx`, `FinishingDirectory.tsx`). **Neither `designer` nor any "finishing company" role exists in the real `users.userRole` enum** (`homeowner | contractor | engineer | architect | supplier | project_manager | admin` — confirmed from `drizzle/schema.ts`). These directory pages present as if BuildHub has real, accountable designer/finishing-company marketplace participants; in fact they render fixed catalog data with no login, no compliance gating, no quotation capability, and no connection to the real user/RFQ/quotation system at all. Any monetization model involving "designers" or "finishing companies" as paying actors would require building an entirely new actor type from scratch — it is not a small gap in an existing actor, it's a UI concept with no backing account system.

---

## 3. Marketplace actors

| Actor | Value received today | Actions performed | Should they pay? | Should they receive money? | Payment trigger candidate |
|---|---|---|---|---|---|
| **Customer/Homeowner** | Free access to post RFQs, compare quotations, run project-management tooling, message providers, leave reviews | `projects.create`, `rfq.create`, `rfq.acceptQuotation`, `reviews.submit`, project-management CRUD | Only for genuinely optional value-adds (see Model E) — not for baseline marketplace access, which is the demand side vendors are paying to reach | No | N/A under the recommended model (§5) |
| **Vendor/Service Provider** (contractor, engineer, architect, supplier, project_manager — all real `userRole` values) | Unlimited free access to leads (RFQs), unlimited free quotation submission, a marketplace product catalog for suppliers | `compliance.uploadDocument`, `rfq.submitQuotation`, `marketplace.create` (suppliers), `projects.directory` browsing | **Yes — this is the natural paying side of a lead-generation marketplace** | No, under the recommended model | Subscription renewal date; usage over a free-tier limit |
| **BuildHub (platform)** | N/A | Compliance review/approval, dispute resolution, admin settings, content moderation | N/A | **Yes — this is the platform operator** | Subscription payments from vendors |
| **Admin** | Operational tooling access | User/compliance/dispute management, settings | No (internal role) | No (internal role) | N/A |
| **"Designer" / "Finishing company"** | Presented to browsing users as catalog entries | None — static data, no account, no login (§2) | Not applicable until this becomes a real account type | Not applicable | N/A until built |

---

## 4. Monetization models — independent evaluation

### Model A — Vendor Subscription
A vendor pays BuildHub periodically for marketplace access. This maps directly onto the actor analysis in §3: vendors are the only actor currently receiving ongoing, repeated, unlimited value (unlimited lead access, unlimited quoting) with zero cost today. A free tier with a low RFQ/quotation cap plus a paid tier removing the cap is a natural, low-friction fit — it doesn't require touching the customer experience at all, and it doesn't require BuildHub to ever hold customer money. Trial period is straightforward (time-boxed or first-N-leads-free). Featured placement and premium analytics are natural paid add-ons given the already-half-built `featured` mechanism (§1) and the admin's existing `analyticsSummary` endpoint (currently free/admin-only, could become a vendor-facing paid feature).

### Model B — Transaction Commission
BuildHub takes a cut when a customer selects a vendor. This requires BuildHub to either collect the customer's payment and remit a share to the vendor (needs Stripe Connect or equivalent — see §7), or to invoice the vendor for a commission on a transaction BuildHub never actually touched (much harder to enforce — vendor and customer have every incentive to settle off-platform and not report it, since BuildHub has no visibility into whether/when the actual construction payment happened). Given the current product has **no mechanism to observe whether a project was ever actually paid for** (there's no "mark this quotation as paid" state — `quotations.status` only has `pending/accepted/rejected`), an honest commission model would require building that observability first, which is itself a significant product change beyond payments infrastructure.

### Model C — Lead/RFQ Fees
A narrower version of Model A — charge per-lead instead of a flat subscription. Technically simpler in one sense (no recurring billing lifecycle) but operationally harder to price fairly (a $50k renovation lead and a $200 repair lead are wildly different value, and BuildHub's RFQ schema doesn't reliably distinguish them upfront), and it creates worse cash-flow predictability for BuildHub than a subscription. Reasonable as a *credit-based add-on* inside a subscription model, not as a standalone replacement for it.

### Model D — Featured/Premium Listings
Directly buildable on top of the already-partially-implemented `products.featured` mechanism (§1) for the supplier/product side; would need net-new schema for a vendor-level equivalent (there is currently no way to feature a *vendor*, only a *product*). Works best as a subscription-tier perk or an à la carte add-on, not as a primary monetization model on its own — on a marketplace this size, there likely aren't enough competing vendors per category yet for "featured" placement to carry meaningful standalone price, but it's a legitimate secondary lever once Model A is running.

### Model E — Customer Service Fees
BuildHub currently gives customers a genuinely useful free toolset (RFQ comparison, project management). Charging customers directly adds adoption friction on the demand side of the marketplace — and marketplace liquidity depends on there being enough demand-side volume to make the vendor-paid model in Model A worth vendors' money. Charging customers should be evaluated later, as an optional premium layer (e.g., "concierge sourcing"), not as an MVP requirement — see §15's explicit instruction not to add customer payments just because Stripe exists.

### Model F — Marketplace Payment / Escrow
Customer pays BuildHub, BuildHub pays the vendor. This is the highest-complexity, highest-regulatory-burden option, and nothing about BuildHub's actual current workflow assumes it: `quotations.paymentTerms` is descriptive text the vendor writes for the customer's benefit ("50% upfront, 50% on completion"), which is exactly the pattern you'd expect from two parties who are going to settle payment directly with each other, not through a platform. Adopting escrow would mean BuildHub becomes a money transmitter (or uses Stripe Connect to avoid becoming one directly), taking on chargeback/dispute/regulatory exposure for transactions whose actual value (a real-world construction job) BuildHub has no way to verify, inspect, or arbitrate. **Escrow is not recommended, and is not assumed simply because this is a marketplace** — per this phase's explicit instruction not to make that assumption. It may become viable much later, if BuildHub ever needs to guarantee payment as a trust mechanism, but that's a future, separately-justified decision, not a Phase 4B default.

---

## 5. Recommendation

## RECOMMENDED MODEL: Model A (Vendor Subscription, tiered) as primary, with Model D (featured placement) as a secondary upsell layer inside the same subscription product. Model F (escrow) is explicitly not recommended for the current phase.

**Why:**

- **Matches the actual product today.** Vendors are the only actor receiving unlimited, ongoing, uncapped value with zero cost (§3). A subscription monetizes exactly that value, with no change to the customer experience and no new customer-facing friction (directly serving §15's instruction — customer payment is not required for this model).
- **Lowest regulatory/technical complexity of the viable options.** BuildHub never touches customer money, never needs Stripe Connect, never becomes a party to the actual construction transaction. This matters concretely for Egypt: Stripe only added Egypt to its "Global Payouts" cross-border payout mechanism in March 2026, and full Stripe Connect marketplace-payout support for Egyptian recipient accounts is not clearly established as of this report — a fact that should be independently reconfirmed against Stripe's current country-support documentation before any Connect-dependent model is chosen, but which today argues against building a payout-dependent model (Model B/F) as an MVP. [Stripe Global Payouts country expansion, March 2026](https://docs.stripe.com/changelog/dahlia/2026-03-25/cross-border-payouts-new-countries)
- **Predictable cash flow.** Recurring subscription revenue is far more forecastable than per-transaction commission on jobs BuildHub can't observe or enforce visibility into (§4, Model B).
- **Low refund/chargeback surface.** Subscription refunds are a solved, well-understood Stripe Billing problem (§16); there is no construction-job dispute risk bleeding into BuildHub's payment layer, because BuildHub was never a party to that payment.
- **Natural growth path.** A subscription tier structure (free → paid, with usage caps and featured-placement perks) can absorb Model C (lead credits) and Model D (featured listings) as tier differentiators or add-ons without re-architecting anything, once it exists.
- **Suitable for GCC expansion.** Subscription billing in USD or a GCC currency (with Stripe's multi-currency Prices) scales geographically far more easily than a commission/escrow model would, which requires new payout rail verification per country (as the Egypt situation above illustrates) each time BuildHub expands.

**Trade-off acknowledged, not hidden:** a subscription model requires enough vendor-side willingness to pay before there's proven ROI, which is a genuine vendor-adoption-friction risk on a marketplace that has been fully free to date. A generous free tier and trial period (§8/§9) are the mitigation, not a way around the fact that this is a business decision requiring owner sign-off (§18, item 2).

---

## 6. Payment flow (recommended model)

```
Vendor
   ↓ (subscribes/renews)
BuildHub  ←→  Stripe (Billing/Subscriptions)
```

No customer-side flow exists under this model — customers never pay BuildHub, and BuildHub never touches money exchanged between customer and vendor for the actual construction work (that stays exactly as it is today: negotiated via `quotations.paymentTerms`, settled entirely off-platform).

- **Who initiates payment:** the vendor, when subscribing or when a trial converts.
- **Who is charged:** the vendor's stored payment method, by Stripe, on the subscription's billing cycle.
- **When payment occurs:** at subscription creation (after trial, if any) and on each renewal date.
- **What confirms payment:** a `invoice.paid` (or `checkout.session.completed` for the initial purchase) webhook from Stripe — never a client-side confirmation, per §12.
- **After successful payment:** BuildHub updates the vendor's entitlement state (§9) to reflect the new/renewed tier, and the vendor regains/keeps `approvedProviderProcedure`-gated access at that tier's limits.
- **After failed payment:** subscription enters `past_due` (§8); vendor gets an in-app + email notice; entitlements are *not* immediately revoked (grace period, §8) to avoid punishing a vendor for a stale card during an active job.
- **After cancellation:** vendor keeps paid entitlements through the end of the already-paid billing period, then reverts to the free tier — never an abrupt mid-period cutoff, which would be a poor experience for a vendor mid-negotiation on a lead.
- **After refund:** entitlement is revoked immediately (a refund is BuildHub-initiated and rare — typically a billing-error correction, not a routine customer-service action) and the vendor reverts to the free tier.
- **After chargeback:** treat as more severe than a routine failed payment — freeze paid entitlements immediately and require the vendor to resolve the dispute with their bank before reinstating, since a chargeback (unlike a simple card decline) signals the vendor is actively disputing having authorized the charge.

---

## 7. Stripe architecture

| Product | Needed? | Why |
|---|---|---|
| **Stripe Billing / Subscriptions** | **Yes** | Core of the recommended model — recurring vendor subscriptions with defined Prices per tier. |
| **Stripe Checkout** | **Yes** | Lowest-integration-effort way to collect the vendor's payment method and start a subscription without BuildHub ever handling raw card data. |
| **Stripe Customer objects** | **Yes** | One per subscribing vendor, needed to attach payment methods, subscriptions, and invoice history. |
| **Stripe Products / Prices** | **Yes** | Model each subscription tier as a Stripe Product with one or more Prices (monthly/annual). |
| **Stripe Invoices** | **Yes (via Billing, not built standalone)** | Stripe generates these automatically as part of the Subscriptions lifecycle; BuildHub consumes them for the vendor billing-history view (§14), doesn't need to build invoicing itself. |
| **Stripe Payment Intents** | **Indirectly, via Checkout/Billing** | Not something BuildHub needs to orchestrate directly for a pure-subscription model — Checkout and Billing manage Payment Intents internally. Would become directly relevant only if a one-off charge (e.g., a lead-credit top-up, Model C) is added later. |
| **Stripe Webhooks** | **Yes** | The only trustworthy source of payment/subscription state truth — see §11. |
| **Stripe Customer Portal** | **Yes** | Covers most of §14's vendor billing UI (payment method update, invoice history, cancellation) with minimal custom UI work. |
| **Stripe Refunds** | **Yes, admin-initiated only** | For billing-error correction, not a self-service vendor action in the MVP. |
| **Stripe Connect** | **No — not recommended for this phase.** | Connect exists specifically to let a platform receive customer money and split/forward it to a third party (the vendor). Under the recommended model, BuildHub never receives customer money at all — vendors pay BuildHub directly for subscription access, and customers never pay BuildHub anything. There is nothing to "connect" or forward. Adopting Connect would only make sense if Model B or Model F were chosen instead, which this report explicitly does not recommend (§4/§5), partly *because* of Connect's added complexity and Egypt's unclear/limited current payout support. |

---

## 8. Subscription architecture

```
TRIAL → ACTIVE → PAST_DUE → CANCELED → EXPIRED
                     ↓ (payment recovered)
                   ACTIVE
```

- **Trial:** time-boxed (exact length is a business decision, §18 item 3), full paid-tier entitlements, no payment method charged until trial end (Stripe supports this natively via a trial-period subscription with a required payment method collected upfront — reduces "forgot to cancel" fraud risk on BuildHub's side while still letting the vendor try before paying).
- **Renewal:** automatic via Stripe on the billing anchor date; BuildHub only reacts to the resulting webhook, never re-implements billing-cycle math.
- **Failed payment:** subscription moves to `past_due`; Stripe's built-in retry schedule (Smart Retries) attempts recovery automatically over a configurable window.
- **Grace period:** entitlements remain active through `past_due` (bounded, e.g., through Stripe's retry window) — see §6's reasoning about not abruptly cutting off a vendor mid-job over a stale card.
- **Cancellation:** default to end-of-period (vendor keeps what they paid for); immediate cancellation only as an explicit, separate action if the business wants to offer it (§18 decision item).
- **Reactivation:** re-subscribing a canceled/expired vendor is a new Checkout session, not a special-cased flow — keeps the state machine simple.
- **Upgrade/downgrade:** Stripe's native proration handles the billing math; BuildHub reacts to the resulting `customer.subscription.updated` webhook to adjust entitlements (§9) immediately on upgrade, and (recommended) only at the next renewal on downgrade, so a vendor doesn't lose mid-cycle capability they already paid for.
- **Expiration:** terminal state after a canceled subscription's period ends with no reactivation — entitlements fully revert to free tier.
- **Entitlement removal:** always driven by a webhook-confirmed state change, never by a client action or a time-based guess inside BuildHub's own code (§12).

---

## 9. Entitlements

Based strictly on what the current product actually has to gate — not invented limits:

| Entitlement | Free tier (today, implicitly) | Paid tier (proposed) |
|---|---|---|
| RFQs a vendor can view/respond to per period | Unlimited (current, ungated) | Unlimited, or a *higher* explicit cap if the free tier introduces one |
| Quotations submitted per period | Unlimited (current, ungated) | Same as above |
| Featured product placement (`products.featured`) | Not available (mechanism exists but is inert for everyone today, §1) | Available — this is the cleanest, most concretely "already half-built" paid perk |
| Vendor-level featured placement | Doesn't exist for anyone (§3) | Would require new schema — candidate for a paid perk once built |
| Analytics (`admin.analyticsSummary`-equivalent for a vendor's own performance) | Not available to vendors at all today (endpoint is admin-only) | Vendor-facing analytics as a paid perk — net-new build, not a re-gating of something that exists |
| Verified badge | Already free today, tied to compliance approval, not payment (`onboardingStatus === 'approved'`) | **Do not repackage this as paid** — compliance verification is a trust/safety gate, not a monetization lever; conflating them would undermine the platform's trust signal |
| Multiple employees/users per vendor account | Doesn't exist — BuildHub has no team/organization concept at all today, only individual `users` rows | Out of scope until a team/org model is built — do not invent this as an MVP entitlement |
| Additional service categories | `products.category`/`rfq.category` are free-text-ish/enum fields with no per-vendor category cap today | No current basis to gate this — do not invent a cap that doesn't map to real friction |

**Recommendation:** keep the MVP entitlement list short and honest — a genuine usage cap (if the business wants one, §18) plus the already-half-built featured-placement perk. Resist inventing entitlements (multi-seat, category limits) that don't correspond to any real constraint in the product today.

---

## 10. Database architecture (entities only, no migrations)

| Entity | Purpose | Key fields | Relationships | Unique constraints | Idempotency | Indexes |
|---|---|---|---|---|---|---|
| `billingCustomers` | Maps a BuildHub `users.id` to a Stripe Customer | `userId`, `stripeCustomerId`, timestamps | `userId → users.id` (RESTRICT — never orphan a paying customer's billing record) | `stripeCustomerId` unique; one row per `userId` | N/A (created once, looked up thereafter) | `userId`, `stripeCustomerId` |
| `subscriptionPlans` | Defines the tiers BuildHub sells (mirrors Stripe Products) | `name`, `stripeProductId`, `description`, `active` | none (top-level catalog) | `stripeProductId` unique | N/A | — |
| `subscriptionPrices` | Defines billing intervals/amounts per plan (mirrors Stripe Prices) | `planId`, `stripePriceId`, `interval` (month/year), `unitAmount`, `currency`, `active` | `planId → subscriptionPlans.id` (RESTRICT) | `stripePriceId` unique | N/A | `planId` |
| `subscriptions` | The vendor's actual subscription state — **this is BuildHub's own source of truth for entitlement checks**, kept in sync with Stripe via webhooks, not queried live from Stripe on every request | `userId`, `stripeSubscriptionId`, `priceId`, `status` (trialing/active/past_due/canceled/expired), `currentPeriodEnd`, `cancelAtPeriodEnd` | `userId → users.id` (RESTRICT), `priceId → subscriptionPrices.id` (RESTRICT) | `stripeSubscriptionId` unique; at most one *active-shaped* row per `userId` (enforced in application logic, since "active-shaped" spans several `status` values a plain unique constraint can't express) | Updates keyed by `stripeSubscriptionId`, always applied from the latest webhook event, never from client input | `userId`, `status` |
| `payments` (or `invoices`, mirroring Stripe's model) | Historical record of each charge/invoice, for the vendor billing-history view and admin revenue reporting | `subscriptionId`, `stripeInvoiceId`, `amount`, `currency`, `status` (paid/failed/refunded), `paidAt` | `subscriptionId → subscriptions.id` (RESTRICT — never lose payment history) | `stripeInvoiceId` unique | Upsert keyed by `stripeInvoiceId` | `subscriptionId` |
| `webhookEvents` | Records every processed Stripe webhook event ID, purely for idempotency/replay-safety | `stripeEventId`, `type`, `processedAt`, `payload` (raw, for debugging/reconciliation) | none | `stripeEventId` unique — **this is the idempotency mechanism**: reject/no-op any event whose ID has already been recorded | Is itself the idempotency guard for every other table above | `stripeEventId`, `type` |
| `entitlements` | The resolved, current "what can this vendor do" state — could be a computed view over `subscriptions` rather than its own table if the entitlement rules stay simple (§9's short list argues for this) | `userId`, `tier`, `featuresJson` or explicit boolean/int columns per §9's list | `userId → users.id` (RESTRICT) | one row per `userId` | Recomputed/overwritten on every relevant subscription-state webhook | `userId` |

**Design notes carried over from Phase 3C's already-established conventions** (for consistency when this is eventually built): `ON DELETE RESTRICT` on every relationship touching financial data, matching the pattern already applied to the 42 FKs in `drizzle/0012_broken_nightmare.sql` — never `CASCADE` on anything payment-adjacent. `webhookEvents` is the load-bearing idempotency table; get its unique constraint right before anything else in this list, since every other table's correctness depends on webhook processing being exactly-once.

---

## 11. Webhook architecture

```
Stripe
 ↓
Webhook endpoint (new, e.g. POST /api/webhooks/stripe)
 ↓
Signature verification (stripe.webhooks.constructEvent, using the raw request body — must bypass any JSON body-parsing middleware that would alter it)
 ↓
Idempotency check (stripeEventId already in webhookEvents? → 200 OK no-op)
 ↓
Database state update (subscriptions / payments, keyed by Stripe object IDs, never by trusting amounts/status from anywhere but Stripe)
 ↓
Entitlement update (recompute entitlements for that userId)
 ↓
Notification (reuse the existing post-commit `notifyUser` pattern from server/notifications.ts — dispatch only after the DB write commits, exactly like the Phase 3A notification architecture already does for other domains)
```

Events needed for the recommended model specifically — not a blanket "subscribe to everything":

| Event | Why needed |
|---|---|
| `checkout.session.completed` | Confirms a new subscription actually started (Checkout is the entry point in §7) |
| `customer.subscription.created` | Authoritative subscription-object state at creation, including trial info |
| `customer.subscription.updated` | Covers upgrade/downgrade/renewal/cancel-at-period-end changes (§8) |
| `customer.subscription.deleted` | Terminal cancellation/expiration — triggers entitlement revocation |
| `invoice.paid` | Confirms each renewal charge succeeded — the trigger for `payments` row + continued entitlement |
| `invoice.payment_failed` | Drives the `past_due` transition and grace-period notification (§6/§8) |
| `charge.refunded` | Drives immediate entitlement revocation on a refund (§6) |

Explicitly **not** needed for this model: `payment_intent.*` events (Billing/Checkout abstract these away for a subscription flow — only relevant if a standalone one-off charge, like a future lead-credit purchase, is added), and anything Connect-related (§7 — Connect isn't in scope).

---

## 12. Security requirements

- **Webhook signature validation:** mandatory on every request, using Stripe's signing secret and the *raw* request body — reject anything that doesn't verify, no exceptions.
- **Webhook replay protection:** the `webhookEvents.stripeEventId` uniqueness check (§10/§11) — Stripe can and does redeliver events; processing must be exactly-once regardless.
- **Idempotency:** applies to webhook processing (above) and to any client-initiated action that creates a Stripe object (e.g., "start checkout" should not be double-clickable into two Checkout Sessions) — use Stripe's idempotency-key support on outbound API calls.
- **Server-side price validation:** the client never sends a price/amount BuildHub trusts — every subscription creation references a `stripePriceId` the server looks up from `subscriptionPrices`, never a client-supplied number. This directly extends the same principle already enforced elsewhere in this codebase (e.g., Drizzle's parameterized queries, Zod input validation on every mutation).
- **Never trusting client-side amounts:** restated because it's the single most important rule here — all amount/status truth comes from Stripe webhooks, never from a client callback URL's query string or a client-reported "payment succeeded" message.
- **Authorization:** every billing-related tRPC procedure must verify `ctx.user.id` owns the `billingCustomers`/`subscriptions` row being read or acted on — this repo has a documented history of exactly this class of bug (the Phase 1/2 IDOR findings), so this is not a hypothetical concern to guard against, it's a proven pattern risk specific to this codebase.
- **Subscription entitlement verification:** gate paid features by re-checking `entitlements`/`subscriptions.status` server-side on every request, never by trusting a cached client-side "I'm premium" flag.
- **Refund authorization:** admin-only action (§7), logged.
- **Payment reconciliation:** periodic (e.g., admin-triggered) comparison of BuildHub's `payments`/`subscriptions` state against Stripe's actual records, to catch any webhook that was missed despite the idempotency/retry design.
- **Duplicate event handling:** covered by §11's idempotency table.
- **Failed payment handling:** covered by §8's `past_due` grace-period design.
- **Secret management:** Stripe secret key and webhook signing secret follow the same pattern already used for every other secret in this codebase (`ENV` object in `server/_core/env.ts`, reading from `process.env`, never committed) — this phase did not add, view, or need to view any actual secret value.
- **Audit logging:** extend the existing `userAccountAuditEvents`-style pattern (already used for admin/account actions per Phase 3C's transaction audit) to billing-relevant admin actions (manual refund, plan changes) — reuse the established pattern rather than inventing a parallel one.

---

## 13. Admin dashboard requirements

**MVP:**
- Plans/Prices (read-only view of what's configured in Stripe, synced via `subscriptionPlans`/`subscriptionPrices`)
- Active subscriptions list (vendor, tier, status, renewal date)
- Failed payments list (to catch vendors stuck in `past_due` needing outreach)
- Payment history (per vendor, and platform-wide)
- Refunds (the admin-initiated action itself, per §7/§12)
- Webhook events log + failed-webhook-processing visibility (operational health, directly enables the reconciliation task in §12)

**Future analytics (explicitly not MVP):**
- Revenue dashboards, MRR, churn rate, trial-conversion rate — genuinely useful, but they're reporting on top of data the MVP tables above already capture; building the reporting layer before there's any real subscriber data to report on is premature.

---

## 14. Vendor experience

Needed, all achievable largely through Stripe's Customer Portal (§7) plus light custom UI:
- Plan comparison (custom UI — Stripe doesn't provide this out of the box)
- Current plan + trial status + renewal date (custom UI, sourced from BuildHub's own `subscriptions` table, not a live Stripe call on every page load)
- Upgrade/downgrade (Customer Portal, or custom Checkout flow)
- Payment method management (Customer Portal)
- Billing history / invoice access (Customer Portal)
- Failed-payment notice (in-app notification, reusing the existing `notifications` table pattern, §11)
- Cancellation (Customer Portal)
- Reactivation (custom — a fresh Checkout session, §8)

Not implemented in this phase (design only, per instruction).

---

## 15. Customer experience

## CUSTOMER PAYMENT NOT REQUIRED FOR MVP.

Under the recommended model (§5), customers never pay BuildHub anything, and nothing about adding Stripe for vendor subscriptions requires exposing any payment surface to customers. This is a direct, explicit consequence of choosing Model A over Model E/F — restated here per the phase's explicit instruction not to add customer payments just because Stripe exists elsewhere in the product.

---

## 16. Refunds / cancellations / disputes

| Event | Stripe state | BuildHub entitlement state |
|---|---|---|
| Subscription cancellation (end-of-period) | `cancel_at_period_end = true`, subscription stays `active` until period end | Entitlements unchanged until period end, then revert to free tier |
| Immediate cancellation | Subscription → `canceled` immediately | Entitlements revoked immediately |
| Refund (full) | `charge.refunded` | Entitlements revoked immediately (§6) |
| Partial refund | `charge.refunded` with partial amount | Entitlements unchanged (partial refund is a billing correction, not a service cancellation) — business should confirm this default (§18) |
| Failed payment | Subscription → `past_due` | Entitlements unchanged during grace period (§8) |
| Chargeback | `charge.dispute.created` (not in §11's list because it's not needed for the MVP's core flow, but should be added once disputes become an operational reality) | Entitlements suspended immediately — more severe than a routine failed payment, per §6's reasoning |
| Dispute (general) | Same as chargeback | Same — freeze, don't auto-resolve |
| Vendor account suspension | N/A (BuildHub-side action, e.g. for a ToS violation) | Independent of billing state — a suspended vendor's subscription can keep billing or be admin-canceled, that's a separate business decision, not an automatic linkage |
| Vendor account removal | N/A | Subscription should be admin-canceled as part of the removal flow, not left orphaned — direct parallel to the `deleteDummyUser` FK-safety work in Phase 3C: a user-removal action must not leave dangling billing state any more than it should leave dangling project/quotation data |

The consistent principle throughout this table: **Stripe's state is the source of truth for "did the money move," BuildHub's entitlement state is a derived, webhook-driven reaction to it — never the other way around.**

---

## 17. Tax / currency / region

- **Primary launch country:** Egypt, strongly implied by the product's existing defaults — every price-bearing column in the schema (`products.price`, `quotations.price`, `rfqs.budget`, `expenses.amount`) defaults its `currency` field to `'EGP'` (confirmed directly in `drizzle/schema.ts`), and the marketplace category list (`marketplaceRouter.categories`) and bilingual English/Arabic UI throughout the app are consistent with an Egypt/MENA-first product. This is inference from consistent product signals, not a document that states it outright — flagged as such.
- **Primary currency:** EGP, same basis.
- **Future GCC currencies:** Stripe supports multi-currency Prices natively, so this is a configuration-time decision when GCC expansion actually happens, not an architectural blocker today — but see the Egypt Stripe-support caveat in §5; GCC countries (UAE, Saudi Arabia) generally have more mature Stripe support than Egypt currently does, which is worth factoring into expansion sequencing.
- **VAT/tax considerations:** genuinely out of this report's competence — Egypt's e-invoicing/VAT requirements for a digital subscription service, and Stripe Tax's actual coverage for Egypt specifically, both need legal/accounting confirmation before any pricing is finalized. Flagging as a required external input, not attempting to answer it here.
- **Should BuildHub initially support one currency:** **yes, recommended** — start EGP-only, add currencies when actual GCC expansion is scheduled, not speculatively.
- **Should multi-currency be postponed:** **yes, recommended**, for the same reason.

---

## 18. Business decisions requiring owner approval

None of the following were decided in this report — they are surfaced explicitly for approval, per instruction:

1. **Monetization model** — this report recommends Model A (vendor subscription) + Model D (featured placement) as a secondary layer, explicitly not Model B/E/F. Requires sign-off.
2. **Vendor subscription pricing** — tier count, price points, monthly vs. annual — not addressed here at all, this is a business/market decision.
3. **Free trial** — whether one exists, and its length.
4. **Whether a free tier persists post-launch, or subscription becomes mandatory for any vendor access** — §9 assumed a free tier continues to exist; this is not guaranteed and needs confirmation.
5. **Commission** — this report recommends against it for the MVP (§4/§5); confirm that's acceptable, since it means abandoning the already-scaffolded `commissionPercent` setting's original apparent intent.
6. **Lead fees** — recommended as, at most, a future add-on inside subscriptions (§4), not a standalone MVP model; confirm.
7. **Featured listings** — recommended as a subscription-tier perk; confirm whether it should also be sellable à la carte outside a subscription.
8. **Customer payment requirement** — this report concludes NOT REQUIRED (§15); confirm.
9. **Refund policy** — full/partial refund rules, and specifically whether a partial refund should ever affect entitlements (§16 flagged this as needing confirmation).
10. **Currency** — confirm EGP-only for launch (§17).
11. **Payment timing** — confirm the trial-then-charge structure in §8, or specify an alternative.
12. **Immediate vs. end-of-period cancellation** — confirm which (or both) should be offered (§8/§16).

---

## 19. Implementation roadmap

Adapted to the recommended Model A + Model D architecture:

- **4B.1** — Database billing model (§10 entities, as an actual Drizzle migration this time — following the same audit → design → test-on-empty-DB → test-on-staging discipline established in Phase 3C, since this schema is at least as sensitive as the FK work already done)
- **4B.2** — Stripe Products/Prices setup (test mode first), mapped into `subscriptionPlans`/`subscriptionPrices`
- **4B.3** — Backend billing service (Customer creation, Checkout session creation, entitlement-resolution logic)
- **4B.4** — Checkout integration (vendor-facing "subscribe" flow)
- **4B.5** — Webhook endpoint (§11), built and tested before anything depends on it, given how much of §12's security posture rests on it being correct from day one
- **4B.6** — Entitlements wiring (gate `submitQuotation`, `marketplace.create`'s featured flag, etc. behind resolved entitlement state)
- **4B.7** — Vendor billing UI (§14)
- **4B.8** — Admin billing UI (§13, MVP scope only)
- **4B.9** — Failure/refund/reconciliation handling (§16, §12's reconciliation task)
- **4B.10** — Stripe test-mode end-to-end verification (full trial→active→past_due→canceled cycle, webhook replay/idempotency testing — same "prove it against something real before claiming PASS" discipline this engagement has applied since Phase 3C, adapted to Stripe's test mode since there's no equivalent of the local-MariaDB trick for payments)
- **4B.11** — Production Stripe configuration (live keys, live webhook endpoint) — last step, after everything above is proven in test mode, and only after the §18 business decisions are actually settled, not assumed

---

## 20. Dependencies / blockers

- **All of §18's business decisions** must be settled before 4B.1 can be responsibly scoped — several of them (trial length, free-tier persistence, pricing) directly shape the schema.
- **Real database access** (the Phase 3C.1 blocker, still open per `BUILDHUB_CURRENT_ENGINEERING_STATUS.md`) is not strictly required to *design* the billing schema, but is required before 4B.1's migration can be validated with the same rigor Phase 3C used — the same staging-access gap applies here.
- **Stripe account setup** (business entity, banking details for payout — note: BuildHub *receiving* vendor subscription payments needs BuildHub's own Stripe account payout to work in Egypt, which is a more standard/mature Stripe capability than Connect-based *forwarding* to third parties, but should still be confirmed directly against Stripe's current Egypt merchant-account support before committing to a timeline).
- **Legal/accounting input on VAT/tax** (§17) — needed before pricing is finalized, not before architecture is designed.
- **No code, schema, or Stripe configuration exists yet** — 4B.1 starts from zero, exactly as this report describes.

---

## Final status

## NOT READY FOR BUSINESS APPROVAL

This report itself does not require a "not ready" verdict on its own completeness — the analysis is complete within this phase's read-only scope. The status reflects that **the business decisions in §18 have not yet been made**, and per this phase's explicit instruction, this report does not make them silently. Once those decisions are made, this document (or an updated version of it) becomes the basis for a business-approval sign-off before Phase 4B implementation begins. No code, schema, database, dependency, or Stripe/SendGrid/Twilio configuration was touched to produce this report. Stopping here, waiting for explicit direction on §18 before any implementation work starts.
