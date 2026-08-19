# BuildHub — Phase 4A.6.6: Authentication Security Hardening

**Scope:** Close the two genuine authentication-security findings independently discovered during Phase 4A.6.5 — (1) `auth.me` exposing the full `users` row including `passwordHash`/`invitationToken`, and (2) `auth.logout` not server-side revoking the underlying session token. Nothing else was touched.

**Baseline branch:** `claude/phase4a64-dashboard-integration` @ `c37442022fc421ef46301b7f663c0e118ce7de15`
**This phase's branch:** `claude/phase4a66-auth-security-hardening`

---

## 1. Exact Baseline SHA

`c37442022fc421ef46301b7f663c0e118ce7de15` — confirmed identical to `origin/claude/phase4a64-dashboard-integration` before branching, and reconfirmed unchanged at every point during this phase.

## 2. Exact Findings for `auth.me`

`authRouter.me` was `publicProcedure.query(opts => opts.ctx.user)` — it returned `ctx.user` verbatim, which is the **entire** `users` row as fetched by `sdk.authenticateRequest`'s `db.getUserByOpenId(...)` call, with no column allowlist of any kind. Confirmed live before any change (`curl` against a real session): the JSON response included `passwordHash` (the scrypt hash) and every other column verbatim.

## 3. Exact Sensitive Fields Exposed

From the 36-column `users` table (`drizzle/schema.ts`), everything was exposed to the client on every `auth.me` call, including:
- **`passwordHash`** — the scrypt hash of the account's own password.
- **`invitationToken`**, `invitationExpiresAt`, `invitationSentAt`, `invitationStatus`, `passwordSetAt` — the admin-created-account invitation/setup credential and its metadata.
- Internal/administrative fields with no legitimate client use: `frozenReason`, `onboardingReviewNotes`, `creationNote`, `createdBy`, `onboardingReviewedBy`, `deactivatedAt`, `frozenAt`, `accountSource`, `isDummy`.
- PII beyond what any client code reads: `phone`, `bio`, `location`, `avatar`, `openId`, `username`.

## 4. Exact Frontend Consumers

Every consumer of `useAuth()`'s `user` object was enumerated by grepping all 12 files that call `useAuth()` for every `user.<field>` / `(user as any).<field>` access pattern, then independently cross-checked against `RolePlatform.tsx`'s own explicit TypeScript cast (`user as { userRole?; role?; onboardingStatus? }`). The complete, exhaustive result — **only 6 fields are ever read from `auth.me` anywhere in the client**:

| Field | Consumers |
|---|---|
| `id` | `RFQPage.tsx` (ownership check), `AdminDashboard.tsx` (self-action guard), `MessagesPage.tsx` (message-direction check) |
| `name` | `Navbar.tsx`, `DashboardLayout.tsx`, `HomeownerDashboard.tsx` (display) |
| `email` | `DashboardLayout.tsx` (display) |
| `role` | `AdminDashboard.tsx`, `DashboardLayout.tsx` (admin-menu gating), `RolePlatform.tsx` (admin redirect) |
| `userRole` | `RolePlatform.tsx`, `Navbar.tsx`, `DashboardLayout.tsx`, `ProviderDashboard.tsx`, `CompliancePage.tsx`, `AuthPage.tsx` (role-based routing/menus — 23 occurrences) |
| `onboardingStatus` | `RolePlatform.tsx`, `AuthPage.tsx` (compliance routing) |

No other field (`avatar` included — only `AvatarFallback`/initials are used anywhere, never `AvatarImage`/`user.avatar`) is read from `useAuth()`'s `user` object anywhere in the codebase. Removing every other field therefore breaks no legitimate existing client behavior — verified both by this exhaustive grep and by the full live regression pass in §15.

**Item 8 (admin-only functionality relying on unexposed fields):** none. The admin User Management table (`admin.users` procedure) is a **separate, already admin-gated query**, not `auth.me` — it does not need `auth.me` to expose anything broader. (This same query was found, while investigating this, to have the identical `select().from(users)` over-fetch pattern as `auth.me` did — flagged in §17 as a closely related follow-up, explicitly not fixed here as it is a different procedure than either of the two named findings.)

**Item 9 (role-based response differences):** no — every role receives the identical 6-field shape from `auth.me`; role-specific data (the admin user table, vendor profile, etc.) is served by separate, already-scoped procedures.

**Item 10 (single DTO vs. role-specific DTOs):** a single DTO is correct and sufficient — every role needs the identical 6 fields (their own identity + role/approval state for client-side routing), and no role needs anything beyond that from this specific endpoint.

## 5. Exact Logout/Session Architecture

Traced from source, `server/_core/sdk.ts`/`server/_core/oauth.ts`/`server/_core/cookies.ts`:

- **Sessions are stateless JWTs** (`jose`'s `SignJWT`/`jwtVerify`, HS256), signed with `ENV.cookieSecret`. Before this phase, the payload carried only `openId`, `appId`, `name` — no `jti`, no `iat`.
- **No server-side session record existed** prior to this phase — nothing beyond the JWT itself represented "a session."
- **`authRouter.logout` invalidated nothing server-side** — it called only `ctx.res.clearCookie(...)`, an instruction to the *browser*, not the server.
- **Token lifetime:** `ONE_YEAR_MS` (365 days) — the default for `sdk.signSession` whenever a caller doesn't override `expiresInMs`. Both the OAuth callback (explicitly) and `signInDummy` (implicitly, by omission) use this same default. **Every session in this application, real or dummy, lasts up to one year.**
- **`sdk.authenticateRequest` already re-fetches the user row from the database on every single request** (`db.getUserByOpenId(sessionUserId)`) — it does not trust cached/stale claims for anything beyond the `openId` used to look the row up. This was the key architectural fact that shaped the remediation design (§8): a revocation check can piggyback on this already-happening per-request DB read at negligible extra cost, with no new session-store infrastructure required.
- **No revocation mechanism existed anywhere else in the codebase** prior to this phase (confirmed by grep for "revoke"/"blacklist"/"session" across `server/`).

## 6. Exact Token Replay Behavior (before this phase)

Directly reproduced, live, before any code change: signed in, confirmed `auth.me` returned the user, called `auth.logout` (`{success:true}`), then replayed the **exact same, now-"logged-out"** cookie value against `auth.me` again — it still returned the full authenticated user. The token remained fully valid and usable for up to a year after "logout," for both the dummy sign-in path and, structurally, the identical-code-path real OAuth login (`server/_core/oauth.ts` calls the same `sdk.createSessionToken`/`signSession`).

## 7. Severity of Each Issue

**`auth.me` exposure:**
- **Severity: Moderate.** Exploitable only by an authenticated user against **their own row** — there is no IDOR here; a user can only ever see their own `passwordHash`/`invitationToken`, never another user's (confirmed: `ctx.user` is always the requester's own session-authenticated row, never a queryable-by-id parameter). The real risk is not direct account takeover (scrypt hashes are not trivially reversible, and the client never needed the hash for anything), but unnecessary exposure of credential material to every place the client's own JavaScript runtime, browser devtools, browser extensions, or a future XSS could observe it — a defense-in-depth violation, not an active exploit path on its own. `invitationToken` is the more materially sensitive item for admin-created-but-not-yet-claimed accounts, since it is itself a bearer-style setup credential.
- **Not exaggerated:** no cross-user exposure exists, and nothing in this investigation found a way to use the exposed hash to escalate privilege without already controlling the account it belongs to.

**`auth.logout` replay:**
- **Severity: Moderate, driven primarily by the one-year token lifetime.** Not exploitable without an attacker already possessing a legitimately-issued, valid token (shared/public computer, stolen device, browser-extension or XSS-based cookie theft, cached/logged request). Given that precondition, though, the replay window is not "until the user notices and changes their password" — it is up to a full year regardless of how many times the legitimate user logs out believing they are safe. This is a real, not merely theoretical, gap for exactly the scenario logout exists to protect against (a shared or since-compromised device).

## 8. Chosen Remediation and Why

**`auth.me`:** an explicit field allowlist, applied as a **plain object pick from the already-authenticated `ctx.user`** (not a second `select().from(users)` query) — `toPublicSessionUser()` in `server/routers.ts`. This costs zero additional database queries (the row is already loaded by `authenticateRequest`), cannot silently regress if a future column is added to the `users` table (a `select().from(users)` would leak a brand-new column by default; a hand-written allowlist cannot), and matches the exact allowlist pattern already established in this codebase for `profileRouter`'s `PUBLIC_PROFILE_COLUMNS` (Phase 4A.6.1).

**`auth.logout`:** evaluated all four options the task specified:
- **(A) Server-side revocation list** — chosen, in the smallest viable form: a per-token (`jti`) revocation table, not a full session-management system.
- **(B) Database-backed session records** (a full sessions table replacing the stateless JWT model) — rejected as unnecessarily large; would mean re-architecting every authenticated request's session-lookup path for no benefit over (A) given `authenticateRequest` already re-fetches from the DB every request regardless.
- **(C) Short-lived access tokens + refresh-token rotation** — rejected as materially more complex (a second token type, a rotation/refresh endpoint, refresh-token storage) to solve a problem (C) doesn't even directly solve better than (A) — it reduces the *default* exposure window but still requires an explicit revocation mechanism for the "log out now" case regardless.
- **(D) An existing SDK-supported mechanism** — none exists (§5); ruled out.

**Design:** every issued JWT now carries a unique `jti` (`.setJti(randomUUID())` in `signSession`, shared by both the OAuth and dummy sign-in paths since both call the same function). `auth.logout` inserts that one session's `jti` into a new `revokedSessions` table (`jti` primary key, `userId`, `revokedAt`, `expiresAt`). `authenticateRequest` — which was already querying the database on every request — now also checks `revokedSessions` for the incoming token's `jti` before trusting it, rejecting with `ForbiddenError` if found. This is a **per-token**, not per-user, revocation: logging out one device/tab does not affect any other concurrently-valid session for the same account (verified live, §15) — deliberately chosen over a simpler single-timestamp-per-user cutoff design specifically because that simpler design would have failed exactly this requirement.

A dedicated table (rather than reusing the existing `userAccountAuditEvents` audit log) was chosen because mixing an insert-only historical audit trail with a hot-path, indexed-lookup-on-every-request security check would be both semantically confused and slower (the audit table has no index shaped for this lookup and is expected to grow unbounded as a permanent record, whereas revoked-session rows are inherently ephemeral). `onDelete: 'cascade'` (not the general Phase 3C `RESTRICT` convention, and not `userAccountAuditEvents`' `SET NULL`) was deliberately chosen for `revokedSessions.userId`: a revocation record has no value once its user no longer exists — unlike real business data or an audit trail, there is nothing left to protect from replay — and using `RESTRICT` here would have introduced an unwanted, unrelated side effect of blocking the pre-existing `admin.deleteDummyUser` workflow for up to a year after any logout event on that account. This reasoning is documented directly in `drizzle/schema.ts` alongside the table definition.

## 9. Files Changed

- `drizzle/schema.ts` — new `revokedSessions` table.
- `drizzle/0013_whole_gideon.sql` (new migration) + `drizzle/meta/0013_snapshot.json` + `drizzle/meta/_journal.json` (updated) — generated by `drizzle-kit generate`; **`drizzle/0012_broken_nightmare.sql` (Phase 3C's migration) was not touched.**
- `server/db.ts` — new `isSessionRevoked(jti)` / `revokeSession(jti, userId, expiresAt)` helpers, following the file's existing `getDb()`-per-call convention exactly.
- `server/_core/sdk.ts` — `signSession` now sets a `jti`; `verifySession` now extracts and returns `jti`/`expiresAt`; `authenticateRequest` now rejects a revoked `jti` and attaches the current session's `jti`/`expiresAt` onto the returned user object; `AuthenticatedUser` type extended (optional fields only).
- `server/_core/context.ts` — `TrpcContext.user` retyped from `User` to `AuthenticatedUser` (a strict superset) so the new optional session fields are visible/typed where needed; no behavioral change.
- `server/routers.ts` — `authRouter.me` now returns `toPublicSessionUser(ctx.user)` instead of `ctx.user` verbatim; `authRouter.logout` now calls `revokeSession(...)` when the current session carries a `jti`.
- `server/authSecurityHardening.test.ts` (new) — see §10.

**Not changed:** `server/storageProxy.test.ts`, any login-button/`AuthPage.tsx` code, any Phase 3C migration file, any Stripe/monetization/vendor-feature file, `main`, `archive/manus-login-fix-4fcb464`, `claude/phase4a64-dashboard-integration`.

## 10. Tests Added

`server/authSecurityHardening.test.ts` (new, 18 tests):

- **`auth.me` shape (6 tests):** returns exactly the 6-field allowlist; `passwordHash` absent (including a raw-string `"scrypt$"` substring check); `invitationToken` absent; every other sensitive/internal field absent (a 21-field explicit negative-assertion list); `role`/`userRole`/`onboardingStatus` remain correct for a non-default role combination; unauthenticated `auth.me` remains `null`.
- **Source verification (1 test):** confirms `toPublicSessionUser` is used and that no `select().from(users)` appears in the `authRouter` block.
- **Internal authorization unaffected (3 tests):** `adminProcedure` still grants/denies based on the real `ctx.user.role` (not the trimmed DTO) using `admin.settings`; `approvedProviderProcedure` still grants/denies based on `ctx.user.userRole`/`onboardingStatus` using `projects.directory`; a homeowner still reaches `projects.list`.
- **`auth.logout` revocation (3 tests):** revokes when `sessionJti` is present, with the exact `(jti, userId, expiresAt)` arguments; does **not** attempt revocation when absent (preserving the pre-existing `auth.logout.test.ts` contract exactly, unmodified); revoking one session never references another session's jti.
- **`sdk.ts` wiring (5 tests, source-verified — see §16 for why):** `signSession` assigns a `jti` to every token; `verifySession` extracts and returns it; `authenticateRequest` checks `db.isSessionRevoked` and rejects with the correct message; a token with no `jti` is never even passed to the revocation check; the OAuth login path signs through the identical `sdk.createSessionToken` (no separate, unrevoked code path).

**No existing test was modified or weakened.** `server/auth.logout.test.ts` (pre-existing, unmodified) still passes unchanged — its mock `ctx.user` carries no `sessionJti`, exercising exactly the "no revocation attempted" branch.

## 11. Full Test Result

```
 Test Files  30 passed (30)
      Tests  304 passed (304)
```
304 = 286 (Phase 4A.6.4/4A.6.5 baseline) + 18 new. All passing, fresh run.

## 12. TypeScript Result

```
$ npx tsc --noEmit
(no output — 0 errors)
```

## 13. Frontend Build Result

```
$ vite build
✓ built in 25.04s
```

## 14. Server Build Result

```
$ esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
dist/index.js  150.5kb
```
(148.4kb → 150.5kb — the small, expected increase from the new revocation-check code path.)

## 15. Live Verification Evidence

All performed against a real disposable local MariaDB with the migration from §9 actually applied, and a real running dev server — every claim below is a real, observed HTTP/DB/browser result, not an inference:

1. **`auth.me` real HTTP response**, signed in as `testvendor`: `{"id":1,"name":"Nile Construction Co.","email":"testvendor@example.com","role":"user","userRole":"contractor","onboardingStatus":"approved"}` — exactly the 6-field allowlist, nothing else.
2. **Absence of `passwordHash`**: confirmed directly in the response body above — not present.
3. **Absence of `invitationToken`**: confirmed directly in the response body above — not present.
4. **Normal authentication**: `signInDummy` real call succeeded (`{"success":true,"userRole":"contractor","onboardingStatus":"approved"}`).
5. **Logout**: real call succeeded (`{"success":true}`); the `revokedSessions` table was confirmed, via direct SQL, to contain the real row (`jti`, `userId: 1`, `revokedAt`, `expiresAt` ≈ one year out).
6. **Token replay after logout**: the *exact same* cookie value, replayed against `auth.me` immediately after logout, returned `{"result":{"data":{"json":null}}}` — rejected. Before logout, the identical call had returned the full user. This is the core fix, directly proven.
7. **Multi-session non-interference**: signed in as `testvendor` from two independent sessions ("Device A"/"Device B", confirmed to carry different `jti`-bearing tokens); Device A logged out; Device A's token was rejected afterward; **Device B's token still worked correctly** — proving logout revokes only the session that logged out, not every session for that user.
8. **Role routing**: homeowner `auth.me` → `role:"user", userRole:"homeowner"`; admin `auth.me` → `role:"admin"`; both correct.
9. **Admin access**: `admin.settings` (an `adminProcedure`-gated endpoint) succeeded for the real admin session.
10. **Provider access**: `profile.getOwn`, `reviews.statsForUser`, and `analytics.myStats` (Phase 4A.6.1/4A.6.2/4A.6.3 endpoints) all returned correct, real, previously-known values for `testvendor` — no regression.
11. **Homeowner access**: confirmed via the role-routing check in item 8 and the unaffected `auth.logout.test.ts`/regression suite.
12. **Existing Phase 4A.6 profile/reputation/analytics behavior**: directly re-verified live in item 10, and additionally confirmed in a **real browser** (Playwright, cookie-jar seeded with a genuinely-issued token to work around this sandbox's known plain-HTTP `SameSite=None`-without-`Secure` cookie-drop limitation — documented and unrelated to this phase, see Phase 4A.6.4/4A.6.5 reports): the real Contractor Workspace page rendered with Vendor Profile, Reputation (4.5★, 2 reviews), and Analytics (2 submitted / 1 accepted / 50% / 2 hrs) all correct, and the browser's own observed network response for `auth.me` was captured directly from the page and matches item 1 exactly. Screenshot captured.
13. **Invalid password / unauthenticated `auth.me`**: both re-confirmed correct and unchanged (`401 UNAUTHORIZED` with a clean message; `auth.me` → `null`).

## 16. Security Regression Assessment

- **Password hashing (scrypt) / timing-safe comparison:** untouched (`hashPassword`/`verifyPassword` in `server/routers.ts` were not modified).
- **Role/onboarding authorization (`adminProcedure`, `protectedProcedure`, `approvedProviderProcedure`, frozen-account gate in `signInDummy`):** untouched, and directly re-exercised (not just read) in both the new unit tests and the live verification above — all continue to gate correctly.
- **`storageProxy.test.ts`:** not touched.
- **No new attack surface introduced:** `revokedSessions` is written to only by `auth.logout` (using the *caller's own* `sessionJti`, never a client-supplied id — there is no field in `logout`'s input at all, so there is no way to name another session), and read only by `authenticateRequest`'s own internal check.
- **One deliberate limitation, not a regression:** a JWT issued *before* this phase's deployment carries no `jti` and is therefore not revocable by this mechanism — it remains valid until its own natural (up to one-year) expiry, exactly as it already was before this phase. This is not a new gap; it is the same pre-existing behavior, now closed only for tokens issued going forward. No pre-existing security guarantee was weakened to make this trade-off.
- **`sdk.ts`/`context.ts` are not covered by fully isolated, dependency-injected unit tests** for the new `isSessionRevoked`/`revokeSession` database functions specifically (consistent with every other function in `server/db.ts`, none of which have isolated unit tests in this codebase's existing convention — they are exercised through router-level mocking and, as here, real live verification instead). This is a pre-existing testing-convention characteristic of the codebase, not something newly introduced or newly risky by this phase; the live verification in §15 directly exercises the real, unmocked code path against a real database.

## 17. Remaining Authentication Risks

1. **`admin.users` (the admin User Management table query) has the identical unallowlisted `select().from(users)` pattern `auth.me` had**, meaning any admin session currently receives every user's `passwordHash`/`invitationToken` in that table's response. This was discovered as a direct byproduct of tracing every consumer for §4/Objective 1 item 8, is the same root-cause pattern as finding #1, and is a natural, low-risk, high-value follow-up — but it is a different procedure than either of the two findings this phase was explicitly chartered to close, so it was **documented, not fixed**, per this phase's explicit "no unrelated changes" scope boundary.
2. **Revoked-session rows are not actively pruned.** They become inert once their `expiresAt` has passed (the JWT itself would already fail `exp` validation by then, ahead of ever reaching the revocation check), so this is not a correctness issue, but a periodic cleanup job would be reasonable future housekeeping to bound table growth over a long production lifetime.
3. **Frozen-account status is not re-checked on every request** — `signInDummy` checks `accountStatus`/`deactivatedAt` at sign-in time only; `authenticateRequest`'s per-request DB refetch does not itself reject an account that becomes frozen mid-session. This is a pre-existing characteristic (unrelated to and unchanged by this phase, and outside its two named findings) noted here for completeness since it was directly observed while tracing the same per-request authentication path this phase modified.
4. Real-user OAuth login could not be end-to-end browser-tested in this sandbox (`OAUTH_SERVER_URL` unconfigured, same as documented in Phase 4A.6.5) — its session-issuance code path was confirmed, by direct source reading, to be identical to the dummy path's (both call `sdk.createSessionToken`/`signSession`), so the `jti`/revocation mechanism applies to it equally, but this specific claim rests on code-path identity rather than an independent live OAuth test.

## 18. Impact on Production Readiness

Both findings from Phase 4A.6.5 are now closed with a minimal, targeted, live-verified fix: credential material no longer reaches the client on every page load, and logout now provides genuine server-side session revocation without disturbing other concurrent sessions for the same account. Neither change altered authentication architecture beyond what was proven necessary (no refresh tokens, no session-store migration, no change to password hashing or OAuth flow), and the full existing regression suite plus live Phase 4A.6.1-4A.6.3 feature checks confirm nothing else was disturbed. The one closely-related, newly-surfaced item (`admin.users`'s identical over-fetch pattern, §17.1) is a reasonable, well-scoped candidate for a short, dedicated follow-up before this application is considered fully hardened for production authentication, but does not block this phase's own two findings from being considered resolved.

---

## Final Status

**PASS — AUTHENTICATION HARDENING COMPLETE**
