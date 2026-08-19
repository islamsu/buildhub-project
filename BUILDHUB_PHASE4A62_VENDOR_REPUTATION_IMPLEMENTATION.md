# BuildHub — Phase 4A.6.2: Vendor Reputation Implementation

Scope: only the Vendor Reputation foundation. Analytics, Stripe, subscriptions, payments, featured-vendor monetization, pricing, commission, lead fees, and email/SMS were explicitly not touched.

---

## 1. What was implemented

- **Dynamic rating/count** (`reviews.statsForUser`) — live `AVG(rating)`/`COUNT(*)` over the `reviews` table, never a stored aggregate.
- **Eligibility listing** (`reviews.eligibleReviewees`) — tells the UI, per project, who the caller can review and who they already have, using the exact same verified-participant definition `reviews.submit` already enforces.
- **`VendorReputation`** (`client/src/components/VendorReputation.tsx`) — one reusable display component (stars, average, count, review list, empty/loading/error states), used on both the public vendor profile and the vendor's own dashboard.
- **`ReviewSubmissionPanel`** (`client/src/components/ReviewSubmissionPanel.tsx`) — customer-facing submission UI, wired into a new "Reviews" tab on `ProjectDetail.tsx`, gated on `project.status === 'completed'`.
- Full English/Arabic localization for all of the above (18 new key pairs).

**The existing `reviews.submit` backend was not modified** — it was re-verified (§3) and is reused exactly as-is.

---

## 2. Files changed

| File | Change |
|---|---|
| `server/routers.ts` | Added `reviews.statsForUser` and `reviews.eligibleReviewees` to the existing `reviewsRouter`; `reviews.submit`/`reviews.forUser` untouched |
| `client/src/components/VendorReputation.tsx` (new) | Reusable reputation display |
| `client/src/components/ReviewSubmissionPanel.tsx` (new) | Review submission UI |
| `client/src/pages/ProjectDetail.tsx` | New "Reviews" tab |
| `client/src/pages/VendorProfile.tsx` | New "Reputation" card, using `VendorReputation` |
| `client/src/pages/ProviderDashboard.tsx` | Vendor's own reputation shown in the existing profile section, using `VendorReputation` |
| `client/src/contexts/LanguageContext.tsx` | 18 new `reputation.*`/`review.*` key pairs |
| `server/vendorReputation.test.ts` (new) | 18 tests |

No schema change, no new table, no new migration, no touch to `drizzle/0012_broken_nightmare.sql`.

---

## 3. Existing backend authorization — verified before any new code was written

Per instruction, `reviews.submit` (`server/routers.ts`) was re-read line by line before touching anything, and confirmed correct and unchanged:

| Rule | Confirmed |
|---|---|
| Unrelated customers cannot review | Yes — `project.ownerId !== ctx.user.id` rejected with `FORBIDDEN` |
| Unrelated users cannot review | Same check |
| Vendors cannot review as a customer | Same check — a vendor account is never a project owner in this flow |
| Self-review blocked | `revieweeId === ctx.user.id` rejected with `BAD_REQUEST` |
| Duplicate reviews blocked | Pre-insert `(projectId, reviewerId, revieweeId)` lookup, `CONFLICT` on match |
| Wrong project/vendor relationship blocked | Verified-participant check (accepted-quotation providers on RFQs linked to the project, with a role-based fallback for older/unlinked projects) |

**No missing or incorrect authorization was found — nothing to stop and report.** `server/reviewsAuthorization.test.ts` (pre-existing, 16 tests) already covers every one of these rules exhaustively and was re-run, not modified, as part of this phase's verification (§10/§11).

Beyond re-reading the code and re-running the existing tests, this phase additionally proved every one of these rules **live, against a real database**, in §7.

---

## 4. Dynamic rating implementation

Per the Phase 4A.4 decision, rating is computed on every read, never stored:

```
SELECT AVG(rating), COUNT(*) FROM reviews WHERE revieweeId = ? AND verified = true
```

- **Zero reviews:** `count = 0` → `averageRating: null` (never `0`, which would misleadingly read as a real 0-star score).
- **Null/malformed aggregate row:** guarded — `averageRating` only computed when `reviewCount > 0` and the `avg` value is non-null.
- **Rounding:** `Math.round(avg * 10) / 10` — one decimal place (e.g., `4.3333` → `4.3`).
- **Access level:** `publicProcedure`, matching the pre-existing `reviews.forUser`'s access level exactly — an aggregate over already-public data shouldn't have a stricter policy than the underlying list.
- **No competing calculation exists anywhere** — confirmed by test (`server/vendorReputation.test.ts`, "is a live query... no stored/cached aggregate column is ever read") that the new query never reads `users.rating`/`users.reviewCount`, and that `VendorProfile.tsx`/`ProviderDashboard.tsx` each call `reviews.statsForUser` exactly once, through the one shared `VendorReputation` component — not reimplemented per page.

---

## 5. Review submission flow

`ReviewSubmissionPanel` (`client/src/components/ReviewSubmissionPanel.tsx`), embedded in `ProjectDetail.tsx`'s new "Reviews" tab:

- **Ineligible state** (project not completed): explanatory message, no form, no eligible-reviewee query even issued (`enabled: isCompleted`).
- **Loading state:** while `reviews.eligibleReviewees` is in flight.
- **Error state:** if the query fails.
- **No eligible participants:** explanatory message (covers both "not the owner" and "no verified providers" — `eligibleReviewees` returns `[]` for both, by server-side design, so the UI cannot leak which case it is).
- **Per eligible participant:** name, and either an "Already reviewed" badge or a "Leave a review" button.
- **Review form:** 1–5 star picker, optional comment (2000-char client cap; server caps effectively via the existing schema), submit/cancel, submit button disabled while pending, client-side "please select a rating" guard before the request is even sent (the server independently re-validates via Zod regardless).
- **Success state:** toast notification, form closes, `eligibleReviewees` is invalidated and refetched so the "Already reviewed" state appears immediately without a manual page reload.

**Eligibility is never computed or assumed client-side** — the panel renders directly from what `reviews.eligibleReviewees` returns, and `reviews.submit` independently re-validates everything on the write itself (§3), so a stale or tampered client render can't lead to an unauthorized write.

---

## 6. Review display

`VendorReputation` (`client/src/components/VendorReputation.tsx`) is the **one** reusable component — used on:
- `VendorProfile.tsx` (public, customer-facing) — new "Reputation" card.
- `ProviderDashboard.tsx` (vendor's own view) — added inside the existing profile section, so a vendor can see their own rating/count/reviews (§8).

It shows: star row + numeric average, review count, the individual review list (each with its own star rating, date, and comment), a "Verified Customer" label per review (see §9 for why no reviewer name is shown), and explicit loading/error/empty states — "No reviews yet" rather than a bare `0.0`.

---

## 7. Security verification

All re-verified **live, against a real seeded database**, not only in mocked tests:

| Risk | Result |
|---|---|
| IDOR | An unrelated user's real `reviews.eligibleReviewees` call for a project they don't own returned `[]`; their real `reviews.submit` attempt was rejected `FORBIDDEN` |
| Cross-project review creation | Covered by the same ownership check — a project ID the caller doesn't own is rejected regardless of which `revieweeId` is supplied |
| Cross-vendor review creation | A real request reviewing a `revieweeId` who was never awarded on that specific project was rejected `FORBIDDEN` ("This provider did not win an awarded RFQ on this project") |
| Self-review | Unchanged, pre-existing, re-confirmed by the existing test suite |
| Duplicate review | A real second `reviews.submit` for the same `(project, reviewer, reviewee)` was rejected `CONFLICT`; the database was checked directly afterward and still contained exactly one row |
| Review manipulation (edit/delete) | No such endpoint exists — confirmed by the pre-existing test asserting `reviews.update`/`reviews.delete` are absent from the router; unchanged by this phase |
| Mass assignment | `reviews.submit`'s Zod schema is unchanged (`projectId`, `revieweeId`, `rating`, `comment` only); `eligibleReviewees`/`statsForUser` are read-only queries with no write surface at all |
| User enumeration | `eligibleReviewees` returns `[]` identically whether the project doesn't exist, isn't completed, or isn't owned by the caller — no distinguishing signal |

**"A user must never submit a review by changing `projectId`/`revieweeId`/another identifier on the client"** — proven directly: a real logged-in user attempted exactly this against a real project and a real (but wrong) `revieweeId`, and the server rejected it. The client never decides eligibility; it only reflects the server's answer.

---

## 8. Localization

18 new key pairs (`reputation.*`, `review.*`), confirmed present in both English and Arabic maps by an automated parity test, and confirmed live in a real browser: `document.documentElement.dir` verified `"rtl"` on both the vendor profile page and the `ProjectDetail` Reviews tab after switching languages, with every new string (tab label, "Already reviewed," star labels, empty/eligibility messages) rendering as real Arabic text and the layout correctly mirrored — not a fallback, not a raw key.

---

## 9. Responsive verification

Verified live at 375px, 768px, and 1280px, in both languages, via real screenshots — **zero horizontal overflow** at any size (`scrollWidth > clientWidth` checked programmatically on every screenshot). The review form, star picker, rating display, and review cards all reflow correctly; buttons wrap (`flex-wrap`) rather than overflowing on narrow viewports.

**Deliberate design note on reviewer identity:** review cards show "Verified Customer" rather than the reviewing homeowner's name. `reviews.forUser` (pre-existing) does not join or return reviewer identity, and this phase did not change that — extending it to expose a customer's name was a new privacy/product decision not covered by the approved Phase 4A.4/4A.5 scope, so it was deliberately not added rather than assumed.

---

## 10. Tests added

`server/vendorReputation.test.ts` — 18 new tests: dynamic-rating correctness (zero-review null handling, rounding, malformed-row safety, "never reads a stored aggregate," "same `verified: true` filter as `forUser`"), `eligibleReviewees` correctness (dedup, already-reviewed flagging, empty for non-owner, empty for incomplete project, unauthenticated rejection, "reuses the same verified-participant definition as `submit`"), rating/comment storage correctness, invalid-rating rejection (both `0` and `6`), localization key parity, and UI-wiring/responsive source checks (single shared component, no duplicate rating calculation, no fixed pixel widths).

**Existing security tests were not modified or removed** — `server/reviewsAuthorization.test.ts` (16 tests, items 1–7 of the required authorization list) was re-run as-is.

---

## 11. Full test results

| Check | Result |
|---|---|
| Full suite | **248 / 248 passing** (230 pre-existing + 18 new), 0 failed, 0 skipped, 27 files |
| `vendorReputation.test.ts` | 18 / 18 |
| `reviewsAuthorization.test.ts` (regression) | 16 / 16, unmodified |
| `vendorProfile.test.ts` (regression) | 19 / 19, unmodified |

---

## 12. TypeScript result

`npx tsc --noEmit` → **0 errors.**

---

## 13. Frontend build

`npx vite build` → **succeeded** (same pre-existing bundle-size advisory as every prior phase, not new).

---

## 14. Server build

`npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist` → **succeeded**, `dist/index.js` 147.2kb.

---

## 15. Vendor Profile regression results

No regression: `vendorProfile.test.ts` (19 tests) passes unmodified; live-verified in the same session — the real vendor profile page (`/vendor/1`) rendered correctly with its existing profile fields (name, bio, location, verification badge, member-since, completed-projects count) alongside the new Reputation card, and the `ProviderDashboard.tsx` profile edit flow (view/edit toggle, save) was not touched by this phase's changes to that file (only a new reputation block was appended within the existing card).

---

## 16. Known limitations

1. **Carried forward, unchanged, from Phase 4A.6.1:** `ProviderDashboard.tsx` still redirects every authenticated user to `RolePlatform.tsx` before its content renders. This means the vendor's own reputation view (added to `ProviderDashboard.tsx`'s profile section in this phase) inherits the same unreachability as the profile section it was added to. The public `/vendor/:id` page and the new `ProjectDetail.tsx` Reviews tab have no such issue and are fully live and reachable today — confirmed by real browser testing this phase.
2. Review cards show "Verified Customer," not the reviewer's name (§9) — a deliberate scope decision, not an oversight, pending an explicit product decision on customer-name visibility.
3. `eligibleReviewees` only surfaces `reviews.submit`'s RFQ-linked verified-participant case, not its legacy role-based fallback for older/unlinked projects (consistent with the same scoping decision already documented in Phase 4A.3/4A.5 for this exact fallback) — a homeowner with an older, unlinked completed project will see "no reviewable providers found" even though the backend's fallback would technically allow a direct API call to succeed. This is a deliberately conservative UI choice, not a bug: the fallback has no well-defined, enumerable list of eligible reviewees to safely offer as UI choices.

---

## 17. Remaining owner decisions

Carried forward from Phase 4A.6.1, unchanged (both still open):
1. How the vendor-facing dashboard content (profile + reputation) should become reachable, given `ProviderDashboard.tsx`'s redirect.
2. Whether the public vendor profile (and now its reputation display) should eventually be viewable while fully logged out.

New from this phase:
3. Whether reviewer identity (the customer's name) should ever be shown on a review, instead of the current generic "Verified Customer" label (§9/§16 item 2).
4. Whether the legacy/unlinked-project review fallback should get its own UI treatment eventually, or remain API-only (§16 item 3).

---

## FINAL STATUS

## PASS — READY FOR PHASE 4A.6.3

All required verification passed: existing backend authorization confirmed correct and unmodified (and additionally proven live against a real database); dynamic rating implemented with no stored aggregate and no competing calculation; review submission and display fully implemented, tested, and localized; full security checklist verified both in mocked tests and live HTTP calls against real seeded accounts; responsive verification passed with zero overflow at all three required breakpoints in both languages; 248/248 tests, tsc, and both builds all clean; Vendor Profile confirmed not regressed. The known limitations (§16) are carried-forward or deliberately-scoped items, not defects in what was built.
