# BuildHub — Phase 4A.6.3: Vendor Analytics Implementation

**Scope:** Implement ONLY the Vendor Analytics foundation approved in Phase 4A.4/4A.5: quotations submitted, quotations accepted, win rate, and response time. No Stripe, payments, subscriptions, pricing, featured placement, commission, lead fees, portfolio, or vendor directory work is included.

**Branch:** `claude/phase4a63-vendor-analytics`, branched from `claude/phase4a62-vendor-reputation`.

---

## 1. Metrics Implemented

Exactly the 4 approved metrics, no more:

| Metric | Field | Type |
|---|---|---|
| Quotations submitted | `quotationsSubmitted` | integer, always present, 0 is a valid value |
| Quotations accepted | `quotationsAccepted` | integer, always present, 0 is a valid value |
| Win rate | `winRate` | number (percentage, 1 decimal) or `null` if `quotationsSubmitted === 0` |
| Average response time | `avgResponseTimeHours` | number (hours, 1 decimal) or `null` if `quotationsSubmitted === 0` |

**"RFQs received" was explicitly NOT implemented.** Re-verified directly against `rfqRouter.list` (`server/routers.ts`): the query is `db.select().from(rfqs).orderBy(desc(rfqs.createdAt)).limit(50)` with no `providerId`/`vendorId` filter of any kind — every RFQ is visible to every provider, there is no per-vendor targeting relationship in the schema. Any "received" count would therefore either be identical for all vendors (meaningless) or would have to be invented from data that doesn't exist. This matches the finding already established in Phase 4A.3/4A.4 and is re-confirmed here from current source, not assumed from the old report.

## 2. Exact Data Sources

Independently re-read directly from `drizzle/schema.ts` (not from prior phase reports) before writing any query:

- **`quotations`** (`drizzle/schema.ts:281-296`): `id`, `rfqId` (FK → `rfqs.id`, NOT NULL), `providerId` (FK → `users.id`, NOT NULL), `price`, `currency`, `timeline`, `warranty`, `paymentTerms`, `notes`, `status` (`mysqlEnum(['pending', 'accepted', 'rejected'])`, default `'pending'`), `createdAt` (`timestamp` NOT NULL, `defaultNow()`). **There is no `updatedAt` or `acceptedAt` column on `quotations`.**
- **`rfqs`** (`drizzle/schema.ts:260-278`): `id`, `requesterId`, `projectId`, `title`, ..., `status` (`['open','closed','awarded']`), `createdAt` (`timestamp` NOT NULL, `defaultNow()`), `updatedAt` (`timestamp` NOT NULL, `defaultNow()`, `onUpdateNow()`).
- Confirmed via `server/quotationWorkflow.ts` (`acceptQuotationSecure`/`rejectQuotationSecure`, the only two places `quotations.status` is ever written): a status transition is a plain `UPDATE ... SET status = ...` with **no timestamp column written alongside it**. There is no audit/history table for quotation status changes anywhere in the schema.

This directly determines what's honestly computable (see §5).

## 3. Calculation Definitions

All 4 metrics are computed by a **single aggregate SQL query** in `server/routers.ts` (`analyticsRouter.myStats`):

```sql
SELECT
  count(*)                                                       AS submitted,
  sum(case when quotations.status = 'accepted' then 1 else 0 end) AS accepted,
  avg(timestampdiff(second, rfqs.createdAt, quotations.createdAt)) AS avgResponseSeconds
FROM quotations
INNER JOIN rfqs ON quotations.rfqId = rfqs.id
WHERE quotations.providerId = :ctx.user.id
```

- **Quotations submitted** = `count(*)` of every row in `quotations` where `providerId = ctx.user.id`, no status filter — every quotation the vendor has ever created for any RFQ, regardless of the RFQ's own status. 0 is reported as `0`, not `null` — a vendor who hasn't quoted yet has genuinely submitted zero quotations, which is different from "unknown."
- **Quotations accepted** = the same rows, filtered to `status = 'accepted'`. `'accepted'` is the *only* accepted state the schema defines (`quotations.status` enum is exactly `['pending', 'accepted', 'rejected']`) — no other status was invented or assumed.
- **Win rate** = `quotationsAccepted / quotationsSubmitted * 100`, rounded to 1 decimal place (`Math.round(x * 1000) / 10`). When `quotationsSubmitted === 0` this is `null`, never `0`, `NaN`, or `Infinity` — a vendor with no quotations has no win rate to report, and reporting `0%` would misleadingly imply they lost every bid rather than never having bid.
- **Response time** = average, in hours, of `quotations.createdAt − rfqs.createdAt` for every quotation this vendor submitted (i.e. how long after an RFQ was posted this vendor took to quote on it — see §5 for why this definition was chosen over "time to acceptance"). Computed server-side via `TIMESTAMPDIFF(SECOND, ...)`, averaged in SQL, then converted `seconds / 3600` and rounded to 1 decimal. `null` when `quotationsSubmitted === 0` (nothing to average) or when the aggregate itself is `null`.

No redundant stored aggregate was added — every value is computed live from `quotations`/`rfqs` on every call, the same "dynamic over stored" principle Phase 4A.4 mandated and Phase 4A.6.2 already established for ratings (`reviews.statsForUser`). There is nothing to keep in sync and nothing that can go stale.

## 4. Backend/API Changes

One new router, one new procedure, in `server/routers.ts`:

```ts
const analyticsRouter = router({
  myStats: approvedProviderProcedure.query(async ({ ctx }) => { ... }),
});
```

mounted as `appRouter.analytics.myStats`. This is the entire backend surface — a single query, no mutations, no other endpoints. `approvedProviderProcedure` is the exact same tier already used by `rfq.myQuotations`/`rfq.submitQuotation` (requires `userRole` to be one of `providerRoles` **and** `onboardingStatus === 'approved'`); the handler additionally re-checks the role explicitly (matching the existing double-check convention already used in `rfq.myQuotations`).

**`myStats` takes no input at all** — there is no `z.object({...})` schema, so there is no field of any kind (`vendorId`, `userId`, or otherwise) a client could populate to name a different account. This is the same structural-isolation pattern established for `profile.getOwn`/`profile.update` in Phase 4A.6.1.

No existing endpoint was modified. `completedProjectCount` (used by `profile.getOwn`/`getPublic`) was left untouched rather than reused inside the new aggregate, because folding it into the single-query aggregate (rather than a second round trip) keeps `myStats` to one query — the two independently arrive at the same "accepted" definition, which is cross-checked live in §19.

## 5. Frontend Changes

- **`client/src/components/VendorAnalytics.tsx`** (new): self-contained, prop-less component. Calls `trpc.analytics.myStats.useQuery()` with no arguments — it cannot be pointed at another vendor even accidentally, since there's no prop to pass one. Renders 4 metric cards (submitted, accepted, win rate, response time) in a `grid-cols-2 sm:grid-cols-4` layout, with loading/error/empty states.
- **`client/src/pages/ProviderDashboard.tsx`**: added a new `"Analytics"` section directly below the existing `"Reputation"` section (both inside the same "My Profile" card, same `border-t pt-4` pattern used for Reputation in Phase 4A.6.2), importing and rendering `<VendorAnalytics />`.

No other file was changed.

## 6. Security Verification

- `myStats` requires `approvedProviderProcedure` — unauthenticated calls are rejected with `UNAUTHORIZED` before the handler runs (tRPC's built-in `protectedProcedure` check); non-provider roles (e.g. `homeowner`) are rejected with `FORBIDDEN` ("Provider access required") both by the procedure middleware and the explicit in-handler role check; providers whose `onboardingStatus !== 'approved'` are also rejected with `FORBIDDEN`.
- No client input is trusted for identity — `ctx.user.id` is the only identity value used anywhere in the query, sourced from the verified session, never from the request body/query string.
- No `users` table columns are touched by this router at all (analytics reads only `quotations`/`rfqs`), so there is no risk of the `passwordHash`/`invitationToken`/`email`/`phone` leakage class that `PUBLIC_PROFILE_COLUMNS` was built to prevent in Phase 4A.6.1 — it's structurally not applicable here.
- Reviewed for the standard OWASP classes: no string concatenation into SQL (all values go through Drizzle's parameterized `sql` template and `eq()`), no mass assignment (no `.mutation()` at all in this router — it's read-only), no IDOR (no ID parameter exists to manipulate).

## 7. Data Isolation Verification

Verified three ways:

1. **Static/structural** (test suite, item 2): `analyticsRouter`'s source contains no `.input(` call at all, and no `vendorId`/`targetUserId` identifier anywhere in the block — asserted directly against the live source file, not just eyeballed.
2. **Unit tests** (items 12-13): two callers with different `ctx.user.id` values against independently-mocked aggregate rows produce independent, non-equal results; the query itself is confirmed (from source) to filter on `eq(quotations.providerId, ctx.user.id)`.
3. **Live, real-database verification** (§19 below): two real vendor accounts with deliberately different quotation histories, queried over real HTTP through a running server against a real MariaDB instance — including an explicit attempt by Vendor A to smuggle Vendor B's id into the request, which was silently ignored.

## 8. Performance Analysis

The query is a single `INNER JOIN` between `quotations` and `rfqs` on `quotations.rfqId = rfqs.id`, filtered by `quotations.providerId = ?`. `EXPLAIN` against the local verification database:

```
mysql> EXPLAIN SELECT count(*), sum(case when quotations.status='accepted' then 1 else 0 end),
       avg(timestampdiff(second, rfqs.createdAt, quotations.createdAt))
       FROM quotations INNER JOIN rfqs ON quotations.rfqId = rfqs.id
       WHERE quotations.providerId = 1;

id  select_type  table       type    possible_keys                              key                          key_len  ref                                rows  Extra
1   SIMPLE       quotations  ref     quotations_rfqId_idx,quotations_providerId_idx  quotations_providerId_idx  4       const                              2
1   SIMPLE       rfqs        eq_ref  PRIMARY                                    PRIMARY                      4       buildhub_verify.quotations.rfqId  1
```

The planner uses `quotations_providerId_idx` (an index on `quotations.providerId`) for the outer filter and the `rfqs` primary key for the join — both index-backed, no full table scans. **This index already exists** — it was added by the Phase 3C FK/index migration (`drizzle/schema.ts:295`, `providerIdIdx: index('quotations_providerId_idx').on(table.providerId)`), applied to and confirmed present in the local verification database used above.

## 9. Database/Index Impact

**No new index or migration is required or was added.** The one index this query needs (`quotations_providerId_idx`) is already part of the Phase 3C schema design. `drizzle/0012_broken_nightmare.sql` (the Phase 3C migration file) was **not modified** by this phase — no new migration file was created either, since nothing new needs to be added to the schema. This also means Analytics carries forward Phase 3C.1's still-open finding: that migration has been tested against a local disposable database but has **not yet been applied to any real staging/production database** — a pre-existing blocker unrelated to and unaffected by this phase.

## 10. Localization

New key block added in both `client/src/contexts/LanguageContext.tsx` maps (English ~line 367, Arabic ~line 987), `// ── Vendor Analytics ──` :

`analytics.title`, `analytics.submitted`, `analytics.accepted`, `analytics.win_rate`, `analytics.response_time`, `analytics.hours_unit`, `analytics.empty_state`, `analytics.load_error` — 8 keys, each present exactly twice (English + Arabic), verified by an automated test (`vendorAnalytics.test.ts`, "every new analytics.* key exists in both..."). All numeric values in the UI are formatted through `.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')`, so percentages and counts render in Arabic-Indic numerals in Arabic mode — confirmed live in §19 (Vendor B's card literally shows `٤`/`١` for 4 submitted/1 accepted).

## 11. Responsive Verification

Verified live (Playwright, real rendered pages, not just Tailwind class inspection) at all 3 required breakpoints — see §19 for screenshots:

- **1280px**: 4-column card grid, full labels visible, no overflow.
- **768px (Arabic RTL)**: cards remain in a readable grid, sidebar and layout mirror to RTL, Arabic-Indic numerals render correctly.
- **375px**: grid collapses to 2 columns (`grid-cols-2` base, `sm:grid-cols-4` above the `sm` breakpoint), all 4 cards remain visible and readable, no horizontal page overflow. Metric labels ("Quotations Submitted", etc.) truncate with an ellipsis inside their card at this width rather than wrapping/overflowing — a minor cosmetic effect of the pre-existing `truncate` utility class, not a functional defect; the numeric value itself is never truncated.

## 12. Tests Added

`server/vendorAnalytics.test.ts` — 23 tests, directly numbered against the required 23-item list:

- **Authorization (1-4)**: vendor retrieves own stats; no input parameter exists (structural, item 2); customer role rejected `FORBIDDEN`; unauthenticated rejected. (Plus one extra: unapproved-onboarding provider rejected.)
- **Calculations (5-11)**: submitted count; accepted count (+ "accepted" definition/no invented statuses); win rate formula; zero-submitted handling (two variants — empty aggregate row and a zeroed row); division-by-zero never NaN/Infinity; response-time computation + source-verified `TIMESTAMPDIFF`; null-average handled safely. (Plus one extra: "RFQs received" is confirmed absent and `rfq.list` confirmed unfiltered.)
- **Data isolation (12-13)**: two vendors get independent, differing results; source-verified `providerId = ctx.user.id` scoping.
- **Regression (14-15)**: `profileRouter` and `reviewsRouter` blocks are unchanged/intact (all their exports still present) after this phase's edits.
- **Localization**: every `analytics.*` key present exactly twice.
- **UI wiring (16-23)**: query call shape, loading/empty/error states present, all 4 labels sourced from `t()` not hardcoded, wired into `ProviderDashboard.tsx` alongside `VendorReputation`, no fixed pixel widths, responsive grid classes present.

No existing test file (`reviewsAuthorization.test.ts`, `vendorProfile.test.ts`, `vendorReputation.test.ts`, or any other) was modified or removed.

## 13. Full Test Results

```
 Test Files  28 passed (28)
      Tests  271 passed (271)
   Duration  9.28s
```

271 = 248 baseline (stated at the top of this phase's task) + 23 new. All passing, fresh run, no skips.

## 14. TypeScript Result

```
$ npx tsc --noEmit
(no output — 0 errors)
```

## 15. Frontend Build

```
$ vite build
✓ built in 39.45s
```
Succeeds. The "chunks larger than 500 kB" warning is pre-existing (syntax-highlighting/diagram libraries bundled elsewhere in the app) and unrelated to this phase's changes.

## 16. Server Build

```
$ esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
dist/index.js  148.4kb
⚡ Done in 17ms
```
Succeeds.

## 17. Vendor Profile Regression

- `server/vendorProfile.test.ts` (19 tests, unmodified) — all still passing in the full run above.
- Live: `profile.getOwn` queried over real HTTP for Vendor A after seeding returned the correct, unaffected profile (`completedProjects: 1`, matching the independently-computed `quotationsAccepted: 1` from the new analytics endpoint — a cross-check that both queries agree on the same underlying data).
- Screenshot evidence (§19): the "Vendor Profile" card renders identically to Phase 4A.6.1/4A.6.2, with the new "Analytics" section added below it, not interleaved with or altering it.

## 18. Vendor Reputation Regression

- `server/vendorReputation.test.ts` (18 tests, unmodified) — all still passing in the full run above.
- Live: `reviews.statsForUser` queried over real HTTP for Vendor A returned the correct, unaffected rating (`averageRating: 4.5, reviewCount: 2`), matching the pre-existing seeded review data from Phase 4A.6.2's verification.
- Screenshot evidence (§19): the "Reputation" section (stars, review count, review list) renders unchanged above the new "Analytics" section.

## 19. Live Verification Evidence

Performed against a real disposable local MariaDB instance (`buildhub_verify`) and a real running dev server (`server/_core/index.ts`), the same methodology established in Phase 4A.6.1/4A.6.2. **This was a genuine live verification, not a claim without evidence.**

**Seed data** (two vendors with deliberately different quotation histories, inserted directly into the test database):

| Vendor | Submitted | Accepted | Expected win rate | Expected avg response |
|---|---|---|---|---|
| Vendor A (`testvendor`, id 1, "Nile Construction Co.") | 2 (createdAt 2h after each RFQ) | 1 | 50.0% | 2.0 hrs |
| Vendor B (`testvendorb`, id 4, "Delta Electric Co.") | 4 (createdAt 0.5h/1h/3h/1.5h after each RFQ) | 1 | 25.0% | 1.5 hrs |
| Vendor C (`testvendorc`, id 5, "Zero Quotes Vendor") | 0 | 0 | — | — |

**Real HTTP results** (`curl` against `analytics.myStats`, session cookies obtained via a real `auth.signInDummy` call — not fabricated):

```
Vendor A: {"quotationsSubmitted":2,"quotationsAccepted":1,"winRate":50,"avgResponseTimeHours":2}
Vendor B: {"quotationsSubmitted":4,"quotationsAccepted":1,"winRate":25,"avgResponseTimeHours":1.5}
Vendor C: {"quotationsSubmitted":0,"quotationsAccepted":0,"winRate":null,"avgResponseTimeHours":null}
```

All three match the hand-computed expected values exactly.

**Isolation attack attempted and blocked:** Vendor A's authenticated session called `analytics.myStats` with `{"vendorId":4,"userId":4}` appended to the request (attempting to name Vendor B). The extra fields were silently ignored (there is no schema position for them to bind to) and the response was still Vendor A's own data (`quotationsSubmitted: 2`, not Vendor B's 4). A homeowner account (`testhomeowner`) received `403 FORBIDDEN — "Provider access required"`. An unauthenticated request received `401 UNAUTHORIZED`.

**Visual verification (Playwright, real browser, real rendered app):** 4 screenshots taken and sent to the user directly in this session —
- Vendor A, desktop 1280px, English: Analytics section shows `2 / 1 / 50% / 2 hrs`, positioned below Reputation (unchanged, `4.5 ★, 2 Reviews`) and Vendor Profile (unchanged).
- Vendor A, mobile 375px: 2-column card grid, all values correct, no horizontal overflow.
- Vendor B, tablet 768px, Arabic (RTL, `localStorage.buildhub_lang = 'ar'`): Analytics cards show Arabic-Indic numerals (`٤`/`١`) matching Vendor B's `4`/`1`, confirming both localization and cross-vendor data isolation live in the same screenshot.
- Vendor C, desktop, English: empty-state message renders ("No quotations submitted yet...") instead of zero-value cards.

**Note on reachability, and a test-harness technique used to capture it:** as documented in Phase 4A.6.1/4A.6.2 and re-confirmed here, `ProviderDashboard.tsx` (where this Analytics section, like Profile and Reputation before it, was added) is unreachable through ordinary authenticated navigation — its own `useEffect` unconditionally calls `navigate(getRolePlatformPath(userRole))` the instant `isAuthenticated` is true, before a user ever sees the page; visiting `/provider` directly still lands on `/platform/contractor` (re-confirmed live, first attempt). This is a pre-existing condition, not introduced by this phase, and fixing it is out of this phase's explicit scope (see §20). To still obtain a genuine screenshot of the real, production component tree (not a mock), a test-harness-only script neutralized `history.pushState` in the Playwright browser context before navigating to `/provider` — no application code was changed; this only prevented the client-side redirect from swapping the route out from under the screenshot, the same class of workaround as the `SameSite` cookie-injection technique used throughout this engagement. The screenshots above are the real `ProviderDashboard.tsx` render tree, including the real `VendorAnalytics` component making a real network call to the real server.

## 20. Known Limitations

1. **`ProviderDashboard.tsx` (and therefore this new Analytics section) is unreachable via ordinary navigation for real authenticated users.** Carried forward unfixed from Phase 4A.6.1 and 4A.6.2, for the same reason: fixing the `ProviderDashboard.tsx` → `RolePlatform.tsx` redirect is outside this phase's explicit scope (this phase's instructions were "implement ONLY Vendor Analytics"). This is the single most urgent open item blocking any of Vendor Profile, Vendor Reputation, or Vendor Analytics from being visible to real users at all, and it should be resolved before any of the three foundation features are considered genuinely shipped.
2. **`ProviderDashboard.tsx` already has a separate, pre-existing, hardcoded stats row** (`{ label: 'Avg Response', value: '< 2h' }`, `{ label: 'Rating', value: '4.8 ★' }`, `{ label: 'Completed', value: '24' }` at `ProviderDashboard.tsx:87-90`) sitting above the real "Vendor Profile"/"Reputation"/"Analytics" cards on the same page. These are static placeholder values, not computed from any real data, and were not touched by this phase (out of scope — not part of the approved Analytics work, and this row pre-dates Phase 4A.6.1). Having genuine, computed "Avg. Response Time" and (via Reputation) a genuine rating directly below a fake hardcoded "Avg Response"/"Rating" row on the same screen is confusing and should be an owner decision (§21) — most likely, that hardcoded row should eventually be replaced by real data from `analytics.myStats`/`reviews.statsForUser`, but that is a UI redesign decision beyond this phase's "implement Analytics, don't redesign the dashboard" instruction.
3. **Response time measures RFQ-post-to-vendor-quote latency, not time-to-acceptance.** This was a deliberate, documented choice (§3/§5) because `quotations` has no timestamp for when a status changes — "time to acceptance" cannot be honestly computed from the current schema at all. If the business wants that metric in the future, it requires a schema change (e.g. an `acceptedAt` column written inside `acceptQuotationSecure`), not a query change.
4. Card labels truncate at 375px width (cosmetic only, values are never truncated).
5. **Historical quotations older than this phase always have both timestamps** (both `createdAt` columns are `NOT NULL DEFAULT NOW()`), so there is no real-world "missing timestamp" case for response time — this was verified true by schema constraint, not assumed.

## 21. Remaining Owner Decisions

1. Fix or explicitly accept the `ProviderDashboard.tsx` unreachability (limitation 1 above) — this affects all three foundation features (Profile, Reputation, Analytics) simultaneously and should be resolved as one decision, not three separate ones.
2. Decide whether to replace the pre-existing hardcoded stats row at the top of `ProviderDashboard.tsx` (limitation 2) with real data now that `analytics.myStats` and `reviews.statsForUser` both exist, and if so, whether that's a Phase 4A.6.3 follow-up or bundled with the reachability fix.
3. Decide whether "time to acceptance" (as opposed to "time to first quote," which is what's implemented) is a metric worth adding a schema column for in a future phase.
4. Decide whether Vendor Analytics should ever be shown publicly (e.g. on `VendorProfile.tsx`, as a trust signal to customers) — this phase deliberately kept it private/self-only, consistent with it being operational data about the vendor's own business rather than a reputation signal, but that's a product decision, not a technical constraint.

---

## Final Status

**PASS — READY FOR CUMULATIVE FOUNDATION AUDIT**
