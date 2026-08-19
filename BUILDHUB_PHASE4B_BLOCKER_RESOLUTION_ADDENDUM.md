# BuildHub — Phase 4B Blocker Resolution Addendum

Branch: `claude/phase4b-blocker-resolution`, created from `claude/phase4b-readiness-architecture` @ `c8b79fa543b1c95ce887a756bb585ec1a0bd2fda`. Addendum to `BUILDHUB_PHASE4B_READINESS_AND_ARCHITECTURE.md` — read that report first; this document resolves its blockers one by one and does not repeat sections that remain unchanged (the payment-provider capability table, security model, and migration/rollback strategy from that report still stand). **No implementation was performed in this task.** No schema migrated, no code written, no credentials configured, no payment objects created.

---

## 1–2. Qualified-enquiry definition & exact RFQ attribution mechanism

**Investigated, not assumed.** Traced `rfqs.category`, `providerRoles`, and every code path that could plausibly connect an RFQ to a specific vendor's eligibility, rather than the vendor's general "am I an approved provider at all" status.

**Findings:**
- `rfqs.category` is a `varchar(100)`, nullable, free-text column. It is **never read server-side** for any filtering, matching, or WHERE clause — confirmed by an exhaustive search of `server/routers.ts` for `.category` usage: zero matches outside the create-input schema. It exists only for display (a badge on the RFQ card) and as a create-time dropdown value.
- The create-RFQ form (`client/src/pages/RFQPage.tsx`) constrains category selection client-side to a fixed 9-value list — `Materials, Labor, Complete Project, Engineering, Design, Furniture, Maintenance, Renovation, Custom Services` — but this list is **not server-validated** (any string is accepted by `rfq.create`'s `z.string().optional()`) and, critically, **has no defined mapping to `providerRoles`** (`contractor, engineer, architect, supplier, project_manager`). Several of the 9 values ("Complete Project," "Custom Services," "Maintenance") don't correspond to a single role at all; a "Renovation" RFQ is plausibly relevant to a contractor, an engineer, and an architect simultaneously. No such crosswalk exists anywhere in the codebase, and inventing one would itself be a business classification decision, not a technical inference.
- `submitQuotation` (the only gate on which providers can act on an RFQ) checks `approvedProviderProcedure` only — role-tier and onboarding-approval, identical for every provider account. It performs **no comparison whatsoever** between the RFQ's `category` and the acting vendor's `userRole`.
- `rfq.list`/`rfq.myList` (what a provider actually sees) return the **same, undifferentiated set of open RFQs to every approved provider**, regardless of role. There is no per-vendor visibility list, no targeting table, no notification-on-match mechanism — nothing that would make one vendor's "available RFQs" differ from another's.

**Conclusion: the current data model cannot support "a real customer RFQ/opportunity that is genuinely available or targeted to a vendor" as a per-vendor-differentiated concept, because no such differentiation exists anywhere in the system today.** Every open RFQ is uniformly available to every approved provider. This is not a counting problem (which would be fixable with a new aggregate query) — it is the **absence of the underlying targeting relationship** the definition depends on. Per the explicit instruction not to approximate this, no fallback metric is substituted here.

**What would be required to build this for real** (not proposed for adoption without a decision — presented so the gap is concrete, not abstract):
1. A defined mapping from RFQ categories to eligible provider roles (a business/product taxonomy decision — e.g., is "Design" relevant to `architect` only, or also `engineer`?), **and/or**
2. A vendor-declared specialties field (vendors currently have only one coarse `userRole`, no multi-category self-declaration), **and**
3. A new query/index computing, per vendor, "open RFQs whose category matches this vendor's role/specialties this month" — genuinely new schema and logic, not a Phase 4B billing-domain task as originally scoped in the prior report.

**This blocker is not resolved by this addendum** — it is reported precisely, per instruction, rather than approximated. It is a business-clarification-required item: does the founder/owner want to (a) commission the targeting feature above before "qualified enquiry" can be enforced meaningfully, or (b) accept a pragmatic, honestly-labeled interim definition for Phase 4B's initial launch (e.g., "quotations you submit" or "RFQ details you view," both flagged in the prior report, both real and exactly attributable today, neither claiming to be "targeted")? This is the one blocker in this addendum still requiring your decision before entitlement enforcement can be implemented.

---

## 3–4. Founder eligibility & expiration behavior

**Now fully specified, no invention required**, given the rules provided:

- **Eligibility**: a vendor's first-ever paid subscription qualifies for founder pricing if and only if it starts before a configured cutoff timestamp — `FOUNDER_OFFER_ENDS_AT`, stored in the existing `adminSettings` key/value table (not hard-coded, not duplicated in application code). This directly satisfies "new vendors only" (only subscriptions *starting* before the cutoff qualify — an account that signs up after the cutoff simply has no founder-priced option to select) and "must be centrally configurable."
- **One per account, no retroactive grants**: `vendorSubscriptions.founderOfferAppliedPriceId` (already in the prior report's schema, §7.1) is set exactly once, the first time a vendor's subscription is created with a founder-tagged `planPrices` row. Before offering founder pricing at checkout time, the server checks: has this `userId` ever had a `vendorSubscriptions` row with `founderOfferAppliedPriceId` set? If yes, founder pricing is not offered again — enforced server-side at checkout-session creation, never trusted from the client. This is the same "server is the only source of truth for what a client may purchase" discipline as the rest of the architecture (§7.9 of the prior report).
- **Expiration behavior**: at 6 months from the founder subscription's start, the *next* renewal charge uses the plan's standard `planPrices` row (499/999) instead of the founder row — this is a plain price-swap at the provider level (change which Price the subscription renews against), handled by the same heartbeat-driven renewal-sync flow already designed in the prior report (§7.4), with a `billingEvents` entry (`'founder_offer_expired_moved_to_standard'`) for auditability. No separate "founder subscription object" or parallel pricing model is created — it is the same `vendorSubscriptions` row, just pointing at a different `planPrices` row after month 6, exactly satisfying "do not silently create a second founder-pricing model."
- **Standard prices** (499/4,990, 999/9,990) are untouched — the founder `planPrices` rows are additive rows alongside the standard ones, never a modification to them.
- **Annual founder pricing**: the approved rules give only monthly founder amounts (299/699). **Flagged, not invented**: whether an annual founder-discounted option should also exist is a separate, undecided business question. The schema supports it trivially if approved later (another `planPrices` row, `isFounderOffer=true, interval='year'`) — but no such row or price is assumed or created by this architecture.

**This blocker is resolved.**

---

## 5. Grace-period behavior (7 days, approved)

Adopting the approved 7-day grace period into the lifecycle from the prior report (§7.4):

```
renewal charge fails
  → webhook: invoice.payment_failed
  → status: 'active' → 'past_due'
  → billingEvents: 'payment_failed', graceEndsAt = now + 7 days (stored on vendorSubscriptions)
  → paid entitlements PRESERVED for the duration of the grace period (per the approved policy:
    "retain paid entitlements where technically appropriate" — appropriate here, since the
    purpose of a grace period is to avoid punishing a vendor for a transient card issue)
  → provider's own retry attempts (see below) may resolve it automatically at any point
     → webhook: invoice.paid → status: 'active', graceEndsAt cleared, billingEvents: 'payment_recovered'
  → if unresolved when graceEndsAt passes (checked by the same daily heartbeat job that
     handles trial expiry and end-of-period cancellation, §7.4/§7.10 of the prior report):
     → status: 'canceled' (non-renewal, not vendor-initiated)
     → plan reverts to FREE, paid entitlements removed
     → all vendor data (profile, reviews, quotations, business history) preserved, per the
       same non-destructive guarantee that already holds for voluntary cancellation
     → billingEvents: 'grace_period_expired_downgraded'
```

**Provider retry mapping — investigated further in this pass.** Search results (not primary documentation — same evidence-quality caveat as the prior report) indicate Paymob's Subscription Plans API supports **configurable "retrial logic and reminder days" for failed payments at the plan level** — i.e., Paymob appears to natively support automated retry attempts and reminder scheduling tied to a subscription plan, which is the right shape to align with a 7-day window (e.g., configure retries within days 1–7, with the platform's own `graceEndsAt` as the authoritative backstop regardless of exactly how many retries the provider attempts). **This has not been confirmed against primary documentation or a real account** — before implementation, the exact retry count/spacing Paymob applies by default (and whether it's configurable per-plan or account-wide) must be confirmed directly with Paymob, since the architecture's `graceEndsAt` deadline must be set independently of provider retry timing regardless (the platform should never rely on the provider's retry schedule alone to determine when to downgrade — the heartbeat job's own 7-day clock is authoritative, and any provider-side recovery before that deadline simply short-circuits it via the `invoice.paid` webhook).

**No mismatch found that would block this policy** — Paymob's documented capabilities are consistent with implementing a 7-day grace period; the remaining unknown (exact default retry cadence) is a configuration-confirmation task at integration time, not an architectural blocker.

**This blocker is resolved**, with the one integration-time confirmation noted above carried forward as a pre-implementation checklist item, not a blocker.

---

## 6. Real vendor-directory architecture

Minimal, non-advertising, non-AI, non-auction — exactly as scoped. Reuses the Phase 4A `PUBLIC_PROFILE_COLUMNS` allowlist discipline rather than inventing a new one.

### 6.1 Data source
The real `users` table, filtered to `userRole IN providerRoles AND isDummy = false` (excluding dummy/test accounts from customer-facing discovery, the same convention already used by `admin.stats`/`admin.complianceQueue` to exclude test data from real counts).

### 6.2 New endpoint
```
marketplaceRouter.vendors   publicProcedure
  .input({ category: providerRoles enum (optional), location: string (optional, simple
           substring match against users.location, no geocoding), search: string (optional,
           name/bio substring), limit, cursor })
  .query(...)

  SELECT (explicit allowlist, extending PUBLIC_PROFILE_COLUMNS - no new sensitive fields):
    id, name, bio, avatar, location, userRole, verified, createdAt
  FROM users
  LEFT JOIN (per-vendor reputation aggregate, same definition as reviews.statsForUser -
             AVG(rating)/COUNT(*) WHERE verified=true, grouped by revieweeId - reusing the
             exact batched-aggregate pattern already built and live-verified in Phase 4A.6.9
             for rfq.quotations, not a new competing reputation calculation)
  WHERE userRole IN providerRoles AND isDummy = false
    AND (category filter, location filter, search filter as provided)
  ORDER BY <organic relevance - see §7 below>
```
**No `passwordHash`, `invitationToken`, `email`, or `phone` in this projection** — identical discipline to `PUBLIC_PROFILE_COLUMNS`, `ADMIN_USER_LIST_COLUMNS`, and `COMPLIANCE_APPLICANT_COLUMNS` established across Phase 4A. `email`/`phone` are deliberately excluded from a public discovery listing even though they exist on the account — a customer discovers a vendor here and then proceeds to the existing `/vendor/:id` profile page (already correctly scoped) or initiates contact through the platform's own RFQ/messaging flow, not a scraped contact list.

### 6.3 Category/location filtering
"Category" in the directory context maps to `userRole` (the only real, structured vendor-category field that exists) — **not** `rfqs.category` (the free-text, unmapped RFQ taxonomy from §1–2 above; conflating the two would be exactly the kind of invented mapping this addendum is avoiding). Location filtering is a simple substring match against the existing free-text `users.location` field — no geocoding/radius search is proposed, matching "do not build a complex... platform."

### 6.4 Verification status display
`users.verified` (already exists, already the single boolean the whole platform uses for onboarding/compliance approval) is included in the projection and rendered as a badge — reusing, not duplicating, the existing verification concept. No new "verification" meaning is introduced for the directory.

### 6.5 Client
Replace `client/src/lib/marketplaceData.ts`'s static `VENDORS` import in `VendorsDirectory.tsx` with `trpc.marketplace.vendors.useQuery(...)`. This is the only client file this feature touches — `VendorProfile.tsx` (the single-vendor page) is already correctly wired to real data and needs no change.

### 6.6 Scope boundary (explicit, per instruction)
No AI/recommendation logic, no auction/bid-for-placement mechanism, no complex faceted search — a category dropdown, a location text filter, a search box, and a paginated list, matching "REAL VENDOR DATA → REAL CUSTOMER DISCOVERY → REAL VENDOR PROFILE" exactly as scoped, nothing more.

---

## 7. Visibility & featured-placement architecture

Building directly on §6's real directory and the prior report's `featuredPlacements` table (§7.5 of the prior report, unchanged here):

```
Directory ORDER BY, decomposed into two strictly separate signals:

1. Organic relevance score (never touched by billing):
   - reputation (reviews.statsForUser-equivalent average, already computed in §6.2's join)
   - review count (a floor of confidence — a 5.0 average from 1 review should not outrank
     a 4.8 average from 40 reviews; a simple Bayesian-average or a minimum-count threshold
     is sufficient, no invented "quality score" beyond what reviews already represent)
   - profile completeness (has bio, has avatar, has location - all real, existing fields)
   - recency (createdAt / lastSignedIn, as a tiebreaker only)

2. Visibility-tier boost (billing-derived, from §7.7's entitlements — 'standard' | 'boosted' | 'top'):
   - FREE = 'standard': no boost, pure organic order
   - PROFESSIONAL = 'boosted': a bounded multiplier/rank-adjustment applied ON TOP OF the
     organic score - never a fixed top-of-list override, and never able to place a
     zero-review, unverified account above a highly-reputable free vendor
   - PREMIUM = 'top': a larger bounded boost, same non-override rule

3. Featured placement (from featuredPlacements, §7.5 of the prior report):
   - a small, clearly-labeled slot (e.g., "Featured" badge, a distinct top-of-page shelf,
     or both) - visually and structurally separate from the ranked/sorted list itself, so a
     paying vendor's featured slot is never confused with "ranked #1 organically"
```

**Strict separation, verified against the approved constraints:**
- Nothing in this design ever writes to `users.verified` or the `reviews` table from a billing code path — verification and reviews remain entirely vendor-earned, confirmed unchanged from the prior report's §7.5.
- The "boost" is a bounded adjustment to an already-real organic score, not a replacement of it — a Premium vendor with zero reviews and an incomplete profile does not out-rank a Free vendor with excellent, real reputation; the plan only improves *where a vendor lands within their own merit range*, never fabricates merit.
- "Featured" is presented as a labeled placement, not a ranking position, so a customer can always distinguish "this vendor paid to be shown here" from "this vendor is ranked highly because of real reputation."

This architecture requires §6's real directory to exist first (unchanged conclusion from the prior report) but is otherwise fully specified and ready to build once that prerequisite and the entitlement values (already approved: standard/boosted/top tiers, corresponding to FREE/Professional/Premium) are in place.

---

## 8–9. Confirmed payment-provider capabilities & limitations (Paymob, deepened this pass)

Extends §6 of the prior report — same evidence-quality caveat (search-derived, primary docs blocked by this sandbox's egress proxy, must be confirmed against a real account before commitment):

| Capability | Status this pass |
|---|---|
| Recurring subscriptions, flexible billing cycles | Confirmed — weekly/bi-weekly/monthly/quarterly/annual cycles supported per the Subscription Plans API |
| Retry/dunning logic | **New this pass**: subscription plans support configurable "retrial logic and reminder days" for failed payments — directly relevant to the 7-day grace period (§5 above) |
| Trial support | Still not confirmed as a native plan parameter in available sources — architecture continues to model trial application-side (§7.4 of the prior report: delay first charge, don't rely on provider-native trial semantics), which removes the dependency on this being confirmed |
| Settlement/reconciliation | Confirmed — Paymob Accept dashboards provide transaction/settlement/refund/payout reports; reconciliation explicitly accounts for MDR, refunds, and subscriptions specifically |
| API authentication | Confirmed — API key exchanged for a 60-minute bearer token for management APIs including Subscriptions (an integration detail to design the adapter's token-refresh handling around) |
| Webhook signature | Unchanged from the prior report — documented HMAC-SHA512 process |
| Refunds/void | Unchanged from the prior report — documented, distinguishes refund (captured) vs. void (same-day uncaptured) |
| Sandbox | Unchanged — test/live via different keys on the same base URL |

**No capability mismatch found against the approved lifecycle** (§3, §5 above). The one still-open confirmation (exact default retry cadence, and whether it's configurable) is an integration-time task, not a redesign trigger.

---

## 10. Remaining blockers (updated)

1. **Qualified-enquiry definition — still open, reported precisely in §1–2 above.** The only blocker in this addendum requiring a decision the report cannot make for you: commission the RFQ-targeting feature first, or accept an honestly-labeled interim definition (quotations submitted, or RFQ views) for Phase 4B's initial launch.
2. **Provider confirmation** — Paymob remains the recommended candidate, materially strengthened by this pass's findings (native retry/reminder configuration, confirmed settlement/reconciliation), but still requires direct account-level confirmation before integration begins, per the original instruction not to commit to a provider on search evidence alone.
3. **Founder annual pricing** — flagged in §3–4 above, not decided, not invented.
4. **Portfolio, multi-branch, multi-team features** — unchanged from the prior report (§5, Requirements 10 and 15): these do not exist in any form and need a messaging/scoping decision (build now vs. label "coming soon") before any plan-comparison page ships, independent of the billing architecture itself.

Everything else previously listed as a blocker in the prior report (founder eligibility, founder expiration, grace-period length and provider mapping, vendor-directory architecture, visibility/featured-placement architecture) is now resolved by this addendum.

---

## 11. Exact implementation sequence (unchanged from the authorizing task, now fully groundable)

`4B.1` Billing schema/domain → `4B.2` Provider abstraction → `4B.3` Plan/pricing configuration (including the founder-offer rows and `FOUNDER_OFFER_ENDS_AT` setting) → `4B.4` Trial lifecycle → `4B.5` Checkout → `4B.6` Webhooks → `4B.7` Subscription synchronization → `4B.8` Entitlements → `4B.9` Cancellation/downgrade → `4B.10` Failed-payment handling (the 7-day grace period, §5) → `4B.11` Refund handling → `4B.12` Vendor billing UI → `4B.13` Admin billing visibility → **[prerequisite insertion point]** the real vendor directory (§6, not part of the original 4B.1–4B.17 numbering but required before the next two steps have anything to operate on) → `4B.14` Featured placement (§7) → `4B.15` Billing analytics → `4B.16` Security audit → `4B.17` Full E2E verification.

`4B.1`–`4B.13` do not depend on the qualified-enquiry decision (§1–2) or the real directory (§6) and could, if the owner prefers, begin once the provider is confirmed — enquiry-allowance enforcement specifically (part of `4B.8` Entitlements) is the one piece of `4B.1`–`4B.13` that is blocked on §1–2's outstanding decision.

---

## 12. Final gate decision

# PHASE 4B — NOT READY — EXACT REMAINING BLOCKERS

Five of the prior report's blockers are resolved by this addendum (founder eligibility/expiration, grace-period policy and provider mapping, real vendor-directory architecture, visibility/featured-placement architecture, and a materially deepened provider-capability picture). Two precise items remain, both requiring an owner decision this addendum correctly did not make on your behalf:

1. **Qualified-enquiry attribution** (§1–2) — the current data model cannot support "RFQs genuinely targeted to a vendor" as defined; choose between commissioning the targeting feature or approving an honestly-labeled interim definition.
2. **Direct provider confirmation** — Paymob's evidence is stronger after this pass but still not primary-source-verified; confirm against a real (test-mode) account before any integration code is written.

Once these two are resolved (plus the minor founder-annual-pricing and portfolio/multi-branch messaging flags in §10, neither of which blocks starting implementation), `4B.1` can begin exactly as sequenced in §11 with no further discovery required.
