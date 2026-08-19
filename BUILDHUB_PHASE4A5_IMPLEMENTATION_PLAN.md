# BuildHub — Phase 4A.5: Vendor Monetization Foundation Implementation Plan

**Mode: READ-ONLY.** No source code, schema, database, dependency, Stripe/SendGrid/Twilio configuration, or infrastructure was touched. Nothing here is code — every file reference below names what would change, not what has changed.

Method: this plan cites real file paths and structures, verified this phase (`client/src/pages/` directory listing, `ProviderDashboard.tsx`'s single-component structure, `ProjectDetail.tsx`'s milestone-display section as the natural review-affordance location), on top of the exact schema/router evidence already compiled across Phases 4A–4A.4.

---

## 1. Executive summary

Phases 4A–4A.4 fully specified *what* to build (fields, queries, security model, test cases) and *why* (trust/safety framing, monetization mapping). This phase adds the missing layer: *where*, in this specific codebase, each piece belongs. All three features fit into the existing monolithic-router / page-based architecture without new infrastructure — no new router files are strictly required (though one is recommended for clarity, see §2), no new pages beyond what's already scoped, and the correct implementation order is **Profile → Reputation → Analytics**, confirmed rather than assumed (§11), because Reputation's review-eligibility check already depends on data Profile doesn't touch, while Analytics depends on nothing new at all and could technically go first — the recommended order is about UI coherence (a vendor dashboard section makes little sense showing analytics before the vendor has a profile to attach them to) and about proving the public-read security pattern once (Profile) before reusing it (Reputation's public review list), not a hard technical dependency chain.

---

## 2. Vendor profile — implementation plan

### Data
- **Reused fields (`users` table, no schema change):** `id`, `name`, `bio`, `avatar`, `location`, `userRole`, `verified`, `createdAt`.
- **Missing fields:** none required for MVP — `bio`/`avatar`/`location` already exist and are simply unwritten.
- **Vendor profile table:** **not necessary now**, per Phase 4A.4 §3's reasoning, reconfirmed — reuse `users` via an explicit-selection query.
- **`users` stays account-only in principle, but the MVP doesn't split the table** — the separation is enforced at the *query* layer (allowlist below), not the schema layer, for now.
- **Public fields:** `id`, `name`, `bio`, `avatar`, `location`, `userRole`, `verified`, `createdAt` (for "member since"), plus the dynamic rating/review-count and completed-project-count values (computed, not stored — §3).
- **Private fields (never in the public query):** `email`, `phone`, `passwordHash`, `invitationToken`, `invitationExpiresAt`, `invitationSentAt`, `passwordSetAt`, `frozenReason`, `frozenAt`, `deactivatedAt`, `onboardingReviewNotes`, `onboardingReviewedBy`, `creationNote`, `accountStatus`, `accountSource`, `isDummy`, `createdBy`.
- **Admin-only fields:** none new — admin already has full-row access via existing `admin.users`/`admin.accountAudit`; no new admin-specific profile field is introduced.

### Backend
- **Router:** extend `server/routers.ts`'s existing `router` composition. No new top-level router is strictly required, but this plan recommends a small new `profileRouter` (or a `vendor` sub-namespace) purely for clarity, since `usersRouter`/`authRouter`-equivalent logic is currently scattered inline in the top-level router rather than namespaced (`auth.updateRole` lives alongside admin/RFQ/marketplace procedures in one file already) — a new named router keeps the profile-specific queries grouped and easy to find, consistent with how `marketplaceRouter`/`reviewsRouter`/`adminRouter` are already separated as named `const` router objects within the same file.
- **Queries:**
  - `profile.getPublic` — `publicProcedure`, input `{ userId: number }`, returns the explicit public-field allowlist above **plus** the computed rating/review-count (§3) and completed-project count (`COUNT(*) FROM quotations WHERE providerId = ? AND status = 'accepted'`). Built as a single explicit `db.select({ ... }).from(users).where(eq(users.id, input.userId))`, never `select().from(users)`.
  - `profile.getOwn` — `protectedProcedure`, no input (uses `ctx.user.id`), returns the same public fields plus whatever the vendor needs for their own edit form (identical field set is fine here, since a vendor editing their own profile already has full self-visibility via other existing endpoints).
- **Mutations:**
  - `profile.update` — `protectedProcedure`, input `{ bio?: string, avatar?: string, location?: string }` (Zod-validated, e.g., `bio` length-capped similar to existing patterns like `frozenReason`'s `max(500)`), writes only to `ctx.user.id`'s row, no `userId` field in the input schema at all — structurally impossible to target another account, matching the pattern already used correctly in `auth.updateRole`.
- **Authorization:** `getPublic` is intentionally open (any visitor, logged in or not — pending the §17-equivalent owner decision on `publicProcedure` vs `protectedProcedure`, carried over unresolved from Phase 4A.4 §18 item 1); `getOwn`/`update` are self-scoped `protectedProcedure`.
- **Validation:** Zod schema for `update`'s input; `avatar` accepts a storage key/URL string following the same pattern already used for `registrationDocuments`/`documents` uploads (`storagePut`), not raw file bytes through tRPC.
- **Admin moderation endpoint:** not built in this pass (Phase 4A.4 §7 classified this SHOULD-HAVE, not MUST-HAVE) — noted here as a deliberate omission, not an oversight.

### Frontend
- **Vendor's own profile/edit surface:** a new section within `ProviderDashboard.tsx` (confirmed this phase: single default-export component, currently one page, no sub-routing) — add a "My Profile" section/tab rather than a new route, consistent with how that page is currently structured as a single dashboard rather than a multi-page flow.
- **Customer-facing profile view:** a new page, e.g. `client/src/pages/VendorProfile.tsx`, routed at something like `/provider/:id` (new route, added to `client/src/App.tsx` alongside the existing route list) — confirmed no such page or route exists today (§1, this phase's directory listing).
- **Entry points into the new customer-facing page:** from a quotation row (where `providerName` is already displayed, `routers.ts` quotations query) and from a review, once reviews are visible (§3) — not from a new "browse vendors" listing, since that depends on the still-open Phase 4A.3 §7 directory decision and is out of scope here.
- **Navigation changes:** one new sidebar/tab entry inside `ProviderDashboard.tsx` (vendor's own edit view); no new top-level navigation item for the customer-facing view, which is reached contextually (via links), not via a menu.
- **Empty states:** a vendor who hasn't filled in `bio`/`avatar` yet should show a clear "complete your profile" prompt, not a blank section.
- **Loading/error states:** standard `@tanstack/react-query`/tRPC patterns already used throughout — no new pattern.
- **Mobile behavior:** follow `ProviderDashboard.tsx`'s existing responsive conventions (part of the "well-covered" tier per the original takeover audit's breakpoint-usage count, alongside `AdminDashboard.tsx`/`HomeownerDashboard.tsx`).
- **RTL/LTR:** new strings added to `LanguageContext.tsx`'s existing key maps, both `en`/`ar`, maintaining 454/454-style parity.

### Tests (new file, e.g. `server/vendorProfile.test.ts`, following the existing `admin.test.ts` mocked-`getDb()` pattern)
- Vendor can edit own profile (`profile.update` persists `bio`/`avatar`/`location` for `ctx.user.id`).
- Vendor cannot edit another vendor's profile — since `update`'s input schema has no `userId` field, this is really a test that the mutation *ignores* any attempt to smuggle one in (e.g., via `as any` cast in the test) rather than a conventional "wrong owner" rejection test, and should be written that way to actually prove the structural guarantee, not just re-assert the type system.
- Customer (or unauthenticated visitor, depending on the §17-equivalent decision) sees only public fields via `getPublic`.
- **Explicit assertion that `getPublic`'s response object does not contain `passwordHash`/`email`/`phone`/`invitationToken`/`frozenReason` keys at all** — not just "unauthorized," an actual shape assertion, per Phase 4A.4 §12's requirement.
- Unauthenticated behavior: `getPublic` succeeds (if `publicProcedure`) or fails cleanly with `UNAUTHORIZED` (if `protectedProcedure`) — whichever the owner decides.
- Admin behavior: admin's existing `admin.users`/`admin.accountAudit` endpoints are unaffected — a regression check, not new admin functionality.

---

## 3. Reputation — implementation plan

### Review eligibility (re-verified, unchanged from source — already correct)
`routers.ts:670-709` (`reviews.submit`): customer → project must be `status === 'completed'` **and** `project.ownerId === ctx.user.id` → revieweeId must be a verified participant (accepted-quotation provider linked via `rfqs.projectId`, with a role-based fallback for unlinked older projects) → self-review blocked → duplicate blocked (`projectId`+`reviewerId`+`revieweeId`). **No arbitrary user can review an unrelated user today — confirmed, unchanged, nothing to fix here.** This feature's backend work is entirely additive (aggregate + UI), not corrective.

### Review lifecycle — what's built vs. what's needed
| Step | Status |
|---|---|
| Completed project → eligible reviewer → submit → validate → persist | **Already implemented, `reviews.submit`** |
| Aggregate display | **Missing — this phase's scope** |

### Rating: dynamic vs. stored — validated against actual schema/workload
Confirmed: `reviews_revieweeId_idx` already exists in `drizzle/schema.ts` (`index('reviews_revieweeId_idx').on(table.revieweeId)`, part of the Phase 3C-designed, not-yet-applied migration). A dynamic query — `SELECT AVG(rating), COUNT(*) FROM reviews WHERE revieweeId = ?` — is index-supported by design and scoped to one vendor's own review rows (bounded, not a platform-wide scan). **No documented reason exists in this codebase to introduce a stored, separately-maintained aggregate** — the one that already exists (`users.rating`/`reviewCount`) is the counter-example for why not to (§1 of Phase 4A.4). **Recommendation confirmed: dynamic.**

### Backend
- **New query:** `reviews.statsForUser` (or added to the recommended `profileRouter` from §2, since it's consumed alongside profile data) — `publicProcedure`, input `{ userId: number }`, returns `{ averageRating: number | null, reviewCount: number }`, `null` average when `reviewCount === 0` (never `NaN`).
- **Existing query reused as-is:** `reviews.forUser` (`routers.ts:665-669`) — already correctly scoped to `verified: true`, already `publicProcedure`; no change needed, only a UI consumer needs to be built.
- **Existing mutation reused as-is:** `reviews.submit` — no backend change.
- **No admin moderation endpoint built in this pass** (Phase 4A.4 §7: SHOULD-HAVE, not MUST-HAVE) — same deliberate-omission note as §2.

### UI
- **Leave a review:** new affordance on `ProjectDetail.tsx` (confirmed this phase: this is the homeowner-facing project page with the milestone-status display, `routers.ts`-driven, the correct location) — a form (rating 1–5 + optional comment) shown when `project.status === 'completed'` and the current user is the owner, calling `reviews.submit` for each verified participant not yet reviewed (using the existing duplicate-check as a natural "already reviewed" signal, e.g., prefetch which participants already have a review via a small existence check, or simply let the mutation's `CONFLICT` response drive a disabled state).
- **Rating display / review list:** new component (e.g. `client/src/components/VendorReputation.tsx`), consuming `reviews.statsForUser` + `reviews.forUser`, used on both the new `VendorProfile.tsx` page (§2) and, in summary form, within `ProviderDashboard.tsx`'s new profile section (so the vendor sees their own rating too).
- **Empty state:** "No reviews yet" — explicitly not a `0.0` rating, which would misleadingly read as a poor score rather than an absence of data (direct application of Phase 4A.4 §5's empty-state requirement).
- **Arabic/English, mobile:** same conventions as §2 — new `LanguageContext.tsx` keys, `ProjectDetail.tsx`/`ProviderDashboard.tsx`'s existing responsive tier.

### Abuse protection (status of each, re-verified this phase)
- Duplicate prevention: **already implemented**, `routers.ts:702-705`.
- Self-review prevention: **already implemented**, `routers.ts:678`.
- Wrong-project prevention: **already implemented** (project must be `completed` and owned by reviewer).
- Wrong-vendor prevention: **already implemented** (verified-participant check, Phase 3A).
- Review spam/rate limiting: **not implemented, not recommended as new work** — the duplicate-prevention check already creates a natural ceiling (one review per reviewer/reviewee/project triple, and completed projects aren't created in unbounded volume by a single user), consistent with Phase 4A.4 §8's conclusion that no additional throttling is needed.
- Admin moderation: **not built this pass**, SHOULD-HAVE.

### Tests (new file, e.g. `server/vendorReputation.test.ts`)
- Unit: `statsForUser` returns `null` average with 0 reviews (not `NaN`); correct `AVG`/`COUNT` with a fixture set of ratings.
- Integration: `reviews.submit` → `statsForUser` reflects the new review (an end-to-end-within-the-mock-layer check that the dynamic query actually picks up newly inserted rows, not just a unit test of the math).
- Security/negative (all already covered by existing tests per Phase 1/3A, **re-run, not re-written**, to confirm no regression): non-owner review attempt, self-review attempt, wrong-participant review attempt, duplicate review attempt.
- E2E: full flow — homeowner completes project → sees review prompt on `ProjectDetail.tsx` → submits → vendor's `VendorProfile.tsx` reflects the new average/count.
- Mobile/Arabic-English: per §2's conventions, applied to the new review-form and review-list components specifically.

---

## 4. Analytics — implementation plan

### Metrics (re-validated exactly, per instruction not to add "RFQs received" without genuine per-vendor targeting — confirmed again this phase: `rfq.list` remains fully open/unfiltered, no targeting exists, so it is excluded)

| Metric | Source table/field | Query | Time period | Zero/null handling |
|---|---|---|---|---|
| Quotations submitted | `quotations.providerId` | `COUNT(*) WHERE providerId = ?` | All-time (MVP default) | `0` is a valid, correctly-displayable result — no special handling |
| Quotations accepted | `quotations.providerId`, `.status` | `COUNT(*) WHERE providerId = ? AND status = 'accepted'` | All-time | Same |
| Win rate | Derived from the two above | `accepted / submitted`, guarded | All-time | **`submitted === 0` → display "—", never compute `0/0`** |
| Response time | `quotations.createdAt`, `rfqs.createdAt` via `rfqId` join | `AVG(quotations.createdAt - rfqs.createdAt) WHERE quotations.providerId = ?` | All-time | **`submitted === 0` → display "—", never a computed zero-duration** |

### Authorization
`analytics.forVendor` (or, again, folded into the recommended `profileRouter`) — `protectedProcedure`, **no input parameter for the target vendor at all** — always computes against `ctx.user.id`. This is the structural (not just checked) guarantee Phase 4A.4 §8 specified: there is no `userId`/`providerId` field in the procedure's input schema, so there is no code path by which a client could even attempt to request another vendor's numbers.

### Performance
- **Required indexes:** `quotations_providerId_idx` — already exists in the Phase 3C-designed schema, covers every query above (all four share the same `WHERE providerId = ?` base). No new index required.
- **Query complexity:** all four are simple, single-table-or-one-join aggregations over a naturally-bounded per-vendor row count — no pagination, no caching needed at MVP scale.
- **Whether dynamic calculation remains appropriate at current scale:** yes — same reasoning as §3's rating decision, and there is even less risk here, since (unlike ratings) there's no competing stored value anywhere to accidentally rely on instead.

### Dashboard
- **Summary cards:** four stat cards (submitted, accepted, win rate, response time) inside `ProviderDashboard.tsx`'s new profile/analytics section (§2's "My Profile" addition, or a sibling "My Performance" section within the same page).
- **Charts:** **not recommended for MVP** — four numbers don't need a chart, and introducing a charting dependency/pattern for this alone would be disproportionate; revisit only if time-series data (e.g., "quotations per month") becomes a real, requested feature.
- **Date ranges:** all-time only for MVP (Phase 4A.4 §15 SHOULD-HAVE, not MUST-HAVE) — a "this month" toggle is a small, deferred addition, not a redesign, when it's built.
- **Empty/loading states:** "—" placeholders as specified above; standard loading pattern.
- **Mobile/Arabic-English:** same conventions as §2/§3.

---

## 5. Cross-feature architecture

```
Vendor Profile  (users columns, explicit-allowlist query)
      ↓ provides the identity/context reputation and analytics attach to
Reputation      (reviews table, dynamic AVG/COUNT keyed off the profile's userId)
      ↓ both profile and reputation are customer-facing trust signals (never paywalled, Phase 4A.4 §13)
Analytics       (quotations table, dynamic aggregates keyed off ctx.user.id only)
      ↓ vendor-facing productivity signal (reasonable future paid entitlement, Phase 4A.4 §13)
Future Subscription Entitlements (Phase 4B, not this phase)
```

**Coupling kept minimal, per instruction:** Profile and Reputation share one thing — the `userId` they're both queried by — and nothing else; Reputation doesn't read or depend on Profile's `bio`/`avatar` fields, and Analytics doesn't depend on either. All three can be implemented and tested independently once each one's own tables/columns are confirmed unchanged (§6) — the "order" in §11 is a UI/workflow recommendation, not a hard technical coupling.

---

## 6. Database impact

| Change | Table.column | Classification |
|---|---|---|
| None required for MVP | — | All three features use existing columns (`users.bio/avatar/location/rating/reviewCount`, `quotations.*`, `reviews.*`) through existing relationships |

**REQUIRED NOW:** nothing.
**PHASE 3C HARDENING (benefits from, doesn't require):** `quotations_providerId_idx`, `reviews_revieweeId_idx` — both already designed in `drizzle/schema.ts`/`drizzle/0012_broken_nightmare.sql`, not yet applied to any real database pending Phase 3C.1. Every query in this plan works correctly without them (full-table-scan-slow at real scale, not incorrect) and becomes fast automatically the moment that migration is safely applied — no plan change needed on this feature's side when that happens.
**FUTURE (explicitly not now, per Phase 4A.3/4A.4):** a dedicated `vendorProfiles` table (only once portfolio/categories are approved), a `providerCategories` join table (service-category declaration), a `users.featuredUntil`-style column (vendor-level featured placement) — none of these are part of this plan's scope.

No schema change is specified precisely because none is required — this section exists to confirm that conclusion explicitly, per instruction, not to skip it.

---

## 7. Phase 3C interaction

- **Conflicts with the 42-FK migration:** none — this plan introduces zero new columns or relationships, so there's nothing for `drizzle/0012_broken_nightmare.sql` to conflict with.
- **Requires the real-data audit first:** no — re-confirmed for the third time across Phase 4A.3/4A.4/this phase, each time checking one level more precisely (capability-level, then metric-level, now query-level), with the same result each time.
- **Can safely be developed independently:** yes, fully — this plan's three features and Phase 3C.1's resolution are on entirely independent tracks.
- **Should any part go into a future migration rather than Phase 3C's existing one:** yes, but not yet — the FUTURE items in §6 (`vendorProfiles`, `providerCategories`, `featuredUntil`) should be their own separate migration, generated fresh from an updated `drizzle/schema.ts` the same way `0012_broken_nightmare.sql` was, once approved — never hand-appended to the existing Phase 3C migration file, which should stay exactly as already validated (empty-DB apply, fail-safe-on-orphans, EXPLAIN-verified) and unmodified. **Phase 3C's migration file itself is not touched by this plan in any way.**

---

## 8. Security requirements (consolidated)

| Risk | Mitigation, this plan |
|---|---|
| IDOR on profile edit | No `userId` field in `profile.update`'s input schema — structurally self-only |
| Data leakage via public profile | Explicit-column-selection `getPublic` query, never `select().from(users)` — the central lesson from Phase 2's `projects.directory` fix, applied proactively here |
| Unauthorized profile modification | Same as IDOR mitigation above |
| Unauthorized review creation | Already fully mitigated by existing, re-verified code (§3) — no new work, confirmed not regressed |
| Review manipulation (editing after the fact) | Not built — reviews remain immutable by design (Phase 4A.4 §2, reconfirmed) |
| Cross-vendor analytics access | No target-vendor input parameter exists in `analytics.forVendor`'s schema — structurally self-only, same pattern as profile edit |
| Private account data exposure | Same allowlist mitigation as data leakage above; test suite includes an explicit shape assertion (§2) |
| Mass enumeration (scripted `getPublic`/`statsForUser` calls across sequential `userId` values) | **Not specifically mitigated by this plan** — `getPublic`/`reviews.forUser`/`statsForUser` are all read-only, low-sensitivity (already-public-by-design) data once the allowlist is correct, so this is a low-severity gap; if it becomes a real concern, the existing `server/_core/rateLimit.ts` fixed-window limiter (already used for `ai.chat`) is a directly reusable pattern — flagged as a possible future addition, not required for this plan's MVP scope |
| Rate abuse on review submission | Already naturally bounded by duplicate-prevention (§3) — no new work |

---

## 9. Localization

Every new string (profile edit form, profile display card, review form, review list, empty states, analytics stat labels, "—" placeholders, validation errors) must be added to `LanguageContext.tsx`'s `en`/`ar` maps in matching pairs, preserving the existing 454/454 parity discipline — no new localization mechanism, purely additive keys following the established `t('namespace.key')` convention already used throughout `Marketplace.tsx`/`AdminDashboard.tsx`/etc. Dates (e.g., "member since," review timestamps) and numbers (rating, win-rate percentage) follow whatever locale-aware formatting the rest of the app already applies — no new formatting utility introduced.

---

## 10. Performance

Consolidated from §3/§4: no new indexes required beyond what Phase 3C already designed; no caching required at MVP scale; no pagination required except a simple `limit()` on the review list (matching the existing convention used throughout `routers.ts`, e.g. `admin.fullAuditReport`'s `limit(1000)`); dynamic calculation remains appropriate for both rating and analytics at current and near-term scale, with the existing indexes as the only performance dependency, already accounted for.

---

## 11. Implementation order

**Recommended: Profile → Reputation → Analytics.** Explaining the dependency reasoning rather than assuming it, per instruction:

- **Profile first** because it establishes the public-read security pattern (explicit allowlist, §2) that Reputation's public review list reuses directly, and because it creates the customer-facing page (`VendorProfile.tsx`) that both Reputation and Analytics' vendor-facing summary attach to. Building Reputation or Analytics first would mean either building throwaway UI (no profile page to attach a review list to yet) or building the allowlist pattern for the first time inside a feature that isn't Profile, which is a worse place to first prove it correct given Profile is the highest-risk surface (§8).
- **Reputation second**, not first, specifically because its backend needs zero new work (§3) — it's almost entirely a UI-and-one-new-query task, which is faster and lower-risk to build once the Profile page it displays on already exists, avoiding a "build a review list component now, re-home it later" throwaway step.
- **Analytics third**, not because it depends technically on the other two (§5 — it doesn't, at all), but because it's vendor-only-facing (no customer-facing security surface to prove first, unlike Profile) and is the most isolated, fastest, lowest-risk of the three (§4's minimal query complexity) — sequencing it last means the two higher-stakes, customer-facing features (which touch the public-read allowlist pattern) get built and tested first, while Analytics can slot in without blocking on anything.

**If forced to reorder:** Analytics could genuinely go first with no technical harm, if the team wanted a quick, low-risk win before tackling Profile's security-sensitive public-read design — this is a legitimate alternative, not wrong, just not this plan's primary recommendation.

---

## 12. Test matrix

| Feature | Unit | Integration | Authorization | Negative security | E2E | Mobile | Arabic/English | Data isolation | Performance |
|---|---|---|---|---|---|---|---|---|---|
| Profile | — | edit persists correct fields | self-only edit; public-field-only read | shape assertion excluding sensitive fields | edit → public view reflects change | `ProviderDashboard.tsx` section, `VendorProfile.tsx` page | new key-pair parity check | N/A (read is public by design) | N/A (no aggregation) |
| Reputation | AVG/COUNT math incl. zero case | submit → stats reflects it | re-run existing Phase 1/3A tests, confirm no regression | re-run existing duplicate/self-review/wrong-participant tests | full submit → display flow | review form + list on both pages | new key-pair parity check | N/A (reviews are public-by-design once verified) | index-supported query, no new perf test needed at MVP scale |
| Analytics | win-rate/response-time math incl. zero case | fixture vendor with mixed quotation statuses → correct counts | **no input parameter accepts a target vendor — test that no such parameter exists / is ignored if forcibly supplied** | attempt to fetch another vendor's stats via forced/malformed input — must fail or be ignored | vendor dashboard reflects real quotation activity | stat cards on `ProviderDashboard.tsx` | new key-pair parity check | **explicit test: vendor A's analytics call never returns vendor B's numbers, using two fixture vendors** | confirm query uses `quotations_providerId_idx`-supported shape (`WHERE providerId = ?`), no full-table scan pattern introduced |

### Acceptance criteria
- **Profile:** a vendor can set bio/avatar/location; a customer (or visitor, per the open decision) viewing `/provider/:id` sees exactly the public allowlist and nothing else, verified by an automated shape assertion, not just manual inspection.
- **Reputation:** a homeowner can leave a review on a completed project for a verified participant only; the vendor's profile reflects an accurate, live-computed average and count with zero drift risk; a vendor with no reviews shows "no reviews yet," never a `0.0`.
- **Analytics:** a vendor sees accurate submitted/accepted/win-rate/response-time numbers computed only from their own `quotations` rows, verified against a known fixture, with a zero-quotations vendor seeing "—" placeholders, never `NaN`/`Infinity`/a misleading `0%`.

---

## 13. Monetization readiness gate — evidence required to move from NOT READY to READY FOR PRICING DESIGN

Per Phase 4A.4 §17's gate, restated as concrete, checkable evidence rather than a restated goal:

1. All three features' code is merged and deployed to a real environment (not just this plan existing).
2. The full test matrix (§12) passes, including the data-isolation and shape-assertion tests specifically.
3. A real vendor account can, through the live product (not the API directly), view and edit their own profile, see their own dynamic rating/review count, and see their own analytics.
4. A real customer account can, through the live product, view a vendor's public profile and its reviews, and successfully submit a review on a completed project.
5. The explicit-allowlist security tests (§2/§8) pass, confirmed by an automated assertion, not a manual check.
6. No regression in the existing 211-test suite (per `BUILDHUB_CURRENT_ENGINEERING_STATUS.md`'s last-known-good baseline) — the new tests are additive, not replacing coverage.

**Only once all six are true** does §14/§16 of Phase 4A.4 (the "thin Professional tier" caveat) become the live, current state to re-evaluate — this plan does not re-litigate that caveat, since nothing about implementation planning changes Phase 4A.4's product-value conclusion (analytics is the one of the three with real standalone paid-tier value; profile/reputation must stay free per §13's trust/safety framing there, reconfirmed unchanged here).

---

## 14. Implementation scope

| Feature | Classification | Why |
|---|---|---|
| Vendor profile | **MEDIUM** | New page (`VendorProfile.tsx`), new route, new router/queries/mutation, new upload-flow wiring (reusing the existing `storagePut` pattern, not building a new one), new tests — several small-to-moderate pieces, no schema change, no new authorization model to invent (reuses the self-scoped pattern already proven elsewhere) |
| Vendor reputation | **SMALL** | Backend is one new query (`statsForUser`) — everything else is UI (a form, a display component) attaching to an existing, already-correct mutation and an existing, already-correct query (`reviews.forUser`) |
| Vendor analytics | **SMALL** | Four straightforward aggregation queries over existing, already-indexed-by-design columns, one new stats-card UI section, no new authorization pattern beyond "no target-vendor input parameter" |

No hour estimates given, per instruction not to invent artificial ones — the SMALL/MEDIUM/LARGE classification above is grounded in concrete scope (file counts, whether new patterns vs. reused patterns are needed), which is the more defensible signal available from this session.

---

## 15. Dependencies

- Reputation's UI depends on Profile's page existing to attach to (§11) — a sequencing dependency, not a data dependency (§5).
- Analytics has no dependency on either other feature.
- All three depend on nothing from Phase 3C being applied (§7) — independently confirmed a third time.
- All three depend on the still-open Phase 4A.4 §18 owner decisions (public vs. protected profile read; immutable-reviews confirmation; dynamic-rating confirmation) being resolved before implementation starts, not during it — building against an undecided `publicProcedure`-vs-`protectedProcedure` choice risks rework.

---

## 16. Risks

- **Building the public-read query without the allowlist discipline** — the single highest-severity risk this whole plan exists to prevent, given it's a proven failure mode in this exact codebase (Phase 2). Mitigated by the explicit query design and the mandatory shape-assertion test (§2/§12), not just a code-review reminder.
- **Skipping the "no target-vendor input parameter" structural guarantee for analytics**, and instead building a `userId`-accepting query with an authorization *check* — a weaker pattern than "the input doesn't exist to misuse," and a real risk if implementation drifts from this plan's specific recommendation.
- **Scope creep into the deferred items** (portfolio, categories, featured placement, real directory) during implementation, since they're adjacent and might feel like "small additions" once a developer is in the profile code — explicitly out of scope for this plan (§6/§14) and should stay that way unless separately re-approved.
- **Building Reputation's aggregate as a stored value "for consistency with `users.rating`"** — the wrong instinct, given `users.rating` is the cautionary example, not a pattern to match.

---

## 17. Recommended next phase

Once the owner decisions carried over from Phase 4A.4 §18 (specifically items 1, 3, 4) are resolved, implementation itself — following this plan's file-by-file scope, in the Profile → Reputation → Analytics order (§11), with the test matrix (§12) built alongside each feature rather than after — is the direct next step, and does not require another planning/review phase first. This plan is intended to be the last review-only phase before real implementation begins.

---

## FINAL STATUS

## READY FOR FOUNDATION IMPLEMENTATION

The plan is concrete enough to build from: exact files, exact queries/mutations with their input shapes, exact tests, exact security guarantees, confirmed independence from Phase 3C, and a resolved (not just proposed) implementation order. The remaining blockers are the small number of specific owner decisions carried over from Phase 4A.4 §18 (public vs. protected profile read, in particular) — not additional specification work. No code, schema, database, dependency, or Stripe/SendGrid/Twilio configuration was touched. Phase 4B has not started. Stopping here per instruction.
