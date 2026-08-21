# BuildHub — Phase 4B.2: Plan & Entitlement Engine

## 1. Baseline SHA

`cfb15536c1bbbf77ccf6854b6922791256b2c0f9` (`claude/phase4b1-billing-domain-foundation`), as instructed.

## 2. Branch

`claude/phase4b2-plan-entitlement-engine`. No merge to main, no deploy, no publish.

## 3. Source-of-truth findings

Verified against the actual Phase 4B.1 implementation, not against its report.

**Confirmed present and correct:** `shared/billing.ts` catalogue (499/4,990, 999/9,990, founder 299/699 monthly-only, 30-day trial, 7-day grace, 6-month founder window, EGP-only); `domain.ts` time-aware `deriveBillingState`; `service.ts` DB layer failing closed to FREE; `provider.ts` `NullPaymentProvider` throwing on every operation; migration `0014` applied; billing router read-only. Repo-wide grep confirmed **zero** scattered `plan === '…'` checks anywhere in `server/` or `client/src/` — the pre-condition for centralising was genuinely met, not just claimed.

**Defect found in the inherited implementation — over-grant on malformed data.** `deriveBillingState`'s `elapsed(at, now)` helper returns `false` for a `null` timestamp, so a paid status whose governing timestamp was missing fell through to the *grant* branch. Probed directly against the real code before changing anything:

```
status=trialing  + all date fields NULL -> effectivePlan=premium isPaid=true
status=past_due  + all date fields NULL -> effectivePlan=premium isPaid=true
status=active    + all date fields NULL -> effectivePlan=premium isPaid=true
```

A corrupt or partially-written row granted **unlimited Premium entitlements indefinitely**, with nothing able to ever expire it. This is precisely the "stale billing state" hazard §12 asks to be tested for. It is unreachable through normal flow — every transition in `domain.ts` always writes its governing timestamp — so it can only arise from a manual DB edit, a partial write, or a future provider-sync bug. Hardened in this phase (§6).

## 4. Entitlement architecture

One engine, `server/billing/entitlements.ts`:

```
resolveVendorEntitlements(userId, now)      ← the single entry point
  └─ service.getBillingState(userId, now)   ← DB read, fails closed
       └─ domain.deriveBillingState(row, now)  ← pure, time-aware
  └─ buildResolution(...)                   ← pure projection (exported for tests)
```

`VendorEntitlementResolution` returns every field §2 requires: effective plan, stored plan, status, isPaid, trial state and end, cancellation state, current period end, billing interval, grace state and end, `awaitingRenewalSync`, `dataIntegrityIssue`, founder state and end, the full entitlement set, the qualified-enquiry allowance, the allowance period, and a status for every named capability.

**Named capabilities** replace field-poking and plan comparisons: `can(resolution, 'advanced_analytics')` rather than `plan === 'premium'`. `CAPABILITY_RULES` maps each capability to the entitlement field that decides it, so a plan id is compared in exactly one place in the codebase.

**Three-valued capability status — the honesty mechanism for §10:**
- `granted` — the plan allows it.
- `available` — a real product surface exists (read from Phase 4B.1's `ENTITLEMENT_ENFORCEMENT` ledger).
- `usable` — both.

`toVendorEntitlementResponse` surfaces **only `usable`**. A Premium vendor is *granted* `full_portfolio`, `promotional_campaigns`, `multi_branch` and `multi_team`, but BuildHub has not built any of those features — so they resolve to `false` for the vendor and can never be advertised as working. Verified by test and live.

## 5. Effective-plan resolution rules

| Stored state | Effective plan |
|---|---|
| No row at all | FREE |
| `free` / `canceled` / `expired` | FREE |
| `trialing`, trial not yet ended | stored plan |
| `trialing`, trial ended | **FREE** (no sweep required) |
| `active`, period running | stored plan |
| `active`, period ended, `cancelAtPeriodEnd` | **FREE** |
| `active`, period ended, no cancellation | stored plan + `awaitingRenewalSync` |
| `past_due`, within grace | stored plan + `inGracePeriod` |
| `past_due`, grace elapsed | **FREE** |
| any paid status missing its governing timestamp | **FREE** + `dataIntegrityIssue` |
| unrecognised status | **FREE** + `dataIntegrityIssue` |

Resolution is derived from stored state **and the current time**, never stored status alone. A late, failed, or entirely absent background job cannot over-grant access — the sweep persists what the engine already computes.

## 6. Time-boundary behaviour

Boundaries are **inclusive at expiry** (`now >= at` ⇒ elapsed) and tested to ±1 ms with a fixed clock — no sleeps, no wall-clock dependence.

- Trial: grants at `end − 1ms`, does not at `end`, does not at `end + 1ms`.
- Billing period (with cancellation): identical three-point behaviour.
- Grace: entitlements persist to the last millisecond, stop exactly at expiry.
- Founder window: discount applies to the last millisecond; at expiry `founderPriceActive` flips false **while access continues unchanged**.
- Allowance period: UTC calendar month. `2026-08-31T23:59:59.999Z` → `2026-08`; `2026-09-01T00:00:00.000Z` → `2026-09`. December→January year roll and a 2028 February leap-day boundary both covered. Computed in UTC so a server locale cannot place a request in the wrong month.

**Hardening applied this phase:** a paid status missing its governing timestamp now fails **closed** to FREE and reports why. Re-probed after the fix:

```
trialing  all-null -> plan=free isPaid=false issue='status "trialing" without trialEndsAt'
past_due  all-null -> plan=free isPaid=false issue='status "past_due" without gracePeriodEndsAt'
active    all-null -> plan=free isPaid=false issue='status "active" without currentPeriodEnd'
```

## 7. Founder pricing behaviour

Unchanged from 4B.1 and re-verified: monthly-only (annual founder pricing is `null` and actively rejected, never invented); one-time-use structurally enforced by write-once `founderPriceUsedAt` which `downgradeToFree` deliberately never clears; eligibility evaluated only when a new paid subscription starts, so no retroactive grants. The engine exposes `founderPriceActive` and `founderPriceEndsAt`. At window expiry the discount ends and **access is unaffected** — repricing the row to standard is the 4B.4 sweep's job, and the engine already reports the correct post-expiry state in the meantime.

## 8. Trial behaviour

30-day trial grants full paid-plan entitlements. On expiry the effective plan becomes FREE immediately, without any background job — live-proven in scenario D, where the stored status still reads `trialing` yet the vendor correctly receives FREE with a 5-enquiry allowance.

## 9. Cancellation behaviour

Scheduled cancellation keeps paid entitlements for the whole already-paid period, then drops to FREE at period end. No vendor data is touched: the billing domain only ever produces patches for the subscription row, and a test asserts no downgrade patch contains a key naming profile, reviews, portfolio, quotations, RFQs, products, or reputation.

## 10. Grace behaviour

The approved 7-day architecture is preserved intact. The engine distinguishes all seven states — `active`, `trialing`, cancellation-scheduled, `past_due`, in-grace, `expired`, `free` — and represents the provider dependency honestly: an elapsed period with no cancellation keeps access and sets `awaitingRenewalSync` rather than fabricating either a renewal or a downgrade. No Paymob-specific behaviour was invented.

## 11. Server-authoritative security model

- **No mutation exists in the billing router at all** — asserted by test. A vendor cannot upgrade themselves because there is no endpoint to manipulate.
- **Self-scoped by construction**: `myEntitlements` and `myPlan` take *no input whatsoever* and read `ctx.user.id` only — asserted by source test for both.
- **Forged payloads are inert**: a request carrying `{plan:'premium', entitlements:{qualifiedEnquiriesPerMonth:9999}, isPaid:true}` returns `free` / `5` / `false`, because the response is built from server state and the procedures accept no input.
- **Fails closed**: DB outage, missing row, malformed row, or unknown status all resolve to FREE.
- **Explicit response allowlist**: no provider reference, and no internal field (`userId`, `storedPlan`, `resolvedAt`, `awaitingRenewalSync`, `dataIntegrityIssue`) reaches the vendor.
- **One comparison site**: a test asserts zero `plan === '…'` comparisons remain anywhere in `routers.ts`.

## 12. API surface

| Endpoint | Access | Notes |
|---|---|---|
| `billing.plans` | public | catalogue for a pricing page |
| `billing.mySubscription` | authenticated | 4B.1, self-scoped |
| `billing.myEntitlements` | authenticated | **new** — full effective entitlements, allowlisted |
| `billing.myPlan` | authenticated | **new** — effective plan id only |
| `admin.vendorBilling` | admin | extended this phase (§13) |

`admin.vendorBilling` now returns effective **and** stored plan, trial/cancellation/period/grace/founder state, and `dataIntegrityIssue` — so support sees a *diagnosed* corrupt row rather than an unexplained downgrade. It keeps the `ADMIN_SUBSCRIPTION_COLUMNS` allowlist: no provider customer/subscription/price reference, and BuildHub stores no card, token, or credential anywhere to begin with.

## 13. Tests

**+43 new tests (453 total, all passing). No existing test modified or weakened.**

`server/billingEntitlementEngine.test.ts` (36) — FREE/PROFESSIONAL/PREMIUM resolution and allowances; stored-vs-effective plan; valid and expired trial; ±1 ms boundaries for trial, billing period, grace and founder expiry; allowance-period month key/start/reset, end-of-month, year roll, leap day, UTC safety; cancellation scheduled and completed; elapsed-period sync gap; all terminal states; **five malformed/stale-state cases failing closed with diagnostics**; healthy row reporting no issue; capability status shape; per-plan grants; **granted-but-unavailable capabilities not usable**; lapsed vendor losing every capability; vendor-response allowlist (no provider refs, no internals); usable-only capability exposure; allowance correctness per plan.

`server/billingAuthorization.test.ts` (+7, now 28) — `myEntitlements`/`myPlan` reject anonymous callers; FREE resolution with no record; **neither endpoint accepts a userId**; **forged plan/entitlement payload ignored**; billing router still has no mutation; **no scattered plan comparisons remain**.

## 14. Live verification

Real dev server against the real MariaDB, real `auth.signInDummy` sessions, ten controlled vendor states per §14:

| | Scenario | Result |
|---|---|---|
| A | FREE (no record) | `plan=free isPaid=False allowance=5 featured=False boosted=False` |
| B | PROFESSIONAL active | `plan=professional isPaid=True allowance=30 boosted=True featured=False` |
| C | PROFESSIONAL trial valid | `plan=professional inTrial=True allowance=30` |
| **D** | **PROFESSIONAL trial expired, no sweep** | **`plan=free isPaid=False allowance=5`** |
| E | PREMIUM active | `plan=premium allowance=None featured=True` |
| F | Founder Professional (299) | `founder=True plan=professional allowance=30`, stored price `299.00` |
| G | Founder after 6 months | `founder=False` — **access retained**, discount ended |
| H | Cancelled at period end | in-period `plan=premium`; after period `plan=free` |
| I | Payment failed, in grace | `plan=premium inGrace=True allowance=None` |
| J | Payment failed, grace expired | `plan=free isPaid=False allowance=5` |

**Malformed state, live:** a `premium`/`active` row with no `currentPeriodEnd` → vendor sees `plan=free isPaid=False`; admin sees `storedPlan=premium effectivePlan=free dataIntegrityIssue='status "active" without currentPeriodEnd'`.

**Isolation, live:** vendor 1 (premium) → `premium`; vendor 4 (no record) → `free`. Non-admin calling `admin.vendorBilling` → `403 FORBIDDEN`.

All test data removed afterwards; database restored to 0 subscriptions, 0 billing events, original 8 users / 6 RFQs / 6 quotations / 2 reviews intact.

## 15. TypeScript

`npx tsc --noEmit` — clean, zero errors.

## 16. Frontend build

`vite build` — succeeded in 25.18s. No client code was added this phase; the pre-existing chunk-size advisory is unchanged.

## 17. Server build

`esbuild` — succeeded, `dist/index.js` 175.2 kb.

## 18. Regression results

453/453 tests pass, including every Phase 4A suite unmodified. Live re-verification against the running server:

- `auth.me` — clean of `passwordHash`/`invitationToken`
- `admin.users` — allowlist intact, clean
- `admin.complianceQueue` — clean
- Vendor profile (4A.6.1) — `Nile Construction Co., verified=true`
- Dynamic reputation (4A.6.2) — `avg=4.5 count=2`
- Quotation ownership / IDOR fix (final gate) — non-owner correctly `BLOCKED: You do not own this RFQ`
- Logout revocation (4A.6.6) — replay after logout `UNAUTHORIZED`

No unrelated functionality was modified. **No migration was added in this phase** — the engine is code-only; `drizzle/` is unchanged since `0014`.

## 19. Limitations

1. **Nothing enforces entitlements yet.** The engine *resolves*; gating real features is 4B.3 (enquiries, visibility) and 4B.6 (featured placement). No `requireCapability` middleware was added because no endpoint needs gating yet — adding an unused middleware would be speculative.
2. **Qualified-enquiry counting is not implemented**, per §9. The engine exposes the allowance (5/30/unlimited) and the UTC month period with its reset instant; 4B.3 supplies the definition and counter.
3. **No lifecycle sweep job** (4B.4). Mitigated by design — the effective plan is always correct even when the persisted status lags.
4. **`full_portfolio`, `promotional_campaigns`, `multi_branch`, `multi_team` remain granted-but-unavailable** — the underlying features do not exist. Structurally prevented from being shown to vendors as usable.
5. **`dataIntegrityIssue` is reported, not alerted.** Support can see it via `admin.vendorBilling`; no monitoring or alerting exists (an infrastructure concern, Phase 5).
6. **Founder repricing at the 6-month boundary is not yet persisted** — the engine correctly reports the discount as ended, but writing `priceAmount` back to standard is 4B.4's sweep.
7. **No vendor or admin billing UI**; deliberate, out of scope.

## 20. Deferred Paymob dependency

Unchanged and untouched: no Paymob, Stripe, or Fawry code, credential, or object exists. A test asserts `domain.ts` and `service.ts` contain none of those names, and that `provider.ts` contains no provider URL. The blocker remains a **Paymob sandbox/test merchant account**, required before 4B.5. Nothing in this phase's design depends on provider-specific behaviour.

## 21. Final status

# PASS — READY FOR PHASE 4B.3

The centralized, server-authoritative plan and entitlement engine is complete and verified. One entry point answers "what is this vendor entitled to right now?" for all three plans across every lifecycle state, resolved from approved commercial rules and current billing state, correct to the millisecond at every boundary, and failing closed on outage, absence, corruption, and unknown status alike.

A real over-grant defect inherited from Phase 4B.1 — malformed paid rows granting unlimited Premium indefinitely — was found by probing the actual implementation, fixed, and covered by tests.

453/453 tests pass, TypeScript is clean, both production builds succeed, all ten required live scenarios match the approved rules, and Phase 4A functionality is fully intact. Protected branches unchanged; no credentials, payment objects, or provider integration exist.

**STOP.** Phase 4B.3 not started — no RFQ targeting, no vendor directory, no featured placement, no provider integration.
