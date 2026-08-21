# BuildHub — Phase 4B.4
## Subscription Lifecycle & Billing State Orchestration

---

## 1. Baseline

| | |
|---|---|
| **Baseline SHA** | `5258035` (tip of `claude/phase4b3-vendor-directory-targeting`) |
| **Branch** | `claude/phase4b4-subscription-lifecycle` |
| **Date** | 2026-08-20 |
| **Preceded by** | 4B.1 billing domain · 4B.2 entitlement engine · 4B.3 targeting & qualified enquiries |
| **`main`** | untouched (`71d891f`) |

---

## 2. Source-of-Truth Findings

Every claim below comes from reading and *executing* the current source, not from
prior reports. Three findings materially changed what this phase had to build.

### Finding 1 — `awaitingRenewalSync` granted paid access indefinitely (CRITICAL)

Phase 4B.1 documented this state as "no downgrade deadline is invented here."
Executed against the real function, that meant:

```
1 day after period end    effectivePlan=premium  isPaid=true
30 days after             effectivePlan=premium  isPaid=true
1 year after              effectivePlan=premium  isPaid=true
10 years after            effectivePlan=premium  isPaid=true
```

An `active` row whose paid period ended a decade ago still resolved to full
PREMIUM entitlements, including unlimited qualified enquiries. This is precisely
the "must NOT accidentally grant indefinite paid access" the brief §6 names.
**Fixed** — see §8.

### Finding 2 — `startTrial` silently cleared the founder one-time-use stamp (HIGH)

`startTrial` emitted `founderPriceUsedAt: founder ? now : null`. For a
*non*-founder subscription that wrote `NULL` over an existing stamp, erasing the
write-once guard. A vendor who had spent the founder offer, cancelled, and
re-subscribed at standard price would have their stamp wiped — and become
founder-eligible again on the following cycle. The approved rule is that founder
pricing "must never be re-awarded after cancellation/downgrade". **Fixed** — the
key is now omitted rather than nulled, which is what write-once has to mean.
Caught by a test written for §16, and confirmed live (§18, scenario M).

### Finding 3 — no orchestration layer existed at all

4B.1 provided pure transition *functions*; nothing applied them. Consequences:

* `applySubscriptionPatch` was a read-then-write with no transaction and no row
  lock — unsafe under concurrency, and unused.
* No `reverseCancellation`, no `changePlan`.
* The billing router carried **zero** mutations, so no lifecycle transition was
  reachable at all.
* No idempotency anywhere: nothing distinguished "apply" from "already applied".

### Confirmed sound, reused rather than rebuilt

| Component | Verdict |
|---|---|
| `deriveBillingState` time-derived resolution | Sound. Remains the authority. |
| Fail-closed on malformed rows (4B.2) | Sound. Extended, not replaced. |
| `billingEvents` audit table | Already carries actor, vendor, from/to status, source, note, timestamp — **no second audit framework was built**. |
| `UNIQUE(userId)` on `vendorSubscriptions` | Present. Makes the row lock and idempotency safe. |
| `shared/billing.ts` as sole price source | Sound. No commercial value was duplicated. |
| Phase 4B.3 enquiry counting | Untouched. Verified to follow lifecycle changes correctly. |

---

## 3. Lifecycle State Model

The brief's states are **derived, never stored**. The database keeps exactly one
`status` column; `lifecycleStateOf()` presents that column plus the
time-dependent facts around it. There is no second state system that could
disagree with the first — a test asserts the table still has exactly one status
enum and no `lifecycleState` column.

| Lifecycle state | Stored `status` | Paid? | Qualified-enquiry allowance |
|---|---|---|---|
| `FREE` | `free` / none | no | 5 |
| `TRIALING` | `trialing`, trial live | **yes** | plan's (30 / unlimited) |
| `ACTIVE` | `active`, period live | **yes** | plan's |
| `CANCELLATION_SCHEDULED` | `active` + `cancelAtPeriodEnd` | **yes** | plan's |
| `GRACE_PERIOD` | `past_due`, window live | **yes** | plan's |
| `PAST_DUE` | `past_due`, no window (malformed) | no | 5 |
| `AWAITING_RENEWAL_SYNC` | `active`, period elapsed, inside bound | **yes** | plan's |
| `RECONCILIATION_REQUIRED` | `active`, period elapsed, past bound | **no** | 5 |
| `EXPIRED` | `expired` / `canceled` / lapsed | no | 5 |

---

## 4. Trial Behaviour

* 30 days, from `TRIAL_DAYS` in the shared catalogue. Verified live: 30.
* A valid trial grants the **full** selected-plan entitlements.
* Expiry is decided **server-side by time**, not by a job. Live evidence: with
  the stored row still reading `trialing`, the resolver returned `free` and
  Phase 4B.3's allowance dropped from 30 to 5 immediately.
* If a payment lands, `TRIALING → ACTIVE`. Otherwise `→ FREE`.

**One trial per vendor, ever.** `startPaidTrial` previously had a hole: a lapsed
trial leaves the vendor unpaid, hence superficially eligible again, so a vendor
could chain unlimited free 30-day paid-plan trials. A write-once `trialStartedAt`
column now closes it, using the same discipline as `founderPriceUsedAt`. No
downgrade path clears it.

> **Stated as a rule I made explicit, not one I was handed.** The brief says
> "paid plans have a 30-day trial" (singular). Unlimited repeat trials would make
> the paid tiers optional, so one-per-vendor is the conservative reading. If the
> owner wants a different policy, this is a single guard to change.

---

## 5. Cancellation Behaviour

Approved policy, implemented exactly:

1. Vendor cancels → `CANCELLATION_SCHEDULED`. **Paid access is not removed.**
   Live: `lifecycleState=CANCELLATION_SCHEDULED`, `isPaid=true`, allowance 30.
2. No future renewal.
3. At period end → FREE. Live: allowance drops to 5.
4. Reconciliation records `plan=free, status=canceled`.

**Reversal** is supported while the paid period is still running, and refused
once it has ended (a new subscription is the correct path then). Both
cancellation fields are cleared together, so the row can never say "cancelled"
and "not cancelled" at once.

Nothing is deleted. A test asserts that `lifecycle.ts`, `domain.ts` and
`service.ts` contain **zero** `.delete(...)` calls of any kind.

---

## 6. Payment Failure & Grace

```
ACTIVE → (failure recorded) → GRACE_PERIOD → (7 days) → FREE
                            ↘ (recovery)   → ACTIVE
```

**Entitlements during grace — documented explicitly as the brief requires: the
vendor keeps their FULL paid entitlements for the whole 7-day window.** Live
evidence: after a recorded failure, `isPaid=true` and the PROFESSIONAL allowance
of 30 continued. Only once the window fully elapses does the vendor become FREE.
This follows the Phase 4B.1 rule already approved and is not a new policy.

The window is **never extended by repeated failure events** — a second failure
while already in grace is a no-op. Without that, duplicate provider webhooks
would push the deadline out indefinitely and hand a non-paying vendor unlimited
access.

**No provider retry behaviour is invented.** `recordPaymentFailure` /
`recordPaymentRecovery` record an outcome something *else* observed. A test
asserts no provider name, `charge(`, `capture(`, or `createCheckout` appears in
executable code.

---

## 7. Plan Changes

| Transition | Behaviour |
|---|---|
| FREE → PROFESSIONAL/PREMIUM | Via trial start; founder eligibility evaluated under the lock |
| PROFESSIONAL ⇄ PREMIUM | `changePlan` — entitlements swap immediately, price snapshot re-resolved |
| PROFESSIONAL/PREMIUM → FREE | **Refused as a plan change.** It is a cancellation, so the vendor keeps the period they paid for |

Deliberate non-behaviours, each verified:

* **The billing period is never restarted.** Live: `currentPeriodEnd` identical
  before and after an upgrade *and* a downgrade.
* **No proration, credit, or refund is computed.** Money movement belongs to the
  provider in 4B.5; inventing a proration rule would be inventing commercial
  policy nobody approved. A test asserts those terms appear nowhere in
  `changePlan`.
* **Founder pricing carries across but is never restarted or re-awarded.**

---

## 8. `awaitingRenewalSync` — Resolution

**Re-evaluated as a bounded transitional state, plus a new terminal
reconciliation state.**

An elapsed period with no cancellation means BuildHub does not yet know whether
the vendor paid. Two honest choices exist, and 4B.1 picked one of them
(retain access) without bounding it. Phase 4B.4 keeps the choice and adds the
bound:

```
period end ─── RENEWAL_SYNC_WINDOW_DAYS ───▶
  AWAITING_RENEWAL_SYNC        RECONCILIATION_REQUIRED
  paid access retained         paid access WITHHELD
  row intact                   row intact
```

`RENEWAL_SYNC_WINDOW_DAYS = GRACE_PERIOD_DAYS` (7). This **reuses the approved
number rather than inventing a competing one**: both windows answer the same
commercial question — "we do not yet know whether this vendor paid" — and 7 days
is the approved answer. A test asserts the two constants are equal, so they
cannot drift.

Past the bound the engine **invents neither success nor failure**. It stops
granting access it cannot justify, and preserves the row exactly as-is so a late
provider event can still settle it. Reconciliation deliberately reports `noop`
for this state rather than downgrading.

Live evidence:

```
1 day past period end    → AWAITING_RENEWAL_SYNC    plan=premium  allowance=null
6 days past period end   → AWAITING_RENEWAL_SYNC    plan=premium  allowance=null
8 days past period end   → RECONCILIATION_REQUIRED  plan=free     allowance=5
60 days past period end  → RECONCILIATION_REQUIRED  plan=free     allowance=5
5 years past period end  → RECONCILIATION_REQUIRED  plan=free     allowance=5

reconciliation leaves the unresolved row untouched  — premium/active/2021-08-20 (noop)
late confirmation restores ACTIVE premium           — ACTIVE/premium
```

> **Owner decision available.** 7 days is a defensible reuse of an approved
> value, not an approved value for *this* purpose. Changing it is a one-line
> edit to a single named constant.

---

## 9. Founder Lifecycle

| Rule | Status |
|---|---|
| PROFESSIONAL EGP 299/month, PREMIUM EGP 699/month | From the shared catalogue — never duplicated |
| Monthly only | Enforced |
| Six months, then standard pricing | Verified live: `299.00 → 499.00`, same row, same plan |
| One-time eligibility | Enforced by write-once `founderPriceUsedAt` |
| Never re-awarded after cancellation/downgrade | **Fixed this phase** (Finding 2) |
| No annual founder price invented | Enforced |

**Annual handling.** 4B.1's domain *throws* when asked for a founder annual
price, which meant a founder-eligible vendor could not buy an annual plan at all
— the sale was blocked rather than priced. The orchestrator now asks for founder
pricing only where an approved founder price exists, so an eligible vendor
choosing annual simply pays the approved **standard** annual price. The domain
still refuses an unapproved combination outright if anything ever asks for one;
this just never asks. No annual founder discount is invented.

Live (scenario M): after cancelling a founder subscription and re-subscribing
while the offer window was **still open**, the vendor was charged standard
PREMIUM `999.00`, `founderPriceActive=false`, and the original usage stamp was
unchanged.

---

## 10. Entitlement Integration (Phase 4B.3 Untouched)

Phase 4B.3 was not rebuilt. Its resolver was verified to follow lifecycle state:

| Lifecycle state | Allowance | Verified |
|---|---|---|
| FREE / expired / cancelled / grace-expired | 5 | live + unit |
| TRIALING professional · ACTIVE professional · GRACE professional | 30 | live + unit |
| TRIALING premium · ACTIVE premium · CANCELLATION_SCHEDULED premium | unlimited | live + unit |

On **downgrade**: future allowance follows FREE; historical
`qualifiedEnquiries` rows are untouched. Live evidence — after a full
cancel → period-end → reconcile cycle, the vendor's consumed enquiry was still
present and the counter reported `{used: 1, allowance: 5, remaining: 4}`.

On **upgrade**: no retroactive credits. A test asserts the lifecycle module never
inserts, updates, or deletes the enquiry ledger.

---

## 11. Idempotency

Every operation returns `applied`, `noop`, or `rejected`. `noop` reaches the API
as a **success**, not an error — repeating a completed transition is correct
behaviour, and the client sees the settled state.

| Repeated operation | Guarantee | Verified |
|---|---|---|
| Trial start | Cannot burn the founder offer twice; cannot start a second trial | unit + live |
| Cancellation | `canceledAt` keeps the moment the vendor actually decided | unit + live (1 audit event from 3 requests) |
| Cancellation completion | No double downgrade | unit |
| Payment failure | Grace window never extended | unit |
| Payment recovery / activation | Period never silently extended | unit |
| Plan change to the plan already held | Writes nothing | unit + live |
| Reconciliation | Converges to a fixed point | unit + live (`applied` then `noop`, `noop`) |

This is what will make Phase 4B.5's provider webhooks safe to retry, which every
payment provider eventually does.

---

## 12. Concurrency

Every transition runs inside one transaction holding a `SELECT ... FOR UPDATE`
row lock on the vendor's single subscription row, and the decision is made from
the row **re-read under the lock** — never a copy fetched before the wait. A test
asserts the locked read precedes the decision in source order.

Row creation races are resolved by `UNIQUE(userId)`: the loser catches
`ER_DUP_ENTRY` and proceeds against the winner's row, so a vendor can never end
up with two subscriptions.

Live results, real concurrent HTTP requests:

```
8 simultaneous cancellations       → applied=1 noop=7, exactly 1 audit event
3 racing plan changes              → settled on ONE coherent plan + price (professional @ 499.00)
                                     still exactly 1 subscription row
cancel racing resume               → self-consistent row (0/null)
```

The unit-test fake serialises its transactions for the same reason — a fake that
ran them in parallel would quietly pass code that races in production.

---

## 13. Auditability

**The existing `billingEvents` table was reused. No second audit framework was
built** — a test asserts the schema still contains exactly one audit table
(the pre-existing account trail).

Every transition records actor, affected vendor, previous status, new status,
source (`vendor` / `admin` / `system` / `provider`), timestamp, and a
human-readable state transition. Audit writes are best-effort by design: failing
to write history must never roll back the commercial change it describes.

Actions recorded across the live run:

```
cancellation_requested, cancellation_reversed, lifecycle_reconciled,
payment_failed, payment_recovered, plan_changed, subscription_activated,
trial_started
```

A test and a live check both confirm no secret, token, or provider handle is ever
written to the trail.

---

## 14. Security Model

**Server authority.** Every lifecycle function is keyed by a server-derived
`userId`. Nothing accepts a plan, status, price, trial, cancellation, or
entitlement from a client payload.

**Vendor surface — deliberately only two mutations:**

| Endpoint | Input | Why it is safe |
|---|---|---|
| `billing.cancelSubscription` | **none** | Can only reduce access |
| `billing.resumeSubscription` | **none** | Can only restore what the vendor had |

Both take *no input at all*, so there is no field to manipulate and no id to
substitute.

**Plan selection is NOT exposed to vendors in this phase.** No payment can be
collected before 4B.5, so a self-service subscribe or upgrade call would hand out
real paid entitlements — a 30-day trial, or PREMIUM's unlimited enquiries — for
nothing. The transitions exist and are fully tested; they are reachable only by
an administrator until the provider can charge for them, at which point 4B.5
connects checkout to the very same functions.

**Admin surface** (`adminProcedure`, explicit authorization): start trial, change
plan, record payment succeeded / failed / recovered, reconcile one vendor,
reconcile all due. Payment *outcomes* live here rather than on the vendor,
because a vendor must never be able to declare their own payment successful.

Live authorization results — all pass:

```
anon billing.myLifecycle / cancelSubscription / admin.startVendorTrial  → UNAUTHORIZED
homeowner cancelSubscription / resumeSubscription                       → FORBIDDEN
vendor admin.changeVendorPlan / startVendorTrial / vendorLifecycle
       / recordVendorPaymentSucceeded                                   → FORBIDDEN
forged plan/status on own endpoint                                      → changed nothing
forged userId on own endpoint                                           → other vendor untouched
```

---

## 15. Data Preservation

Live test: a full `cancel → period end → reconcile` downgrade, with row counts
captured before and after across users, rfqs, quotations, reviews,
vendorCategories, qualifiedEnquiries, messages, projects and notifications.

```
before: 8  6  6  2  1  1  0  2  2
after:  8  6  6  2  1  1  0  2  2      ← identical
billingEvents: 5 → 6                   ← append-only trail correctly GREW
```

Verified individually: profile, declared categories, reviews, reputation,
historical qualified enquiries, quotations, messages, and historical billing
records all survive. Only commercial fields on the subscription row change — a
test enumerates the downgrade patch's keys and asserts every one is a billing
field.

---

## 16. Schema Change

`drizzle/0016_remarkable_rhodey.sql`:

```sql
ALTER TABLE `vendorSubscriptions` ADD `trialStartedAt` timestamp;
```

One nullable column. No `NOT NULL`, no default change, no data rewrite, no
`DROP`. Applied against the live database with row counts identical before and
after (8 users, 6 rfqs, 6 quotations, 2 reviews). Migration 0012 (Phase 3C) and
0015 (Phase 4B.3) untouched; `_journal.json` appended to.

---

## 17. Tests

**73 new tests** in `server/subscriptionLifecycle.test.ts`, covering every item
the brief §16 enumerates:

| Requirement | Covered | Requirement | Covered |
|---|---|---|---|
| Vendor affects own subscription only | ✅ | Reactivation | ✅ |
| Cross-vendor access denied | ✅ | Founder offer | ✅ |
| Client plan manipulation denied | ✅ | Founder expiration | ✅ |
| Client status manipulation denied | ✅ | Founder reuse prevention | ✅ |
| Trial expiration | ✅ | Duplicate transition | ✅ |
| Valid trial | ✅ | Concurrent transition | ✅ |
| Cancellation at period end | ✅ | Missing billing state | ✅ |
| Cancellation reversal | ✅ | Stale billing state | ✅ |
| Payment failure | ✅ | Entitlement consistency | ✅ |
| Grace period | ✅ | Data preservation | ✅ |
| Grace expiration | ✅ | Audit correctness | ✅ |
| Downgrade | ✅ | | |

**Full suite: 598 tests, 40 files, all passing.**

**Two existing assertions were updated, and neither was weakened.** Both encoded
the Phase 4B.1-era fact that *the billing router has no mutation at all* — which
§10 of this brief explicitly authorizes changing. Each was replaced with the
stronger property it was actually protecting:

* "no mutation exists" → "every billing-router mutation is self-scoped and takes
  no access-granting input", plus a new assertion that plan selection is not
  reachable from the vendor surface at all.
* "the entire billing router still has no mutation" → "no billing-router mutation
  can raise a plan", naming the specific functions that must not appear there.

These survive the mutations existing, so they are strictly stronger than what
they replaced. The pre-existing assertion that no endpoint accepts a
client-supplied `plan:`/`status:`/`priceAmount:` **passed unchanged** throughout.

---

## 18. Live Verification

Real MariaDB 10.11, the real dev server, real HTTP through tRPC with real
authenticated sessions. Time travel is done by ageing **stored timestamps** —
the real mechanism the server derives from (stored state + wall clock). The clock
itself is never faked.

| Scenario | Result |
|---|---|
| A. FREE → PROFESSIONAL trial | ✅ TRIALING, allowance 30, 30 days |
| B. Trial still valid | ✅ paid entitlements, 4B.3 sees 30 |
| C. Trial expired, no paid state | ✅ FREE + allowance 5 **while the stored row still said `trialing`** |
| D. ACTIVE → cancellation scheduled | ✅ access retained, allowance 30 |
| E. Cancellation period ends | ✅ FREE, recorded as `free/canceled` |
| F. Payment failure | ✅ recorded |
| G. Failure → grace | ✅ 7 days, entitlements retained |
| H. Grace expiration | ✅ FREE, recorded as `free/expired` |
| I. Recovery before expiry | ✅ ACTIVE, grace cleared |
| J. PROFESSIONAL → PREMIUM | ✅ unlimited allowance, price 999.00 |
| K. PREMIUM → PROFESSIONAL | ✅ allowance 30, price 499.00, period unchanged |
| L. Founder → six-month expiry | ✅ `299.00 → 499.00`, one row |
| M. Founder cancel → re-subscribe | ✅ **offer NOT restored**, stamp intact |
| N. Repeated transitions | ✅ 1 applied + 2 noop, 1 audit event |
| O. Concurrent transitions | ✅ 8 concurrent cancels → exactly 1 |

**74 / 74 live lifecycle checks passed. 7 / 7 renewal-sync bound checks passed.**

All fixtures were removed afterwards; the database was returned to its baseline
(8 users, 6 rfqs, 6 quotations, 2 reviews, zero rows in all Phase 4B tables).

---

## 19. Regression Verification

| Gate | Result |
|---|---|
| Full test suite | 598 / 598 passed |
| TypeScript | clean |
| Frontend production build | succeeded |
| Server production build | succeeded (`dist/index.js`, 215.4 kb) |
| Migration additive-only | confirmed |
| Live authorization tests | all passed |
| Live concurrency tests | all passed |
| Data-preservation checks | all passed |
| Branch integrity | `main` untouched at `71d891f`; 4B.1/4B.2/4B.3 branches untouched |
| Secrets | none committed |

Re-verified through the suite: authentication, logout revocation, admin
user-data security, compliance security, vendor profile, reputation, vendor
analytics, quotation comparison, billing foundation, entitlement engine, vendor
directory, RFQ targeting, qualified-enquiry counting, and concurrency protection.

---

## 20. Payment Provider Deferral

Explicitly confirmed, and enforced by tests that scan executable code:

* **No Paymob integration.** No Stripe integration.
* **No payment credentials.** No `api_key`, `secret_key`, or card data anywhere.
* **No production payment objects.** No checkout, no charge, no capture.
* **No production deployment.**

`recordPaymentSucceeded` / `recordPaymentFailure` / `recordPaymentRecovery`
record outcomes something else observed. They never assert a charge happened and
never retry one. Phase 4B.5 replaces the admin trigger with the provider as the
observer, calling the **same idempotent functions**.

---

## 21. Limitations & Owner Decisions

**Limitations (stated, not worked around):**

1. **No scheduler.** `reconcileDueSubscriptions` exists and is correct, but
   BuildHub has no job runner and building one is outside this phase. It is
   triggered manually via an admin endpoint. This is not a correctness gap:
   access revocation never depended on the sweep — expiry is decided by time in
   the resolver, proven live in scenario C.
2. **Vendors cannot subscribe themselves.** By design, until 4B.5 can charge.
   The lifecycle is complete and tested; only the vendor-facing entry point is
   withheld.
3. **No proration.** A mid-period plan change moves entitlements immediately with
   no money adjustment. Deliberate — proration is a commercial policy, not an
   engineering default.
4. **No vendor-facing UI** for the lifecycle was built. Out of scope (§14
   forbids the billing dashboard); the read model is prepared for it.

**Owner decisions outstanding:**

1. **Renewal-sync window = 7 days.** Reuses the approved grace period rather than
   inventing a number. Confirm or set a different value (one constant).
2. **One trial per vendor.** Made explicit this phase. Confirm.
3. **Founder-eligible vendor choosing annual** pays standard annual. Confirm that
   this — rather than blocking the sale, which is what 4B.1 did — is intended.
4. **Grace-period entitlements are full paid entitlements.** Inherited from the
   approved 4B.1 rule and now documented explicitly. Confirm, or specify a
   reduced set.
5. **Proration policy** for mid-period plan changes, needed before 4B.5.

**No security defect was introduced.** Two pre-existing defects were found and
fixed (§2 Findings 1 and 2).

---

## 22. Final Status

**PHASE 4B.4 — PASS — READY FOR PHASE 4B.5**

The five owner decisions above are confirmations of documented, conservative
choices, not blockers: each has a defensible default already implemented, tested,
and live-verified. Phase 4B.5 can connect a payment provider to a lifecycle that
is serialised, idempotent, fail-closed, auditable, and unable to over-grant.
