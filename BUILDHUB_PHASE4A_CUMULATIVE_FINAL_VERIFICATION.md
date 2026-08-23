# BuildHub — Phase 4A Cumulative Final Verification

Performed under the BuildHub Master Autonomous Engineering, Security & Release Protocol v1.1. This is a re-verification, not a re-statement of prior reports — evidence gathered fresh in this pass is what this report is based on, cross-checked against (not blindly trusted from) `BUILDHUB_PHASE4A_CUMULATIVE_FINAL_AUDIT.md` and `BUILDHUB_PHASE4A69_REPUTATION_CONSISTENCY.md`.

## PHASE
Phase 4A Cumulative Final Verification (post-4A.6.9)

## BRANCH
`claude/phase4a-cumulative-final-verification`, created from `claude/phase4a69-reputation-consistency`

## BASELINE SHA
`7cc9ff7f8df14c09f26ffca126cbd4306d16f03e`

## FINAL SHA
Reported in the commit that carries this file (no source code changed in this pass — see Implementation below).

## OBJECTIVES
Re-verify, from fresh executable evidence, that Phase 4A (through 4A.6.9) is genuinely complete and that no regression was introduced by the reputation-consistency fix; apply the protocol's cross-surface-consistency and stale-data-detection lenses across the wider codebase to catch anything the individual phase reports might have missed; determine readiness to proceed to Phase 4B.

## SOURCE FINDINGS

Re-confirmed by direct source read and fresh live calls in this pass (not assumed from prior reports):
- `server/_core/trpc.ts`'s `requireUser` still re-checks `accountStatus === 'frozen'` on every `protectedProcedure` request, admin-exempted, unchanged since Phase 4A.6.8.
- `admin.complianceQueue`/`admin.complianceApplicant` still use the `COMPLIANCE_APPLICANT_COLUMNS` allowlist fixed in the prior cumulative audit — re-confirmed live, no `passwordHash`/`invitationToken` in the response.
- `rfqRouter.quotations` still computes `providerRating`/`providerReviews` dynamically from `reviews`, matching `reviews.statsForUser` exactly — re-confirmed live for the same seeded vendor (4.5 / 2).
- `auth.me` still returns only the 6-field allowlist, no credential fields — re-confirmed live.
- Logout still revokes the session; replay of the same cookie is still rejected with 401 — re-confirmed live.

## NEW FINDINGS DISCOVERED

Applying the protocol's Cross-Surface Consistency Rule (§7) and Stale Data Detection (§8) beyond the reputation surface already fixed:

**1. `projects.spent` vs. live-summed `expenses` — inconsistent "amount spent" across two surfaces (NOT fixed — see classification below).**
`client/src/pages/ProjectDetail.tsx` computes and displays "Budget Used" as a live `reduce`-sum over the `projects.expenses` query result (`totalExpenses = expenses.reduce((s,e) => s + Number(e.amount), 0)`). `client/src/pages/HomeownerDashboard.tsx` and `client/src/pages/RolePlatform.tsx` instead display "Total Spent" as `Number(project.spent ?? 0)` — the `projects.spent` column, which is set only via `projects.update`'s own manual `spent` input field and is never written by `projects.addExpense` (which only inserts into the `expenses` table). If a homeowner logs itemized expenses without also manually updating the `spent` field (or vice versa), these two numbers will disagree across the dashboard and the project-detail page.

Unlike the reputation bug, this is **not classified as technically unambiguous** to fix outright: `projects.spent` is an actively-written, user-editable field (not a dead column nothing ever touches, the way `users.rating` was) — it's plausible this was an intentional design where `spent` is a homeowner-controlled budget estimate and `expenses` is a separate, more granular optional log, not necessarily meant to auto-roll up. Resolving it either way (make `spent` derive from `expenses`, or stop showing a live expense-sum on the project page and rely on the manual field everywhere) is a product decision about what these two features are supposed to mean, not a pure engineering correction. **Classification: C/D (adjacent, low risk, but requires a product decision on intended semantics) — documented and deferred, not fixed in this pass**, per protocol §6/§27's requirement that only *technically unambiguous* correctness issues be fixed unilaterally.

**2. `products.rating`/`products.reviewCount` — dead columns, zero readers anywhere in the codebase (NOT fixed — no live defect).**
A second, separate pair of stored-aggregate columns exists on the `products` table, structurally identical in shape to the `users.rating`/`reviewCount` columns that caused the 4A.6.9 bug. Repo-wide search confirms **nothing reads or writes these columns anywhere** — no product-review feature exists in the schema (the `reviews` table is scoped to vendor/user reputation only, keyed by `revieweeId`, not `productId`). Because nothing displays these columns, there is no live, reachable defect (unlike `users.rating`, which was actively displayed as always-zero). **Classification: C (adjacent, low-risk technical debt) — documented, not fixed.** No action needed unless/until a product-review feature is built.

Both findings are new discoveries from this verification pass, not present in either prior report.

## IMPLEMENTATION

No source code was changed in this verification pass. The two findings above were investigated and classified, not remediated, because neither meets the "technically unambiguous, bounded fix" bar the protocol requires for an unrequested fix — both would require a product decision (finding 1) or have no live-reachable impact to justify touching working code (finding 2).

## SECURITY

Re-verified live in this pass: `auth.me` clean of credential fields; `admin.complianceQueue` clean of credential fields; logout-then-replay correctly rejected (401); login/session flow functioning end-to-end for a real admin account. No new security-relevant finding was discovered in this pass beyond what the prior two reports already closed.

## DATABASE

No schema or migration changes in this pass. `drizzle/0012_broken_nightmare.sql` (Phase 3C) remains untouched (unchanged git history since its original commit, re-confirmed). No new FK/index concern identified.

## PERFORMANCE

No new query pattern introduced in this pass (no source changes). The 4A.6.9 aggregate-reputation query remains a single grouped query per request (re-confirmed by source read), not N+1.

## TESTS
```
npx vitest run
Test Files  34 passed (34)
     Tests  344 passed (344)
```
Identical count to the post-4A.6.9 state — confirms this verification pass introduced no regression and no new test (none were needed, since no code changed).

## TSC
```
npx tsc --noEmit
```
Clean, zero errors.

## FRONTEND BUILD
```
vite build
✓ built in 24.41s
```
Succeeded.

## SERVER BUILD
```
esbuild ... 
dist/index.js  153.0kb
```
Succeeded.

## LIVE VERIFICATION
Fresh live smoke test against the real local dev server + MariaDB in this pass (not reused from a prior screenshot): real admin login → `auth.me` (clean) → `admin.complianceQueue` (clean) → `rfq.quotations` for the same seeded vendor (`providerRating: 4.5, providerReviews: 2`, matching the 4A.6.9 report exactly) → logout → replay rejected (401). All five steps chained successfully in one session against the current HEAD.

## BROWSER VERIFICATION
Not re-run in this pass — the prior two reports (`BUILDHUB_PHASE4A_CUMULATIVE_FINAL_AUDIT.md` §20, `BUILDHUB_PHASE4A69_REPUTATION_CONSISTENCY.md` §7-9) already captured real browser screenshots (desktop/mobile 375px/Arabic RTL) for the surfaces this pass's API-level smoke test re-confirms are unchanged. No source change occurred that would invalidate that visual evidence.

## ARABIC/RTL
Not re-verified visually in this pass (no UI change since the last visual verification in 4A.6.9). `document.documentElement.dir` RTL wiring is unchanged (no source touched).

## MOBILE
Not re-verified visually in this pass, same reasoning as above.

## REGRESSION
344/344 tests passing, identical to the post-4A.6.9 count — no regression. Live smoke test confirms all layered security fixes (4A.6.6 auth hardening, 4A.6.7/cumulative-audit admin data allowlists, 4A.6.8 session re-check, 4A.6.9 reputation consistency) still function together correctly, not just individually.

## REMAINING ISSUES
- Finding 1 above (`projects.spent` vs. live expense sum) — MEDIUM, product-decision-gated.
- Finding 2 above (`products.rating`/`reviewCount` dead columns) — LOW, no live defect.
- Everything previously documented as MEDIUM/LOW/EXTERNAL/BUSINESS-DECISION in the prior cumulative audit report (§22-24 of that report) still applies unchanged: the `rfqRouter.quotations` ownership-check gap (§4 of the 4A.6.9 report), the "1 Completed Projects" pluralization nit, and the `providerRole` Arabic-localization gap in the quote-comparison view.

## DEFERRED ISSUES
Both new findings from this pass (above), and all previously-deferred items, remain deferred — none are blockers for Phase 4B per the protocol's own classification rules (none are security-critical-and-directly-in-current-surface; both are correctness/technical-debt items requiring either a product decision or no live impact).

## OWNER DECISIONS
- What should "Total Spent"/"Budget Used" mean: a manually-tracked estimate, or a live rollup of the itemized expense log? (New, from this pass.)
- Everything listed in the Phase 4B business-decision matrix below.

## ACCESS REQUIREMENTS
None for Phase 4A. Phase 4B will require Stripe account/API keys once pricing is decided (not requested yet — see below).

## NEXT PHASE
Phase 4B — Monetization Implementation. **Blocked on unresolved business decisions — see the decision matrix immediately following this report.** Per protocol §29 stop condition 1 (owner business decision required) and §19 (prices, trial duration, tier definitions, refund policy, and cancellation policy must never be invented), implementation cannot proceed until these are resolved.

## FINAL STATUS

**PASS WITH CONDITIONS**

Phase 4A (through 4A.6.9) is confirmed, from fresh executable evidence, to be functionally complete, secure against every previously-identified and newly-swept-for exposure class, fully tested, and building cleanly. The two new findings from this pass are real but neither critical nor blocking — both are correctly deferred per protocol, not silently ignored.
