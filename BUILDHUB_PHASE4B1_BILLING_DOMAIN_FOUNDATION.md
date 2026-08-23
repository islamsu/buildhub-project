# BuildHub — Phase 4B.1: Billing & Monetization Domain Foundation

## 1. Baseline SHA

`c177b30d90afadbca899d87b9dfc221f84c2e031` (`claude/phase4b-final-blocker-authorization`).

Chosen deliberately: this commit's **code** is byte-identical to the approved Phase 4A final gate (`claude/phase4a-final-gate` @ `2cd8af3`) — verified with `git diff --stat`, which shows only the three Phase 4B architecture documents differ — while also carrying the approved architecture docs forward with the implementation.

## 2. Branch

`claude/phase4b1-billing-domain-foundation`. Never merged, never deployed, never published.

## 3. Source-of-truth findings

Verified against source, not against prior reports:

| Area | Finding |
|---|---|
| Existing billing/payment code | **None.** Repo-wide search for `stripe\|billing\|subscription\|payment\|paymob\|fawry` returned only quotation "payment terms" (unrelated project field), two dead `DEFAULT_ADMIN_SETTINGS` placeholders (`transactionFeePercent`, `commissionPercent` — never read anywhere), and UI-kit demo labels in `ComponentShowcase.tsx`. Confirmed greenfield. |
| RFQ targeting / enquiry counting | **Not implemented** — search for `vendorCategories\|enquiryUsage\|enquiryConsumptions` returned zero hits. Correctly still deferred to Phase 4B.3 per §11; this phase did not build it. |
| Vendor model | `users.userRole` enum (5 provider roles + homeowner + admin), `providerRoles` constant, `approvedProviderProcedure` (role + `onboardingStatus === 'approved'`). |
| Authorization patterns | `publicProcedure` / `protectedProcedure` (with the Phase 4A.6.8 per-request `accountStatus` re-check) / local `adminProcedure`. Explicit column allowlists (`PUBLIC_PROFILE_COLUMNS`, `ADMIN_USER_LIST_COLUMNS`, `COMPLIANCE_APPLICANT_COLUMNS`) are the established Phase 4A security convention — reused here. |
| Admin settings | `adminSettings` generic key/value table already exists; `admin.updateSetting` **rejects any key not present in `DEFAULT_ADMIN_SETTINGS`**. This mattered — see §7. |
| Notifications | `notifyUser`/`notifyUsers` write in-app rows only; email/SMS explicitly deferred (confirmed in the module's own header comment). Billing notifications will therefore be in-app-only until Phase 4C. |
| Analytics/events | No generic event-log table. Metrics are query-time aggregates over timestamped rows. Umami script tag in `client/index.html` is unconfigured (placeholder env vars). |
| DB conventions | `mysqlTable(name, cols, table => ({ indexes }))`; FKs `.references(() => t.col, { onDelete, onUpdate: 'restrict' })`; index naming `table_column_idx`; `$inferSelect`/`$inferInsert` type exports at file end. |
| Migration conventions | `drizzle-kit generate && drizzle-kit migrate`, output to `drizzle/`, journal in `drizzle/meta/_journal.json`. Last migration `0013_whole_gideon`. |
| Phase 3C FK conventions | RESTRICT-favouring; audit trails use nullable + `SET NULL` (`userAccountAuditEvents`) so history outlives its subject; `revokedSessions` uses CASCADE with a documented rationale. Both precedents applied below. |

## 4. Database/schema changes

New migration **`drizzle/0014_daily_mulholland_black.sql`** — purely additive: two `CREATE TABLE`s, four FK constraints, seven indexes. **Zero `ALTER` statements against any existing table.** `0012_broken_nightmare.sql` (Phase 3C) and `0013_whole_gideon.sql` confirmed untouched via `git diff --stat`; `_journal.json` diff is a single appended entry.

**`vendorSubscriptions`** — per-vendor commercial state. Exactly **one row per vendor** (`uniqueIndex` on `userId`): a live state machine mutated in place, with history in `billingEvents`. FK `onDelete: RESTRICT` (Phase 3C convention) — a subscription is a financial record and must not vanish silently with its user. Indexes on `status`, `currentPeriodEnd`, `trialEndsAt`, `gracePeriodEndsAt` (the columns Phase 4B.4's sweeps will scan).

**`billingEvents`** — append-only audit trail. Deliberately mirrors `userAccountAuditEvents`: nullable `userId` + `SET NULL`, so billing history can outlive its subject and a vendor with billing events never becomes undeletable.

## 5. Billing state model

Statuses: `free · trialing · active · past_due · canceled · expired`.

The critical design decision: **entitlements are derived from stored state *and the current time*, never from the stored status alone** (`deriveBillingState` in `server/billing/domain.ts`). A lapsed trial or an elapsed grace window resolves to FREE *immediately*, even if no scheduled job has yet written the change. Background sweeps (Phase 4B.4) persist what this function already computes — they are not what makes it true. This means a late, failed, or never-deployed sweep **cannot over-grant paid access**. Live-proven in §16, case B.

Two deliberate non-inventions:
- An `active` subscription whose period elapsed **without** a cancellation keeps its entitlements and is flagged `awaitingRenewalSync`. A provider sync gap must not punish a paying vendor, and no downgrade deadline was invented — reconciliation belongs to Phase 4B.5.
- Cancellation with the period still running keeps full paid access, exactly as approved.

## 6. Plan configuration

`shared/billing.ts` is the **single source of truth for every commercial value in the product**. No price, allowance, interval, or duration is written anywhere else — enforced by tests.

| | FREE | PROFESSIONAL | PREMIUM |
|---|---|---|---|
| Monthly | — | EGP 499 | EGP 999 |
| Annual | — | EGP 4,990 | EGP 9,990 |
| Founder (monthly, 6 mo) | — | EGP 299 | EGP 699 |
| Qualified enquiries/month | 5 | 30 | unlimited |
| Visibility | standard | boosted | top |
| Featured-placement eligible | no | no | yes |

Trial 30 days, grace 7 days, founder window 6 months, currency EGP-only (`SUPPORTED_CURRENCIES`), all as approved.

**Deliberately not a database table.** The catalogue is fixed product definition, not per-vendor state; behavioural entitlements must live in code regardless, so splitting prices into a `plans` table would recreate exactly the duplication this file exists to prevent, plus a code/DB drift risk. This is a considered deviation from the earlier architecture sketch, taken under §6's "do not create unnecessary payment tables."

**Annual founder pricing is `null` on both paid plans** — it was never approved, so `resolvePrice(plan, 'year', true)` returns null and `startTrial` **throws** rather than silently falling back to standard pricing. An unapproved commercial value cannot be sold by accident.

## 7. Founder offer implementation

- **Eligibility**: open offer window (`founderOfferEndsAt`, an ISO date in `adminSettings`) **and** the vendor has never used the offer. Absent/unparseable setting = offer closed (safe default).
- **One-time use, structurally enforced**: `founderPriceUsedAt` is written once and **never cleared** — `downgradeToFree` deliberately omits it, so a cancel-and-resubscribe cycle cannot re-award the offer. Not a rule application code must remember; a property of the data.
- **No retroactive grants**: eligibility is only ever evaluated when a new paid subscription starts.
- **Expiry**: after 6 months the *same* subscription row reprices to standard (`expireFounderPrice` patches `priceAmount`/`isFounderPrice` only — never `plan` or `status`). One row, repriced. Not a second pricing model.

**Gap found and closed during this phase:** `admin.updateSetting` rejects any key absent from `DEFAULT_ADMIN_SETTINGS`, so the founder cut-off was **not actually settable through any existing surface** — silently failing §2's "must be configurable" requirement. Added `founderOfferEndsAt: ''` to that record (default empty = closed). Live-verified end-to-end in §16.

## 8. Entitlement architecture

One centralized definition (`PLANS[id].entitlements`), one lookup (`getEntitlements`), one server-authoritative resolver (`service.getBillingState`). No plan check is scattered anywhere.

**Honesty ledger.** `ENTITLEMENT_ENFORCEMENT` records, per entitlement, which phase actually enforces it — `'not-implemented'` where the underlying product feature does not exist in BuildHub at all (`portfolioLevel`, `promotionalCapability`, `branchLimit`, `teamMemberLimit`). A test asserts every entitlement key appears in this ledger, so a defined entitlement can never quietly masquerade as a working capability. **Nothing in this phase enforces any entitlement yet** — 4B.1 builds the domain; enforcement lands in 4B.2/4B.3/4B.6.

## 9. Provider abstraction

`server/billing/provider.ts` defines the `PaymentProvider` interface plus a `NullPaymentProvider` whose every operation throws `PaymentProviderNotConfiguredError` — failing loudly rather than silently no-opping, which in a billing system is far more dangerous.

The interface is shaped from **BuildHub's own approved lifecycle**, not from any provider's API surface. `NormalisedProviderEvent` gives adapters the job of translating provider payloads into BuildHub vocabulary, so the domain never learns a provider's event names. A test asserts `domain.ts` and `service.ts` contain no occurrence of "paymob", "stripe", or "fawry".

**No Paymob integration exists**, as instructed — no sandbox merchant account is available (`BUILDHUB_PHASE4B_FINAL_BLOCKER_AUTHORIZATION.md`), and inventing provider behaviour without one would be guessing.

## 10. Authorization/security model

- **No vendor-callable mutation exists in the billing router at all** — asserted by test (`billingRouterBlock` contains no `.mutation(`). A vendor cannot upgrade themselves by manipulating a request because there is no such endpoint to manipulate, not merely a check that might be bypassed. Plan changes are provider-event-driven (Phase 4B.5).
- **Self-scoped by construction**: `billing.mySubscription` takes **no input at all** and reads `ctx.user.id` only — no field exists that could target another vendor. Live cross-vendor isolation verified in §16.
- **Server-authoritative**: entitlements always re-derived from the DB; never cached in a session token, never trusted from a client.
- **Fails closed**: DB unavailable → FREE. An outage can never hand out paid entitlements.
- **Explicit allowlists** (Phase 4A discipline): `ADMIN_SUBSCRIPTION_COLUMNS` and `VENDOR_SUBSCRIPTION_COLUMNS` both **exclude every provider reference**; adding a column to the table does not expose it. Live-verified with deliberately-seeded `..._SHOULD_NOT_LEAK` values that appeared in neither response.
- **No card/token/credential data is stored anywhere** — provider-hosted checkout keeps BuildHub out of PCI scope entirely. Asserted by a schema test.
- **Writes are constrained by type**: `applySubscriptionPatch` accepts a `SubscriptionPatch` produced only by `domain.ts` transitions, never an arbitrary record — asserted by test.

## 11. Migration results

Applied to the disposable local MariaDB (`buildhub_verify`) with `drizzle-kit migrate` → `migrations applied successfully`.

- Both tables created; FK rules confirmed via `information_schema.REFERENTIAL_CONSTRAINTS`: `vendorSubscriptions_userId` = RESTRICT/RESTRICT; all three `billingEvents` FKs = SET NULL/RESTRICT — exactly as designed.
- **Existing data fully preserved**: users 8, rfqs 6, quotations 6, reviews 2 — identical before and after.
- **Rollback**: both tables are additive with nothing depending on them, so rollback is dropping two tables; no existing table gained a column or constraint, so no data-bearing change needs reversing.

## 12. Tests

**63 new tests**, all passing, no existing test modified or weakened.

`server/billingDomain.test.ts` (42) — approved plan set; FREE unpriced; exact 499/4,990/999/9,990 standard pricing; exact 299/699 founder pricing; **no annual founder price exists**; founder pricing never alters standard pricing; annual genuinely discounted; 30/7/6 durations; EGP-only currency rejection of USD/SAR/AED/EUR; invalid plan and interval rejection; entitlement values; entitlements never contain a verification/reputation/trust key (paying can never buy trust); enforcement-ledger completeness; trial start/in-progress/**lapsed-without-a-sweep**/exact-boundary; founder start, unapproved-annual rejection, window eligibility, **one-time-use**, **cancel-and-resubscribe cannot re-award**, founder active/expired, expiry-to-standard for both plans; activation month/year periods; cancellation keeps access then downgrades; **elapsed period without cancellation keeps access and flags sync gap**; failed payment → exactly 7-day grace; **entitlements retained through grace**; downgrade after grace; recovery clears grace; downgrade clears commercial state only and **touches no vendor business data**; terminal statuses; missing-row defaults.

`server/billingAuthorization.test.ts` (21) — public catalogue readable unauthenticated with approved values and no credential-shaped field; `mySubscription` rejects anonymous, resolves FREE with no row, **takes no userId input** (source-asserted), ignores a smuggled `{userId}` payload, honestly reports `checkoutAvailable: false`; **billing router has no mutation at all**; no endpoint accepts a client-supplied plan/price/status; service layer never writes a caller-supplied field set; admin endpoint rejects non-admin and anonymous, works for admin; **both allowlists exclude provider references**; no card/token/credential column in the schema; provider not configured and reported honestly; every Null provider operation throws; provider swappable without domain change; **domain names no provider**; no Paymob URL anywhere.

## 13. TypeScript

`npx tsc --noEmit` — clean, zero errors.

## 14. Frontend build

`vite build` — succeeded in 26.90s. The pre-existing ">500 kB chunk" advisory is unchanged and unrelated (this phase added no client code).

## 15. Server build

`esbuild` — succeeded, `dist/index.js` 169.0 kb.

## 16. Live verification

Real dev server against the real migrated MariaDB, real `auth.signInDummy` sessions.

**Catalogue & authorization**
- `billing.plans` unauthenticated → EGP, 30/7/6, Professional `{month: 499, year: 4990}`, Premium `{month: 999, year: 9990}`, founder `299`/`699`, **annual founder `null`**.
- `billing.mySubscription` unauthenticated → `401 UNAUTHORIZED`.
- `admin.vendorBilling` as vendor → `403 FORBIDDEN`; as admin → succeeds.

**Lifecycle derivation, driven by real DB rows** (`plan` = effective entitlement grant):

| Case | Stored row | Result |
|---|---|---|
| A | professional trialing, founder-priced, 20 days left | `plan=professional isPaid=True inTrial=True founderActive=True enquiries=30` |
| **B** | **same row, trial lapsed yesterday, no sweep ever ran** | **`plan=free isPaid=False enquiries=5`** |
| C | premium past_due, 3 days of grace left | `plan=premium isPaid=True inGrace=True enquiries=unlimited` |
| D | same row, grace expired yesterday | `plan=free isPaid=False enquiries=5` |
| E | premium active, cancelAtPeriodEnd, 10 days left | `plan=premium isPaid=True` |
| F | same row, paid period now ended | `plan=free isPaid=False` |

Case B is the load-bearing proof: stored status still reads `trialing`, yet the vendor correctly receives only FREE entitlements.

**Founder offer, through the real `admin.updateSetting` endpoint**
1. No cut-off configured → `founderEligible=False`
2. Admin sets `founderOfferEndsAt=2026-12-31` → `founderEligible=True`
3. Cut-off moved into the past → `founderEligible=False`
4. Window reopened but `founderPriceUsedAt` set → **`founderEligible=False`** (one-time use holds)

**Isolation & leakage** — vendor 1 (premium) sees premium, vendor 4 (no row) sees free. Seeded `CUST_/SUB_/PRICE_SHOULD_NOT_LEAK` provider references appeared in **neither** the admin nor the vendor response; only the provider *name* is exposed to admin, by design.

All test data removed afterwards; database restored to its pre-test state (0 subscriptions, 0 billing events, original 8/6/6/2 business rows intact).

## 17. Protected-branch verification

Checked before and after — all identical:
```
origin/main                                      71d891ffd6f654323ec7b54954b9a18cb63bb7a5
origin/archive/manus-login-fix-4fcb464           4fcb464e908963c053aafb2608b9d5ea741a28d2
origin/claude/phase4a64-dashboard-integration    c37442022fc421ef46301b7f663c0e118ce7de15
origin/claude/phase4a66-auth-security-hardening  42ee99c48f4a9b248bd236783bd094b493d84681
origin/claude/phase4a67-admin-user-data-security b67d9e7fdea793a5f07634e4fdc1ffffb7136670
origin/claude/phase4a-final-gate                 2cd8af3e5c89aa309e17e813f1bca59f0ffc1c20
```
No merge to main, no deploy, no publish, no force-push. Diff confined to billing files plus the four pre-existing untracked reports from earlier read-only tasks (untouched). No secret, credential, or production payment object created — grep over the diff for credential-shaped additions returned only this phase's own comments stating that none are stored.

## 18. Limitations

1. **Nothing enforces entitlements yet.** 4B.1 is the domain foundation; gating real features is 4B.2/4B.3/4B.6. The `ENTITLEMENT_ENFORCEMENT` ledger states this per entitlement rather than letting a defined value imply a working feature.
2. **No lifecycle sweep job.** Transitions are implemented and tested as pure functions but nothing schedules them (Phase 4B.4). Mitigated by design: time-derived entitlements mean a missing sweep cannot over-grant access — only the *persisted* status lags, never the *effective* one.
3. **No vendor or admin billing UI.** Deliberate: §10 said not to build a dashboard, and there is no checkout to drive one.
4. **`portfolioLevel`, `promotionalCapability`, `branchLimit`, `teamMemberLimit` are inert definitions** — the underlying features do not exist in BuildHub. Flagged in the ledger; they must not appear on a vendor-facing plan-comparison page as working capabilities.
5. **Qualified-enquiry allowance is a number, not yet a counter** — targeting and counting remain Phase 4B.3, per §11.
6. **Billing notifications will be in-app only** until Phase 4C adds outbound email/SMS.
7. **Annual founder pricing remains an open business decision** — represented as `null` and actively rejected rather than guessed.

## 19. Deferred Paymob dependency

No Paymob code, credential, or object exists in this phase, as instructed. The blocker is unchanged: **a Paymob sandbox/test merchant account is required** before Phase 4B.5 can be written or verified. Everything needed to plug it in is now in place — implement `PaymentProvider`, register it via `setPaymentProvider`, and the domain, schema, entitlements, and audit trail work unchanged. Nothing in this phase's design depends on any Paymob-specific behaviour, so a different provider (or Stripe, if the entity question is ever resolved) is an adapter swap rather than a redesign.

## 20. Final readiness status

# PASS — READY FOR PHASE 4B.2

The provider-agnostic billing domain is complete and verified: BuildHub can now represent FREE/PROFESSIONAL/PREMIUM and their full commercial lifecycle — trial, activation, renewal, founder pricing and its expiry, cancellation, failed payment with the approved 7-day grace, and downgrade — with **no dependency on any payment provider**. 410/410 tests pass, TypeScript is clean, both production builds succeed, the migration applied non-destructively with all existing data intact, and every authorization and data-exposure boundary was verified live. One real gap (the founder cut-off not being settable) was found and closed inside the phase.

**STOP.** Phase 4B.2 not started. Awaiting explicit authorization.
