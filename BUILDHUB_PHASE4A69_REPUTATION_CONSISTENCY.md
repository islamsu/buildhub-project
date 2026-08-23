# BuildHub — Phase 4A.6.9: Reputation Consistency Hardening

Branch: `claude/phase4a69-reputation-consistency`, created from `claude/phase4a68-account-session-security` @ `63e8c08530cccde1b14ba8afea9b33e11eca1b1d` (the cumulative-audit commit). No Phase 4B/Stripe/monetization work performed. `main` not modified, not merged, not published.

## 1. Exact root cause

Independently re-traced from source, not assumed from the cumulative audit's report. `rfqRouter.quotations` (`server/routers.ts`, the endpoint behind the homeowner's quote-comparison screen) selected `providerRating: users.rating, providerReviews: users.reviewCount` — a `leftJoin` onto the `users` table's own stored `rating`/`reviewCount` columns. A repo-wide search confirms **no code path anywhere writes to these two columns** (`db.update(users).set({...rating...})` does not exist in the codebase) — they hold only their schema defaults (`'0.00'`, `0`) forever. Meanwhile `reviews.statsForUser` (Phase 4A.6.2, used by both the Vendor Profile page and the Vendor Dashboard's `VendorReputation` component) computes `AVG(rating)`/`COUNT(*)` live from the `reviews` table, filtered to `verified = true`. The two code paths were answering the same question ("what is this vendor's reputation?") with two different, disagreeing data sources — one live and correct, one dead and always zero. Client-side, `client/src/components/QuotationComparison.tsx` consumed the dead value in three places: the star/count display, the "sort by rating" control, and — most consequentially — the 25%-weighted `providerRating` term of the composite `computeScore()` match score shown to homeowners, meaning every vendor's match score was silently computed as if they had zero reputation, regardless of reality.

## 2. Exact files changed

```
modified:   server/routers.ts                              (rfqRouter.quotations)
modified:   client/src/components/QuotationComparison.tsx   (type + 4 call sites)
new file:   server/quotationReputationConsistency.test.ts   (11 regression tests)
new file:   BUILDHUB_PHASE4A69_REPUTATION_CONSISTENCY.md
```
No other file was touched. `drizzle/schema.ts` and every migration file (including `0012_broken_nightmare.sql`) are untouched — the `users.rating`/`reviewCount` columns still exist in the schema (deliberately not dropped or migrated; see §16), they are simply no longer read by this one query.

## 3. Exact reputation source of truth

`rfqRouter.quotations` now issues a second, grouped aggregate query — scoped only to the distinct `providerId`s present in the quotations result (no N+1: one extra query per request, not one per row) — computing, per provider: `AVG(reviews.rating)` and `COUNT(*)`, filtered to `reviews.verified = true`, rounded with the identical formula already approved in `reviews.statsForUser`: `Math.round(avg * 10) / 10`. This is a second implementation of the same *definition*, not a competing one — the filter (`verified = true`), the aggregate functions (`AVG`/`COUNT`), and the rounding rule are all copied verbatim from the already-approved Phase 4A.6.2 design, applied here as a batched (multi-vendor) form of the same single-vendor query `reviews.statsForUser` already runs. `reviews.statsForUser` itself was not modified — it remains the canonical single-vendor entry point, untouched.

## 4. Security impact

Re-verified, not assumed:
- The new aggregate query selects only `revieweeId, avg, count` from `reviews` — no `users` columns, no `passwordHash`, no `invitationToken`, nothing new added to the response.
- The pre-existing `users` join projection (`providerName, providerEmail, providerVerified, providerRole, providerLocation`) is unchanged by this fix — still no `passwordHash`/`invitationToken`/`username`, confirmed by both source read and a new regression test.
- `providerId` used to group the aggregate comes only from the already-fetched `quotations` rows for the given `rfqId` — never from client input. The endpoint's `z.object({ rfqId: z.number() })` input schema still has no `providerId`/`vendorId` field, so there is no way for a caller to request another vendor's reputation be attached to a quotation it doesn't belong to.
- **Pre-existing, unrelated, out-of-scope observation (not fixed):** `rfq.quotations` itself has no ownership check on `input.rfqId` — any authenticated user can call it for any RFQ id and see that RFQ's quotations (including vendor emails). This predates this phase, is not part of the reputation-consistency problem, and per this task's explicit scope ("Fix ONLY the reputation consistency problem" / "Do not redesign the reputation system") was left untouched. Flagged here for visibility, not remediated.
- No existing security test was weakened. `server/reviewsAuthorization.test.ts`, `server/vendorReputation.test.ts`, `server/adminUserDataSecurity.test.ts`, and every other pre-existing test file are byte-for-byte unmodified and still pass.

## 5. Before/after behavior

**Before:** for any vendor, `providerRating` was always `"0.00"` and `providerReviews` was always `0` in the quote-comparison view, regardless of how many real reviews the vendor had — because the underlying `users.rating`/`users.reviewCount` columns are never written. This silently zeroed 25% of every quotation's match score and always sorted "by rating" as a no-op tie.

**After:** live-verified with a real seeded vendor ("Nile Construction Co.", user id 1, 2 real verified reviews rated 5 and 4) — `rfq.quotations` for a real RFQ with a real quotation from this vendor now returns `providerRating: 4.5, providerReviews: 2`, computed live from the same 2 review rows `reviews.statsForUser` uses. Match scores, sort-by-rating, and the displayed stars/count all now reflect the vendor's real reputation.

## 6. Cross-surface consistency result

For the same seeded vendor (user id 1, "Nile Construction Co.", 2 verified reviews: ratings 5 and 4 → average 4.5):

| Surface | Query | Result |
|---|---|---|
| `reviews.statsForUser` (source of truth) | direct API call | `{averageRating: 4.5, reviewCount: 2}` |
| `rfq.quotations` (this fix) | direct API call, real RFQ/quotation | `providerRating: 4.5, providerReviews: 2` |
| Vendor Profile page (`/vendor/1`) | live browser | "4.5" + "★★★★★" (rounded) + "2 Reviews" |
| Homeowner quote comparison (real RFQ, real browser) | live browser | 5 filled stars (Math.round(4.5)=5) + "(2)" |

All four agree exactly, using the identical rounding rule. Verified against two independent real RFQs/quotations for the same vendor (Bathroom Fitout RFQ id 4, and Kitchen Remodel RFQ id 3) — same result both times, confirming the consistency isn't row-specific.

## 7. Live browser verification

Real local dev server (`tsx server/_core/index.ts`) + real local MariaDB (`buildhub_verify`), real `auth.signInDummy`-issued session for `testhomeowner`, cookie-seeded into a real browser context per the established methodology (never route interception). Navigated to the real `/rfq` list page and clicked the real "Compare Quotes" button on a real RFQ card to open `QuotationComparison` exactly as an ordinary user would.

- **Desktop** (`/tmp/4a69_desktop_comparison.png`): "Bathroom Fitout RFQ" comparison dialog, vendor "Nile Construction Co.", 5 stars, "(2)", price 30,000 EGP, match score 108/100, status "Rejected" (the quotation's real, unmutated status).
- Bonus evidence surfaced incidentally while locating the right RFQ card: "HVAC Install RFQ" showing vendor "Delta Electric Co." with 0 real reviews rendered correctly as empty stars and "(0)" — live confirmation of the zero-review edge case in the real UI, not just the unit tests.

## 8. Arabic/RTL result

`/tmp/4a69_arabic_rtl.png` — after toggling the app to Arabic, `document.documentElement.dir` confirmed `"rtl"` via direct evaluation. Opened the "Kitchen Remodel RFQ" comparison (same vendor, a different, already-accepted quotation, 50,000 EGP): fully mirrored layout, "تم الترسية" (awarded) badge, all comparison labels translated, stars still showing 5/(2) for the same vendor — value unaffected by language, exactly as expected since reputation is language-independent data. **Pre-existing, unrelated observation:** the vendor's role label ("Contractor") renders in English even in the Arabic view (`q.providerRole?.replace('_', ' ')` in `QuotationComparison.tsx` is never passed through a translation map) — a minor, pre-existing localization gap, not part of this fix's scope, not touched.

## 9. Mobile result

`/tmp/4a69_mobile_375.png` — 375px viewport, same vendor/RFQ, comparison dialog renders cleanly stacked below the RFQ list, 5 stars/(2) visible and correctly sized, `document.documentElement.scrollWidth > clientWidth` evaluated `false` — no horizontal overflow.

## 10. Regression tests

`server/quotationReputationConsistency.test.ts`, 11 tests, all passing:
- Zero reviews → `null` rating, `0` count, not `NaN`.
- One review → exact rating, count 1.
- Multiple reviews → correctly rounded average (`4.3333` → `4.3`), matching `reviews.statsForUser`'s exact rounding rule.
- Perfect 5.0 average → exactly `5`.
- Non-integer average (`3.666666`) → rounds to exactly `3.7`.
- Aggregate query source-verified to filter on `reviews.verified, true` and `groupBy(reviews.revieweeId)`.
- Multi-vendor result where one provider has reviews and another has none at all → each gets its own correct value, no cross-contamination, no crash.
- Source-verified: no more `users.rating`/`users.reviewCount` column references in this endpoint's projection (regex-scoped to actual column usage, not prose comments).
- Unauthenticated caller rejected (existing authorization unchanged).
- No `providerId`/`vendorId` field in the input schema (no client-controlled vendor-identity bypass possible).
- Response projection still has no `passwordHash`/`invitationToken`/`username`.

## 11. Full test count

```
npx vitest run
Test Files  34 passed (34)
     Tests  344 passed (344)
```
333 tests carried over unmodified from the cumulative audit + 11 new tests in this phase. No existing test was altered to make it pass.

## 12. TypeScript result

```
npx tsc --noEmit
```
Clean, zero errors (confirmed after both the server and client changes, including the `providerRating: string | null` → `number | null` type change and its 4 call-site updates).

## 13. Frontend build result

```
vite build
✓ built in 27.08s
```
Succeeded. Pre-existing ">500kB chunk" advisory unrelated to this phase.

## 14. Server build result

```
esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
dist/index.js  153.0kb
```
Succeeded.

## 15. Protected branch verification

Checked before starting and again after finishing (`git fetch origin` + `git rev-parse` both times):
```
origin/main                                      = 71d891ffd6f654323ec7b54954b9a18cb63bb7a5   (unchanged)
origin/archive/manus-login-fix-4fcb464           = 4fcb464e908963c053aafb2608b9d5ea741a28d2   (unchanged)
origin/claude/phase4a64-dashboard-integration    = c37442022fc421ef46301b7f663c0e118ce7de15   (unchanged)
origin/claude/phase4a66-auth-security-hardening  = 42ee99c48f4a9b248bd236783bd094b493d84681   (unchanged)
origin/claude/phase4a67-admin-user-data-security = b67d9e7fdea793a5f07634e4fdc1ffffb7136670   (unchanged)
```
All five identical before and after. Work was performed only on the new `claude/phase4a69-reputation-consistency` branch, created from `claude/phase4a68-account-session-security` @ `63e8c08`. `main` was not modified, merged, or published.

## 16. Remaining limitations

- The dead `users.rating`/`users.reviewCount` columns were left in the schema (not dropped, no migration written) — this phase's scope was to stop *reading* them for reputation display, not to alter the Phase 3C schema. They remain unused by any code path after this fix; removing them would be a separate, schema-level decision outside this task's scope.
- Two pre-existing, unrelated observations were surfaced and explicitly not fixed, per scope: (a) `rfq.quotations` has no ownership check on `rfqId` (§4); (b) `providerRole` is not localized in the Arabic quote-comparison view (§8). Both predate this phase and are independent of the reputation-consistency problem.
- Live verification used the local disposable MariaDB instance only, per the established methodology — no production data was accessed or required.

---

## Final Status

**PASS — REPUTATION CONSISTENCY COMPLETE**

Per this task's explicit instructions: Phase 4B has not been started. Waiting for owner review before any further phase begins.
