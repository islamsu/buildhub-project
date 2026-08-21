# BuildHub — Phase 4B.3
## Real Vendor Directory, RFQ Targeting & Qualified-Enquiry Engine

**Branch:** `claude/phase4b3-vendor-directory-targeting`
**Date:** 2026-08-19
**Preceded by:** Phase 4B.1 (billing domain foundation), Phase 4B.2 (plan & entitlement engine)

---

## 1. Executive Summary

Phase 4B.3 turns the Phase 4B.2 entitlement engine into something a vendor can
actually consume. Five things were built, and only these five:

1. **A real vendor directory** — `/marketplace/vendors` no longer renders a
   hard-coded array of fictional companies. It reads genuine provider accounts
   from the database through an explicit server-side column allowlist.
2. **Vendor category declarations** — a provider declares which of the nine
   existing RFQ categories describe their work. BuildHub never guesses.
3. **Deterministic RFQ → vendor targeting** — exact-match category eligibility.
   No scoring, no inference, no AI, no fuzzy matching.
4. **Qualified-enquiry counting** — opening an eligible RFQ's detail consumes
   exactly one credit, once, ever, for that RFQ.
5. **Server-side enforcement of the FREE / PROFESSIONAL / PREMIUM limits** —
   5 / 30 / unlimited, enforced in the database transaction, not in the client.

No payment provider, no checkout, no subscription purchase, no featured
placement, and no pricing change was introduced. Paid ranking was explicitly
excluded and the enforcement marker for it was moved out of this phase.

**Result: PASS — READY FOR PHASE 4B.4.**

---

## 2. Scope Control

| Authorized in 4B.3 | Status |
|---|---|
| Real vendor directory | Delivered |
| Vendor category/service declarations | Delivered |
| Deterministic RFQ → vendor eligibility targeting | Delivered |
| Qualified-enquiry counting | Delivered |
| Server-side FREE/PROFESSIONAL/PREMIUM enquiry limits | Delivered |

| Explicitly out of scope | Status |
|---|---|
| Paymob / Stripe / any payment collection | Not touched |
| Subscription checkout | Not touched |
| Featured / paid placement | Not touched — deferred to 4B.6 |
| Pricing changes | None |
| Qualified-enquiry limit changes | None (5 / 30 / unlimited as authorized) |
| New taxonomy invention | None — the existing nine values were promoted, not replaced |
| Role → category inference | None — declarations are vendor-authored |
| AI matching / recommendation / scoring / auctions / bidding | None |
| Phase 3C migration 0012 | Unmodified |
| Weakening existing tests | None — one existing contract test caught a real regression in this phase's own UI and the UI was fixed to satisfy it |

---

## 3. The Shared RFQ Taxonomy

`shared/rfqCategories.ts` (new, 70 lines) promotes the nine category values that
were already in production use in the RFQ creation form from a client-only
constant to a shared module:

```
Materials · Labor · Complete Project · Engineering · Design ·
Furniture · Maintenance · Renovation · Custom Services
```

Nothing was invented. The list is byte-for-byte the list `RFQPage.tsx` already
offered; `RFQPage.tsx` now imports it instead of redeclaring it. This matters
because targeting compares an RFQ's stored category against a vendor's declared
category — if the two sides could drift, matching would silently degrade.

The module also owns the Arabic display labels. The **stored** value is always
the canonical English string; translation is presentation-only.

---

## 4. Vendor Category Declaration Model

BuildHub does not know what a "contractor" sells. Inventing a role → category
mapping would have meant asserting unverified domain claims about every existing
account, so targeting is driven by **vendor self-declaration** instead.

* `profile.myCategories` — reads the caller's declarations. **Takes no input at
  all**, so it is structurally incapable of reading another vendor's row.
* `profile.setMyCategories` — replaces the caller's declarations. Validates every
  value against the shared taxonomy, de-duplicates, and enforces the per-plan
  `serviceCategoryLimit` from the Phase 4B.2 resolver (FREE 3, paid plans
  higher). Writes are scoped to `ctx.user.id`; a `userId` in the request body is
  ignored by the schema and has no effect.
* A vendor with **zero** declarations is eligible for nothing. This is a
  deliberate, visible state — the UI warns about it explicitly.

---

## 5. Database Schema

Two additive tables, `drizzle/schema.ts`:

```ts
vendorCategories {
  id, userId → users.id (RESTRICT), category varchar(100), createdAt
  UNIQUE (userId, category)
  INDEX (category)
}

qualifiedEnquiries {
  id, userId → users.id (RESTRICT), rfqId → rfqs.id (RESTRICT),
  yearMonth varchar(7), planAtConsumption varchar(20),
  matchedCategory varchar(100), createdAt
  UNIQUE (userId, rfqId)
  INDEX (userId, yearMonth)
  INDEX (rfqId)
}
```

Design notes:

* **`UNIQUE(userId, rfqId)` is NOT scoped by month.** A lead the vendor already
  paid for is never re-charged, even in a later month.
* `planAtConsumption` and `matchedCategory` are recorded at consumption time so
  the history stays interpretable after a vendor changes plan or declarations.
* FK policy follows the Phase 3C convention: RESTRICT, so consumption history
  cannot be silently orphaned.
* Nothing deletes `qualifiedEnquiries` rows. The monthly reset is derived from
  `yearMonth`, not from a destructive sweep.

---

## 6. Migration Verification

Migration `drizzle/0015_greedy_gorilla_man.sql`, generated by `drizzle-kit`:

| Statement type | Count | Target |
|---|---|---|
| `CREATE TABLE` | 2 | new tables only |
| `ADD CONSTRAINT ... FOREIGN KEY` | 3 | new tables only |
| `CREATE INDEX` | 3 | new tables only |
| `ALTER TABLE` against a pre-existing table | **0** | — |

The migration is **purely additive**. Migration 0012 (Phase 3C) is untouched;
`drizzle/meta/_journal.json` was appended to, never rewritten.

Applied against the live verification database. Row counts before and after were
identical for every pre-existing table: 8 users, 6 rfqs, 6 quotations, 2 reviews.

---

## 7. Targeting Rules

`server/billing/enquiries.ts` keeps three concepts deliberately separate and
never conflates them:

| Concept | Question it answers | Source of truth |
|---|---|---|
| **Eligibility** | Does this RFQ's category match one the vendor declared? | `vendorCategories` + `rfqs.category` |
| **Entitlement** | How many qualified enquiries may this vendor consume this month? | Phase 4B.2 resolver, only |
| **Consumption** | Did the vendor open this RFQ's detail? | `qualifiedEnquiries` |

```ts
export function isVendorEligibleForCategory(declared, rfqCategory): boolean {
  if (!isClassifiableRfqCategory(rfqCategory)) return false;
  return declared.includes(rfqCategory);
}
```

Exact string equality, OR-matched across the vendor's declarations. Verified
non-behaviours: `'materials'` does not match `'Materials'`; `'Material'` does not
match `'Materials'`; `'Project'` does not match `'Complete Project'`. There is no
scoring function anywhere in the file.

Verification, verbatim from the live run:

```
A eligible: [9]   (declared Materials)
B eligible: [10]  (declared Design)
C eligible: [9,10] (declared Materials + Design)
```

---

## 8. Conservative Fallback for Unclassified RFQs

Six of the eight RFQs already in the verification database have `category = NULL`.
The fallback is therefore not hypothetical.

**An RFQ that cannot be classified is eligible for NOBODY through targeting.**

It is *not* treated as "eligible for everyone", because that would (a) expose
every RFQ to every vendor and (b) charge a credit for an opportunity the vendor
was never qualified for. It is also not silently classified into a guessed
category.

An unclassifiable RFQ remains **fully visible in the ordinary public RFQ
listing** — nothing is hidden from anyone who could already see it. It simply
never becomes a *targeted* qualified enquiry.

Live evidence: a PREMIUM-plan vendor declaring **all nine** categories was
refused the unclassified RFQ, with no row written.

```
PASS  CONSERVATIVE FALLBACK: unclassified RFQ eligible for nobody
PASS  Unclassified RFQ refused even to a matching-looking vendor
      — This request has no recognised service category, so it is not
        offered as a qualified enquiry.
```

---

## 9. Qualified-Enquiry Counting

Listing eligible RFQs is **free**. `rfq.eligible` consumes nothing, opens no
transaction, and writes no rows — browsing leads never costs a vendor anything.

A credit is consumed only by `rfq.openEnquiry`, and only the first time for a
given RFQ. `openQualifiedEnquiry` resolves in this order:

1. Load the RFQ. Absent → `NOT_FOUND`.
2. Classifiable? No → refused (`unclassified_rfq`).
3. Declared-category match? No → refused (`category_mismatch`).
4. Already consumed for this vendor+RFQ? → **grant immediately, no credit**.
5. Otherwise: transaction → range lock → allowance check → insert.

Every one of these decisions is re-derived server-side from the authenticated
`ctx.user.id`. The only caller input is `rfqId`.

---

## 10. Entitlement Enforcement

Allowances come from the Phase 4B.2 resolver and are **not duplicated** here.

| Plan | Allowance | Live result |
|---|---|---|
| FREE | 5 / month | 5 granted, 6th `FORBIDDEN`, exactly 5 rows persisted |
| PROFESSIONAL | 30 / month | 30 granted, 31st `FORBIDDEN`, exactly 30 rows persisted |
| PREMIUM | unlimited | 40 consecutive grants, 0 denials, 40 rows persisted |

A lapsed paid subscription falls back to the FREE allowance of 5, inheriting the
Phase 4B.2 time-derived fail-closed behaviour without re-implementing it.

The refusal message states only the caller's own allowance and reset date:

```
You have used all 5 qualified enquiries for this month.
Your allowance resets on 2026-09-01.
```

---

## 11. Concurrency

Two distinct races exist, and both are defended **at the database level**, not
in application logic.

**Race 1 — same vendor, same RFQ** (refresh, second tab, retry, duplicate
submit). Guarded by `UNIQUE(userId, rfqId)`. A losing insert raises
`ER_DUP_ENTRY`, which is caught and treated as *already consumed*: access is
granted and no second credit is spent. A non-duplicate database error is
**not** swallowed into a grant.

**Race 2 — same vendor, several different unseen RFQs at once.** A naive
count-then-insert would let all of them through. The count and the insert are
therefore performed inside one transaction, where the count is a
`SELECT ... FOR UPDATE` over the `(userId, yearMonth)` index range. Under
InnoDB REPEATABLE READ this takes next-key/gap locks across that range, so a
concurrent transaction for the same vendor and month blocks until the first
commits and then re-reads the true count. Locking is scoped to one vendor's own
month, so vendors never contend with each other.

**Live proof — 12 genuinely simultaneous HTTP requests for 12 distinct RFQs on a
FREE plan:**

```
12 simultaneous requests for 12 distinct RFQs, settled in 121ms
PASS  CONCURRENCY: exactly 5 granted, 7 denied
PASS  CONCURRENCY: exactly 5 rows in the database - the cap was never exceeded
```

**Live proof — 10 simultaneous requests for the SAME RFQ:**

```
PASS  SAME-RFQ RACE: all 10 requests succeed
PASS  SAME-RFQ RACE: exactly ONE credit consumed
PASS  SAME-RFQ RACE: usage reports 1 of 5 used
```

PREMIUM does not take the range lock at all — there is no allowance to serialise
against, so unlimited plans pay no locking cost.

---

## 12. Monthly Boundary

The period is the UTC calendar month, derived by `allowancePeriodFor(now)` from
Phase 4B.2. Usage counts only rows whose stored `yearMonth` equals the current
period key.

Live sequence (FREE vendor):

```
PASS  At the cap this month        — used 5, allowance 5, limitReached true
PASS  6th denied before the boundary
      → rows aged into the previous month
PASS  New month: usage resets to 0/5
PASS  New month: a new lead may be opened again
PASS  History preserved across the boundary (5 old + 1 new)  — rows=6
```

**Method disclosure:** the boundary was crossed by ageing the stored rows into
the previous month rather than by moving the server clock. This exercises the
real production mechanism — usage is a count of rows in the current period, so
consumption in a past month does not count against the current one — and it
demonstrates that nothing deletes history at the rollover. The wall clock itself
was not manipulated.

---

## 13. The Real Vendor Directory

`server/vendorDirectory.ts` (new, 179 lines) replaces the mock array.

**Visibility filter** — a provider appears only if all five hold:

```ts
inArray(users.userRole, PROVIDER_ROLES)   // contractor, engineer, architect,
                                          // supplier, project_manager
eq(users.isDummy, false)
eq(users.accountStatus, 'active')
isNull(users.deactivatedAt)
eq(users.onboardingStatus, 'approved')
```

Live verification seeded one visible-and-valid vendor per shape plus four that
must never appear:

```
directory: ["Nile Materials Co","Delta Design Studio"]
PASS  Directory is database-backed (real seeded providers present)
PASS  Frozen provider excluded
PASS  Unapproved provider excluded
PASS  Deactivated provider excluded
PASS  Homeowner excluded from the vendor directory
PASS  Dummy accounts excluded
```

Hidden vendors leak nothing indirectly either. The three excluded providers were
given a category (`Furniture`) that no visible vendor declares:

```
directory category list: ['Design', 'Materials']    → Furniture leaked: False
category=Furniture filter                           → []
```

**Reputation** is the live `AVG(rating)` / `COUNT(*)` over `verified = true`
reviews — the single definition approved in Phase 4A.6.2 and batched as
established in Phase 4A.6.9. The dead `users.rating` / `users.reviewCount`
columns are never read.

**Nothing fabricated.** The mock invented order counts, years in business,
delivery coverage and "recommended" badges. Real accounts have no such data, so
those fields are simply gone rather than faked.

---

## 14. Data Exposure

`DIRECTORY_VENDOR_COLUMNS` is an explicit allowlist. There is no
`select().from(users)` anywhere in the directory path.

Live payload keys, captured from the anonymous endpoint:

```
["id","name","bio","avatar","location","userRole","verified","createdAt",
 "categories","averageRating","reviewCount"]
```

Confirmed absent: `passwordHash`, `invitationToken`, `invitationExpiresAt`,
`email`, `phone`, `openId`, `accountStatus`, `frozenReason`, `isDummy`,
`creationNote`, `providerCustomerRef`, `providerSubscriptionRef`, `plan`.

The eligible-RFQ list is likewise restricted to lead fields — it never carries
`requesterId` or any requester contact detail.

`admin.vendorTargeting` is a troubleshooting view of declarations and
consumption. It carries **no payment information of any kind**; verified live by
serialising the response and asserting no payment or credential key appears.

---

## 15. Organic Ordering — Kept Separate From Paid Placement

`server/vendorDirectory.ts` reads **no** billing plan, subscription, or
entitlement. Ordering is `desc(users.verified), desc(users.createdAt)` — organic
only. A test asserts by source inspection that the identifiers
`vendorSubscriptions`, `resolveVendorEntitlements`, `getBillingState`,
`visibilityLevel`, `featuredPlacement` and `PLANS` appear nowhere in the file.

Consequently `shared/billing.ts` was corrected: `visibilityLevel` was marked
`'phase-4b.3'` in the enforcement map, but paid ranking is explicitly forbidden
this phase. It is now marked **`'phase-4b.6'`**. Claiming enforcement that does
not exist would have been the more damaging option.

The directory states the commitment to the reader rather than leaving it
implicit: *"Results are ordered organically. A paid plan never changes a
provider's position."*

---

## 16. API Surface Added

| Procedure | Tier | Input | Notes |
|---|---|---|---|
| `marketplace.vendors` | public | optional filters | real directory, column allowlist |
| `marketplace.vendorCategories` | public | none | distinct categories among visible vendors |
| `profile.myCategories` | approvedProvider | **none** | self-scoped by construction |
| `profile.setMyCategories` | approvedProvider | `{ categories }` | taxonomy-validated, plan-capped |
| `rfq.eligible` | approvedProvider | **none** | free; consumes nothing |
| `rfq.openEnquiry` | approvedProvider | `{ rfqId }` | consumes one credit, once |
| `billing.myEnquiryUsage` | protected | **none** | self-scoped usage meter |
| `admin.vendorTargeting` | admin | `{ userId }` | diagnostics, no payment data |

There is still **no mutation of billing state anywhere** — this phase adds
consumption records, not subscriptions.

---

## 17. Client Surfaces

* **`VendorsDirectory.tsx`** — rewritten against the real endpoint. Cards link to
  the existing `/vendor/:id` profile route.
* **`VendorServiceCategories.tsx`** (new) — category declaration. The valid list
  *and* the per-plan cap both come from the server; the component decides
  neither.
* **`QualifiedEnquiries.tsx`** (new) — usage meter, eligible-lead list, open
  action. The control is disabled only when genuinely blocking: an already-opened
  lead stays openable at the limit, because it costs nothing. On refusal the
  component shows the **server's** message rather than guessing one.
* **`RolePlatform.tsx`** — new `#role-enquiries` section for provider roles.
* **`RFQPage.tsx`** — now consumes the shared taxonomy instead of its own copy.

All static copy goes through the `t()` dictionary; 30 new keys were added with
matching English and Arabic values.

---

## 18. Automated Test Coverage

**71 new tests across two files, all passing.**

`server/rfqTargeting.test.ts` — 24 tests: taxonomy integrity, exact-match
eligibility, the conservative fallback, directory column allowlist, visibility
filtering, organic-ordering enforcement, and the concurrency *design*
(transaction present, `FOR UPDATE` present, unique constraint not month-scoped,
no delete path).

`server/rfqTargetingAuthorization.test.ts` — 47 tests covering every item the
brief enumerated:

| Requirement | Covered |
|---|---|
| Vendor category creation | ✅ |
| Category update | ✅ |
| Self-only modification | ✅ |
| Cross-vendor modification attempt | ✅ |
| Real vendor directory field allowlist | ✅ |
| Frozen / deactivated vendor exclusion | ✅ |
| RFQ eligibility | ✅ |
| Non-eligible vendor rejection | ✅ |
| Eligible vendor access | ✅ |
| Duplicate enquiry prevention | ✅ |
| Refresh prevention | ✅ |
| Concurrent requests | ✅ |
| Monthly boundary | ✅ |
| FREE limit = 5 | ✅ |
| PROFESSIONAL limit = 30 | ✅ |
| PREMIUM unlimited | ✅ |
| Client plan manipulation | ✅ |
| Client vendor-ID manipulation | ✅ |
| Client RFQ-ID manipulation | ✅ |
| Unauthorized access | ✅ |
| Customer attempting vendor-only endpoints | ✅ |
| Sensitive-field leakage | ✅ |

**Full suite: 524 tests, 39 files, all passing. No existing test was weakened.**

One existing contract test — `marketplaceDirectoriesLocalization.test.ts`, which
requires directory pages to route static copy through `t()` — caught a genuine
regression introduced by this phase's own rewrite of `VendorsDirectory.tsx`. The
page was fixed to satisfy the existing contract; the test was left exactly as it
was. The two new components were migrated to `t()` for the same reason.

---

## 19. Live Verification Evidence

Environment: MariaDB 10.11 + the real dev server (`server/_core/index.ts`), real
HTTP through the tRPC endpoint, real browser via Playwright/Chromium.

**Controlled dataset**: Vendor A (Materials), Vendor B (Design), Vendor C (both);
RFQ 1 (Materials), RFQ 2 (Design), RFQ 3 (unclassified); plus six directory
accounts covering visible, frozen, unapproved, deactivated and non-provider
shapes.

| Suite | Result |
|---|---|
| Targeting, eligibility, authorization, directory exposure | **32 / 32 passed** |
| Allowance ceilings, concurrency, monthly boundary, admin diagnostics | **24 / 24 passed** |
| Browser: directory + workspace, EN/AR, desktop 1440px and mobile 375px | **42 / 42 passed** |
| Browser: limit-reached UI state, EN/AR | **8 / 8 passed** |

**Real UI interaction, not simulated:** clicking *View details* in the browser
consumed exactly one credit, persisted as:

```
userId=1  rfqId=12  yearMonth=2026-08  planAtConsumption=free  matchedCategory=Materials
```

**Arabic/RTL** renders correctly at both breakpoints, including the localised
reset date (`١‏/٩‏/٢٠٢٦`). No horizontal overflow at 375px on any tested page.

**Harness note, disclosed rather than worked around:** the session cookie is
`SameSite=None`, which Chromium correctly rejects without `Secure`, so
authenticated browsing is impossible over the plain-HTTP dev server. This is
pre-existing platform behaviour from an earlier phase, not a Phase 4B.3 defect,
and changing it is out of scope. Rather than modify cookie code to suit a test,
a local TLS terminator was placed in front of the unmodified server so the
browser received exactly the cookie production would set. No application code was
changed for verification.

**Cleanup:** all fixtures were removed afterwards. The database was returned to
its pre-verification baseline — 8 users, 6 rfqs, 6 quotations, 2 reviews, and
zero rows in all three Phase 4B tables.

---

## 20. Regression Verification

| Gate | Result |
|---|---|
| Full test suite (`vitest run`) | 524 / 524 passed |
| TypeScript (`tsc --noEmit`) | clean, no output |
| Frontend build | succeeded |
| Server build | succeeded (`dist/index.js`, 191.6 kb) |
| Migration additive-only check | confirmed, 0 ALTERs on existing tables |
| Live API authorization tests | 32 / 32 |
| Live concurrency tests | passed under genuine parallel load |
| Browser / E2E | 50 / 50 |
| Branch integrity | all work on `claude/phase4b3-vendor-directory-targeting`; `main` untouched |

Regression areas explicitly re-verified through the suite: authentication,
logout revocation, admin data protection, compliance data protection, vendor
profile, reputation, vendor analytics, quotation comparison, billing domain,
entitlement resolver, and existing RFQ/quotation functionality.

---

## 21. Known Gaps, Deferred Items & Owner Decisions

**Deferred by design (not defects):**

1. **Paid placement / `visibilityLevel`** — deliberately not enforced. Marked
   `phase-4b.6`. Organic relevance and paid placement must stay separate concepts.
2. **Subscription purchase** — no vendor can currently *reach* PROFESSIONAL or
   PREMIUM through the product; plans are settable only by direct database
   state. Checkout remains blocked on the Paymob production-credential gap
   reported in the Phase 4B final blocker authorization.
3. **Historical RFQ classification** — six of the eight existing RFQs have
   `category = NULL` and are therefore targetable to nobody. This is the
   conservative fallback working as specified, but it means targeting has little
   live inventory until RFQs are created through the current form.

**Owner decisions still outstanding (unchanged from prior phases, not invented
here):**

* Whether existing uncategorised RFQs should be back-classified, and by whom.
* Whether category declarations should require any verification before a vendor
  can receive leads in a regulated trade.
* Whether the FREE allowance of 5 should apply to reopening old leads in a later
  month (current behaviour: reopening is always free, forever).

**No security defect was found or introduced in this phase.** No secrets, no
production credentials, and no payment objects were committed.

---

## Final Status

**PHASE 4B.3 — PASS — READY FOR PHASE 4B.4**
