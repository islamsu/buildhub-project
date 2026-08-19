# BuildHub — Phase 4A.6.7: Admin User Data Security Hardening

**Scope:** Independently re-derive and, if confirmed, close the `admin.users` exposure identified as a byproduct of Phase 4A.6.6. Nothing else touched.

**Baseline branch:** `claude/phase4a66-auth-security-hardening` @ `42ee99c48f4a9b248bd236783bd094b493d84681` (itself built on `claude/phase4a64-dashboard-integration` @ `c37442022fc421ef46301b7f663c0e118ce7de15`)
**This phase's branch:** `claude/phase4a67-admin-user-data-security`

---

## 1. Exact Baseline SHA

`42ee99c48f4a9b248bd236783bd094b493d84681` — confirmed via `git rev-parse HEAD` immediately after creating this phase's branch, matching `origin/claude/phase4a66-auth-security-hardening` exactly. Working tree was clean (aside from pre-existing, unrelated untracked report files from earlier tasks, untouched throughout).

## 2. Exact `admin.users` Source Path

`server/routers.ts`, `adminRouter.users` (originally line 947, inside the `// ── Admin Router ──` section).

## 3. Exact Current Response Shape (before this phase)

```ts
users: adminProcedure.query(async () => {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt)).limit(250);
}),
```

`select()` with no column argument — the entire `users` row, all 35 columns, for up to 250 users, returned verbatim to the client. No `where` clause and no `.input()` at all (confirmed by direct inspection, not inferred), so there is no IDOR risk on this specific procedure — the exposure is breadth (every column, every user in the page), not targeting.

## 4. Exact Frontend Field-Consumption Analysis

Independently re-traced from `client/src/pages/AdminDashboard.tsx` (not assumed from the Phase 4A.6.6 report), by grepping every access on `allUsers`/`filteredUsers`/`userRow`/`freezeTarget`/`dummyPasswordTarget`/`auditTarget` — all of which share the exact same row shape returned by `admin.users` — across: the row-filter predicate (`filteredUsers`, line 311-317), the group-count reducer (`groupCounts`, line 319-322), the table row rendering (line 531), and the three action dialogs (freeze, dummy-password, audit).

| Field | Returned today | Actually consumed | Sensitive | Required |
|---|---|---|---|---|
| `id` | Yes | Yes — row key, action `userId` args, `isSelf` compare, audit-dialog fallback label | No | **Yes** |
| `name` | Yes | Yes — name column, dialogs | No | **Yes** |
| `email` | Yes | Yes — email column, search predicate, dialogs | No (own account data, admin-scoped) | **Yes** |
| `username` | Yes | Yes — `@handle` display, dialogs | No | **Yes** |
| `role` | Yes | Yes — group-label fallback (`userRole ?? role`) | No | **Yes** |
| `userRole` | Yes | Yes — group filter, group counts, group label, badge | No | **Yes** |
| `accountStatus` | Yes | Yes — frozen badge, freeze/unfreeze dialog title & body | No | **Yes** |
| `frozenReason` | Yes | Yes — frozen-badge tooltip text | No (admin-authored reason, not a secret) | **Yes** |
| `verified` | Yes | Yes — accepted/pending status badge for non-frozen users | No | **Yes** |
| `isDummy` | Yes | Yes — dummy badge, and which action-button set renders (dummy vs. real-account actions) | No | **Yes** |
| `accountSource` | Yes | Yes — "Admin Created" vs "Self Registered" badge, resend-invite button condition | No | **Yes** |
| `invitationStatus` | Yes | Yes — "Invite: …" line under the username (only rendered when not `'none'`) | No (a status label, not the token itself) | **Yes** |
| `createdAt` | Yes | Yes — "Joined" column | No | **Yes** |
| `passwordHash` | Yes | **No** — never read anywhere in `AdminDashboard.tsx` | **Yes — critical** | No |
| `invitationToken` | Yes | **No** — never read anywhere | **Yes — critical** | No |
| `invitationExpiresAt` | Yes | **No** | Yes (token metadata) | No |
| `invitationSentAt` | Yes | **No** | Low | No |
| `passwordSetAt` | Yes | **No** | Low | No |
| `onboardingReviewNotes` | Yes | **No** (the compliance section reads this from a *different* query, `admin.complianceQueue`/applicant data, not `admin.users`) | Yes (internal reviewer notes) | No |
| `creationNote` | Yes | **No** | Yes (internal note, may contain sensitive context) | No |
| `createdBy` | Yes | **No** | Low (internal FK) | No |
| `onboardingReviewedBy` | Yes | **No** | Low (internal FK) | No |
| `deactivatedAt` | Yes | **No** (`accountStatus`/`isDummy` alone drive the deactivate/activate button state) | Low | No |
| `frozenAt` | Yes | **No** | Low | No |
| `phone` | Yes | **No** | Yes (PII) | No |
| `bio` | Yes | **No** | Low | No |
| `location` | Yes | **No** | Low | No |
| `avatar` | Yes | **No** | Low | No |
| `rating` | Yes | **No** | No | No |
| `reviewCount` | Yes | **No** | No | No |
| `openId` | Yes | **No** | Low (internal identity string) | No |
| `loginMethod` | Yes | **No** | Low | No |
| `onboardingStatus` | Yes | **No** (this table's own "status" badge uses `verified`, not `onboardingStatus`; the separate Compliance tab shows onboarding status from a different query) | Low | No |
| `updatedAt` | Yes | **No** | No | No |
| `lastSignedIn` | Yes | **No** | Low | No |

**13 of 35 columns are actually used; 22 are returned but never consumed, including both explicitly-named sensitive items (`passwordHash`, `invitationToken`) and 8 other internal/PII fields the Phase 4A.6.6 report had already flagged by name, all independently reconfirmed here as unused.**

**Admin-only actions dependent on this data:** verified none of `setUserFrozen`, `setDummyUserActive`, `deleteDummyUser`, `setDummyUserPassword`, `verifyUser`, or `resendInvitation` read anything from the `admin.users` row shape beyond the 13 fields above (each mutation takes only a `userId` — and, for freeze, a reason string typed by the admin — as input; none of them pass through data read from the list response).

## 5. Sensitive-Field Exposure Assessment

Confirmed exposed, unnecessarily, to every admin session: `passwordHash` (scrypt hash of every user's password), `invitationToken` (a live, usable, bearer-style account-setup credential for any admin-created account still pending setup), plus 6 further internal/PII fields with no UI use. Same severity framing as Phase 4A.6.6's `auth.me` finding — no IDOR (no `admin.users` input parameter exists to target), but here the blast radius is **every user in the system simultaneously** (up to 250 per page) rather than only the requester's own row, since this is an admin-facing list endpoint. Given admin sessions are a smaller, more trusted population than "every authenticated user," this is a lower-likelihood but higher-blast-radius sibling of the `auth.me` finding.

## 6. Live Evidence of the Current Response

Performed against a real disposable local MariaDB + running dev server, authenticated as a real `role: 'admin'` test account, **before making any code change**:

```
$ curl .../api/trpc/admin.users  (admin session)
user count: 8
keys on first user: ['accountSource', 'accountStatus', 'avatar', 'bio', 'createdAt', 'createdBy',
  'creationNote', 'deactivatedAt', 'email', 'frozenAt', 'frozenReason', 'id', 'invitationExpiresAt',
  'invitationSentAt', 'invitationStatus', 'invitationToken', 'isDummy', 'lastSignedIn', 'location',
  'loginMethod', 'name', 'onboardingReviewNotes', 'onboardingReviewedAt', 'onboardingReviewedBy',
  'onboardingStatus', 'openId', 'passwordHash', 'passwordSetAt', 'phone', 'rating', 'reviewCount',
  'role', 'updatedAt', 'userRole', 'username', 'verified']
passwordHash present: True
invitationToken present: True
```
(Presence/absence stated only — no actual secret values are reproduced in this report, per instruction.) This independently reconfirms the finding exactly as described, from live behavior rather than source inspection alone.

## 7. Authorization Verification

All performed live, before and after the fix (authorization logic itself was not changed):

- **Admin-only:** confirmed — `adminProcedure` gate (`ctx.user.role !== 'admin'`) is unchanged and still enforced.
- **Non-admin rejection:** a real `testvendor` (contractor) session calling `admin.users` received `403 FORBIDDEN`.
- **Unauthenticated rejection:** an unauthenticated call received `401 UNAUTHORIZED`.
- **IDOR:** confirmed not applicable — `admin.users` has no `.input()` of any kind (verified both by direct source reading and by a dedicated regression test, §12), so there is no parameter through which any account could be targeted, listed selectively, or excluded.

## 8. Approved Response Allowlist

Implemented as `ADMIN_USER_LIST_COLUMNS`, directly above `adminRouter` in `server/routers.ts`, matching the same explicit-Drizzle-column-object pattern already established by `PUBLIC_PROFILE_COLUMNS` (Phase 4A.6.1):

```ts
const ADMIN_USER_LIST_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  role: users.role,
  userRole: users.userRole,
  accountStatus: users.accountStatus,
  frozenReason: users.frozenReason,
  verified: users.verified,
  isDummy: users.isDummy,
  accountSource: users.accountSource,
  invitationStatus: users.invitationStatus,
  createdAt: users.createdAt,
} as const;
```

Exactly the 13 fields identified as genuinely consumed in §4 — no more, no less. This is a compile-time Drizzle column-selection object (`db.select(ADMIN_USER_LIST_COLUMNS).from(users)`), not a second `select().from(users)` and not a runtime field-stripping step — so it is **future-safe by construction**: a new column added to `users` later is simply absent from this object and is never returned, with no risk of an accidental future regression the way a bare `select()` would silently start leaking any new column by default.

## 9. Exact Implementation Changes

**`server/routers.ts`** (2 changes, both in the existing Admin Router section):
1. Added the `ADMIN_USER_LIST_COLUMNS` constant (with an explanatory security comment, matching the established `PUBLIC_PROFILE_COLUMNS` documentation style) directly above `DEFAULT_ADMIN_SETTINGS`.
2. Changed `adminRouter.users`'s single query from `db.select().from(users)...` to `db.select(ADMIN_USER_LIST_COLUMNS).from(users)...` — one line.

No other file was modified. `auth.me`, `auth.logout`, `server/_core/sdk.ts`, `server/_core/context.ts`, `server/db.ts`, and every Phase 3C migration file are untouched (confirmed via `git status`/`git diff` scoped review before committing).

## 10. Security Rationale

Identical principle to Phase 4A.6.6: never return an entire database row when the client needs only a subset, expressed as an explicit, named, compile-time-checked allowlist rather than post-hoc field deletion — so a future column addition to `users` cannot silently reach the client through this endpoint without a deliberate, reviewable one-line addition to `ADMIN_USER_LIST_COLUMNS`. Every included field was independently traced to real, current UI consumption (§4); nothing was retained "just in case."

## 11. Tests Added

`server/adminUserDataSecurity.test.ts` (new, 13 tests):

- **Response shape (6 tests):** the query is called with an explicit column object (not `select()` with no arguments) whose keys are exactly the 13 approved fields; `passwordHash` absent from the allowlist source; `invitationToken` absent; a further 16-item explicit negative list (`invitationExpiresAt`, `invitationSentAt`, `passwordSetAt`, `onboardingReviewNotes`, `creationNote`, `createdBy`, `onboardingReviewedBy`, `deactivatedAt`, `frozenAt`, `phone`, `bio`, `location`, `avatar`, `openId`, `rating`, `reviewCount`, `loginMethod`, `onboardingStatus`, `updatedAt`, `lastSignedIn`) confirmed absent; source-level confirmation that `select().from(users)` with no column list never appears in the `admin.users` procedure; every one of the 13 required fields confirmed present.
- **Authorization (5 tests):** non-admin homeowner rejected; non-admin provider rejected; unauthenticated rejected; no `.input()` exists on the procedure (structural IDOR-impossibility, mirroring the pattern established for `analytics.myStats` in Phase 4A.6.3); a real admin session succeeds.
- **Regression (2 tests):** `setUserFrozen`/`setDummyUserActive`/`deleteDummyUser`/`setDummyUserPassword` still present and still `adminProcedure`-gated; `accountAudit` still present.

**No existing test was modified or weakened.** No pre-existing test referenced `admin.users` at all (confirmed by grep before writing new tests), so there was nothing to update.

## 12. Full Test Result

```
 Test Files  31 passed (31)
      Tests  317 passed (317)
```
317 = 304 (Phase 4A.6.6 baseline) + 13 new. All passing, fresh run.

## 13. TypeScript Result

```
$ npx tsc --noEmit
(no output — 0 errors)
```

## 14. Frontend Build Result

```
$ vite build
✓ built in 24.43s
```

## 15. Server Build Result

```
$ esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
dist/index.js  151.0kb
```

## 16. Live Browser Verification

Real browser (Playwright), real admin session (cookie seeded with a genuinely-issued token to work around this sandbox's known plain-HTTP `SameSite=None`-without-`Secure` cookie-drop limitation — documented and unrelated to this phase, see Phase 4A.6.4/4A.6.5/4A.6.6 reports), against the post-fix code:

- **Login → Admin Control Panel → User Management:** all 8 real users rendered correctly (name, email, `@username`, group badge, status badge, joined date, action buttons) — full-page screenshot captured.
- **Search:** typing "Nile" correctly filtered the table to "Nile Construction Co." only.
- **Filter by group:** clicking "Contractors" correctly filtered to the 4 contractor accounts and updated the active-filter highlight.
- **Deactivate → Activate cycle:** clicked the real "Deactivate" button on a real dummy account — the button correctly flipped to "Activate" (a real mutation, real re-fetch of the now-hardened `admin.users` reflecting the changed `accountStatus`); clicking "Activate" correctly flipped it back to "Deactivate".
- **Audit dialog:** opened correctly for a real user, showing real, correctly-ordered audit events including the deactivate/activate actions just performed.
- **Password dialog:** "Set dummy-user password" dialog opened correctly for a real dummy account.
- **Real network response** (captured directly, not inferred): exactly the 13-field allowlist, `passwordHash` absent, `invitationToken` absent — matching §6's before/after comparison exactly.

Not exercised live in this pass: the Freeze/Unfreeze/Verify button path specifically, because every account currently seeded in this disposable test database is a dummy account (`isDummy: true`), and the UI renders Deactivate/Activate/Password/Delete for dummy accounts and Freeze/Verify only for non-dummy accounts — this is a pre-existing, unrelated property of the seed data used across this whole engagement, not a limitation introduced by this fix. The underlying data this path depends on (`accountStatus`, `frozenReason`) is confirmed present in the live network response (§6/§16) and is exercised by the freeze/unfreeze unit-level logic already covered in `server/admin.test.ts` (pre-existing, unmodified).

## 17. Regression Verification Against Phase 4A.6.1–4A.6.6

All re-confirmed live, in the same session, against the post-fix code:
- **Phase 4A.6.6 (`auth.me`/`auth.logout`):** `auth.me` still returns exactly its own 6-field allowlist; logout still server-side revokes the session; replaying the same token after logout still returns `null`. Unaffected by this phase's changes (different procedure, different file region).
- **Phase 4A.6.1–4A.6.3 (Vendor Profile/Reputation/Analytics):** `profile.getOwn`, `analytics.myStats` re-verified live for `testvendor`, returning correct, previously-known values.
- **Git state:** `origin/main` (`71d891f…`), `origin/archive/manus-login-fix-4fcb464` (`4fcb464…`), `origin/claude/phase4a64-dashboard-integration` (`c374420…`), and `origin/claude/phase4a66-auth-security-hardening` (`42ee99c…`) all reconfirmed, via fresh `git fetch` + `git rev-parse`, to be byte-for-byte unchanged from their expected SHAs throughout this phase.

## 18. Remaining Security Findings

No new critical or blocking issue was found. Two items already on record from Phase 4A.6.6, re-confirmed still open and explicitly out of this phase's scope (not touched here, consistent with "no unrelated changes"):
1. Frozen-account status is not re-checked on every request (only at `signInDummy` sign-in time).
2. Revoked-session rows (Phase 4A.6.6) are not actively pruned.

No further admin-facing endpoint was found, in the course of this specific investigation, to have the same unallowlisted `select().from(users)` pattern — `admin.stats` and `admin.accountAudit` were both directly inspected and confirmed to already use explicit column selections or non-`users` queries respectively.

## 19. Production-Readiness Impact

The `admin.users` finding flagged at the end of Phase 4A.6.6 is now confirmed and closed with the same minimal, targeted, live-verified pattern used for `auth.me`: an explicit, named, future-safe column allowlist, zero behavioral change to any admin workflow, and full regression coverage across both the new finding and every previously-hardened area. Combined with Phase 4A.6.6, the two most direct paths by which credential material (`passwordHash`, `invitationToken`) could reach a browser in this application are now both closed.

---

## Final Status

**PASS — ADMIN USER DATA SECURITY HARDENING COMPLETE**
