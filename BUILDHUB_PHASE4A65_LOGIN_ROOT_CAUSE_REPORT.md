# BuildHub — Phase 4A.6.5: Login Root-Cause Investigation

**Scope:** Investigate the real login experience from first principles, independent of the reverted Manus diagnosis. Implement a fix only if a genuine, reproducible defect is found.

---

## 1. Baseline Branch and SHA

`claude/phase4a64-dashboard-integration` @ `c37442022fc421ef46301b7f663c0e118ce7de15`

## 2. Investigation Branch and SHA

`claude/phase4a65-login-root-cause-fix`, created from the baseline above. **No commits were made on this branch** — the investigation found no genuine application defect (see §22), so per this task's own instruction ("If no genuine defect can be reproduced: DO NOT CHANGE CODE"), the branch's tree is identical to the baseline. This report is the branch's only addition, committed on its own once this investigation concluded.

## 3. Exact Login Flow Traced

Read directly from source, not from any prior report:

```
AuthPage.tsx (client)
  ├─ Dummy path: handleDummySignIn() → trpc.auth.signInDummy.useMutation()
  │    → POST /api/trpc/auth.signInDummy
  │       server/routers.ts: getUserByUsername → verifyPassword (scrypt, timingSafeEqual)
  │                            → accountStatus/deactivatedAt check
  │                            → sdk.createSessionToken → res.cookie(...)
  │                            → returns { success, userRole, onboardingStatus }
  │    ← onSuccess: navigate(getRolePlatformPath(result.userRole)) directly from the
  │       mutation's own response payload (does NOT wait on any auth.me refetch)
  │
  └─ Real-user path: startLogin() → external OAuth portal → GET /api/oauth/callback
       server/_core/oauth.ts: decode+verify CSRF state → exchangeCodeForToken → getUserInfo
                                → db.upsertUser → sdk.createSessionToken → res.cookie(...)
                                → res.redirect(302, returnTo)   [full page load, not a client navigate]

Every subsequent page: useAuth() → trpc.auth.me.useQuery() → server/_core/context.ts:
  createContext → sdk.authenticateRequest(req) → sdk.verifySession(cookie) → ctx.user
  → RolePlatform.tsx / AdminDashboard.tsx / etc. read ctx.user.role / ctx.user.userRole /
    ctx.user.onboardingStatus and redirect via getRolePlatformPath() accordingly.
```

Both the dummy and real-user paths converge on the identical `getSessionCookieOptions()` (`server/_core/cookies.ts`) for issuing the session cookie, and both converge on the identical `sdk.authenticateRequest`/`verifySession` path for reading it back on every subsequent request.

## 4. Test Accounts Used

| Username | Role | accountStatus | onboardingStatus | Purpose |
|---|---|---|---|---|
| `testvendor` | contractor | active | approved | baseline provider login |
| `testhomeowner` | homeowner | active | approved | baseline homeowner login |
| `testunapproved` | engineer | active | **under_review** | unapproved-provider routing |
| `testadmin` (new, this investigation) | homeowner / **role=admin** | active | approved | admin login + redirect-hop check |
| `testfreshdummy` (new, this investigation) | contractor | **frozen at creation**, then activated | not_started | live frozen-account reproduction, created via the real `admin.createDummyUser` API as an actual admin would |

## 5. Results for Every Login Mode

| # | Mode | Button enabled? | Click fired? | API request fired? | Auth succeeded? | Session created? | Cookie accepted (pure browser)? | `auth.me` correct? | Role detected? | `navigate()` called? | Final destination | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Normal (real OAuth) user login | N/A (external portal button) | N/A | **Blocked** — no reachable `OAUTH_SERVER_URL` in this sandbox | untestable | untestable | untestable | untestable | untestable | untestable | untestable | **Environment-blocked**, not reproduced either way (see §21) |
| 2 | Dummy/test user login (`testvendor`, valid password) | Yes | Yes | Yes, `200` | Yes | Yes (real `Set-Cookie`) | **No** — dropped by Chrome (SameSite=None, no Secure) | N/A (no cookie) | N/A | Yes, immediately, from the mutation's own response | Bounces to `/auth?mode=login` in pure browser interaction; **lands correctly on `/platform/contractor` once the cookie-transport limitation is compensated for** (§7) | Application logic correct; environment-limited in this sandbox only |
| 3 | Admin login (`testadmin`) | Yes | Yes | Yes, `200` | Yes | Yes | Same transport limitation as #2 | Correct (`role:"admin"`) once cookie present | Correct | Yes, twice (see §11) | `/platform/homeowner` → `/admin` (self-corrects within ms) | Correct final destination, one extra internal hop |
| 4 | Provider login | Yes | Yes | Yes | Yes | Yes | Same limitation | Correct | Correct | Yes | `/platform/contractor` | Correct |
| 5 | Homeowner login | Yes | Yes | Yes | Yes | Yes | Same limitation | Correct | Correct | Yes | `/platform/homeowner` | Correct |
| 6 | Other provider roles (engineer/architect/supplier/PM) | N/A — same code path as #4, not role-specific | — | — | — | — | — | — | — | — | — | Not separately reproducible (login has no role-specific branching before `getRolePlatformPath`) |
| 7 | Invalid password | Yes (button was never gated on correctness, only length) | Yes | Yes, `401` | **No**, correctly rejected | No | N/A | N/A | N/A | No | Stays on `/auth?mode=login`, generic `"Invalid dummy username or password"` toast | **Correct** |
| 8 | Valid password | Yes | Yes | Yes, `200` | Yes | Yes | See #2 | — | — | — | — | Correct |
| 9 | Frozen account (`testfreshdummy`, pre-activation) | Yes | Yes | Yes, `403` | **No**, correctly rejected | No | N/A | N/A | N/A | No | Stays on `/auth?mode=login`, `"This dummy account is not active"` toast | **Correct** |
| 10 | Newly created dummy account | — | — | — | — | — | — | — | — | — | — | See §8 — created frozen by design, correctly blocked until admin activation, then signs in successfully |
| 11 | Logout then login again | — | — | — | — | — | — | — | — | — | — | See §9 — re-login after logout succeeds normally |

## 6. Exact First Failure Point, If Any

**No application-level failure point exists.** Every mode that could be tested behaved exactly as the code specifies. The one observable "failure" (mode #2/#3/#4/#5 not landing on the target dashboard through pure, unaided browser interaction) traces to a single, deterministic, non-application point: the browser's cookie store rejecting the session cookie because it lacks `Secure` while carrying `SameSite=None`. This is category **H (development-environment/browser transport limitation)**, confirmed and isolated in detail in §7 and in the prior forensic report, and re-confirmed independently in this investigation without relying on that report's conclusions.

## 7. Frozen-Account Findings

Directly investigated live, through the real `admin.createDummyUser` and `admin.setDummyUserActive` APIs (not just source reading):

- **What status newly created dummy users receive:** `accountStatus: 'frozen'`, `deactivatedAt` set to the creation timestamp, `frozenReason: 'Dummy/test accounts are disabled by default'` — confirmed live: creating `testfreshdummy` via the real API immediately produced this exact state in the database.
- **Whether frozen users are allowed to authenticate:** No — `signInDummy` explicitly checks `if (target.accountStatus !== 'active' || target.deactivatedAt) throw FORBIDDEN`. Confirmed live: signing in as `testfreshdummy` before activation returned `403 FORBIDDEN — "This dummy account is not active"`.
- **Whether the login UI communicates the frozen state correctly:** Yes. `AuthPage.tsx`'s `signInDummy.onError` shows `toast.error(error.message)`, which surfaces the exact, specific, human-readable message above — not a generic or silent failure.
- **Whether an administrator must explicitly activate a dummy account:** Yes, confirmed live via `admin.setDummyUserActive({userId, active: true})`, after which the identical account signed in successfully (`200`, correct role/onboarding data).
- **Whether this is intentional or a defect:** **Intentional.** Three independent pieces of evidence converge: (1) the `frozenReason` string itself reads as a deliberate default-state description, not an error; (2) a dedicated, purpose-built `setDummyUserActive` toggle mutation exists specifically to flip this state, with its own audit-log actions (`dummy_user_activated`/`dummy_user_deactivated`); (3) `client/src/pages/AdminDashboard.tsx`'s dummy-user creation dialog explicitly displays, at creation time, "This account is marked as test data, disabled by default, and excluded from business metrics" (English) / the equivalent Arabic string — and every dummy user row in the admin table carries a visible "Activate"/"Deactivate" button plus a "Frozen" status badge. This is a complete, correctly-implemented, correctly-communicated safety feature, not an oversight.
- **Whether existing test accounts and real dummy accounts behave differently:** Yes, and this explains an apparent inconsistency worth recording: this session's own previously-seeded accounts (`testvendor`, `testhomeowner`, etc., inserted directly via SQL in earlier phases for QA convenience) were never routed through `createDummyUser`, so they never received the frozen-by-default treatment and have always been immediately usable — unlike any dummy account a real admin creates through the actual product UI, which starts frozen until explicitly activated. This is a very plausible, alternative, mundane explanation for an "I created a test account and it won't sign in" report that has nothing to do with any password-length UI condition.

## 8. Session/Cookie Findings

- `getSessionCookieOptions()` (`server/_core/cookies.ts`) sets `sameSite: 'none'` unconditionally and `secure: isSecureRequest(req)`, which is `false` whenever the request arrives over plain HTTP with no `x-forwarded-proto: https`. Confirmed live via `curl -i`: `Set-Cookie: app_session_id=...; Path=/; HttpOnly; SameSite=None` — no `Secure`.
- This function is shared, byte-for-byte identical, by **both** the dummy sign-in path (`routers.ts`) and the real OAuth callback (`server/_core/oauth.ts`) — it is not specific to test accounts. In this sandbox (which has no working OAuth provider to test against at all — see §21), a real OAuth login's cookie issuance would hit the identical condition, since it too runs over this same sandbox's plain HTTP. This matters: the transport limitation is a property of *this deployment environment* (HTTP), not of *the dummy-login feature* — in a real HTTPS-terminated production deployment, `isSecureRequest()` already correctly special-cases `x-forwarded-proto: https` for exactly that case, and the cookie would set normally for every login path alike.
- Isolated the rest of the chain by compensating only for that one transport point (seeding the browser's cookie jar with a real, legitimately-issued token obtained from a real `signInDummy` call, then loading a neutral entry point and letting the app's own logic run untouched): `auth.me` correctly returns the full authenticated user, and navigation correctly completes to the right destination for every account type tested (contractor, homeowner, admin, unapproved-engineer). The chain itself is sound.
- **Logout does not server-side invalidate the session token.** Directly reproduced: after calling `auth.logout` (which only calls `res.clearCookie(...)` — a client-side instruction, nothing server-side), a request replayed with the *same, already-logged-out* cookie value still returned the full authenticated user via `auth.me`. This is a structural property of this stateless-JWT design (`sdk.createSessionToken`/`verifySession`, no server-side revocation list), not something introduced or affected by anything in this investigation's scope. It is unrelated to the reported "login doesn't work" symptom (if anything, it means sessions are *too persistent*, not that logins fail), but it is a real, session-security-relevant finding surfaced directly by Objective 1's required trace through "session cookie," and is flagged here for the record — **not fixed, as it is unrelated to this task's scope and would require an authentication-architecture decision (e.g. a revocation list or short-lived tokens) that this task's rules explicitly reserve for when "the investigation proves it is necessary," which it has not, for the login button problem specifically.**

## 9. `auth.me` Findings

- `authRouter.me` is `publicProcedure.query(opts => opts.ctx.user)` — it returns the **entire, unfiltered** `users` row for the authenticated caller, with no column allowlist. Confirmed live: a real `auth.me` response for a signed-in account included `passwordHash` (the scrypt hash) and `invitationToken`-related fields verbatim in the JSON payload sent to the client.
- This is a genuine, separate, real pre-existing security concern — sending a user's own password hash (and, for admin-invited accounts, their invitation token) to the client on every authenticated page load is unnecessary exposure and bad practice, independent of whether the hash itself is difficult to reverse. **This is flagged clearly for the record and is explicitly not fixed here** — it is unrelated to why the login button/flow was reported as not working, fixing it would mean touching `authRouter.me`'s shape (and every client `useAuth()` consumer's assumptions about what fields exist on `user`), which is exactly the kind of "unrelated functionality" and "authentication architecture" change this task's rules reserve for a dedicated, separately-scoped remediation, not a login-button investigation.
- Functionally, `auth.me` behaves correctly for its actual purpose: given a valid, browser-retained cookie, it reliably returns the correct account's data (verified across contractor/homeowner/admin accounts), and reliably returns `null` when no valid cookie is present (verified for the pure-browser, cookie-dropped case in §5).

## 10. Role Detection Findings

- `RolePlatform.tsx`'s own pre-existing routing effect (unmodified by this or any prior phase in scope here) correctly distinguishes `rawRole` (profession, `userRole` column) from `accountRole` (privilege, `role` column), and correctly redirects admins to `/admin`, unapproved compliance-role accounts to `/compliance`, and role/URL mismatches back to the caller's own platform path. All three conditions were independently re-verified live in this investigation (admin → `/admin`; `testunapproved` → `/compliance`; homeowner stays on `/platform/homeowner`).
- `AuthPage.tsx`'s own post-login `navigate()` calls (both in `signInDummy.onSuccess` and in its "already authenticated" effect) compute their destination using `getRolePlatformPath(userRole)` — the **profession** field only, never the **privilege** (`role`) field. `getRolePlatformPath` itself does check for `role === 'admin'`, but nothing in `AuthPage.tsx` ever calls it with `role`, only with `userRole`. Net effect, observed live: an admin account whose `userRole` happens to be a non-admin profession value (as `testadmin`'s is, `'homeowner'`) first navigates to `/platform/homeowner`, then is caught and correctly redirected to `/admin` by `RolePlatform.tsx`'s own separate, correct check within the same render cycle (milliseconds, confirmed via captured navigation sequence: `/auth` → `/platform/homeowner` → `/admin`). **This is a real, reproducible, minor structural inefficiency** (an avoidable extra client-side hop), but it is not a failure — the correct final destination is always reached, and it is not the reported symptom (a non-functional button). Per this task's explicit "do not make speculative fixes" and "do not modify unrelated functionality" rules, this was not changed; it is documented here as an observation, not treated as the root cause under investigation.

## 11. Navigation Findings

Covered in detail across §5/§10. Summary: `navigate()` is always called with the correct arguments for the account's actual state; the only place navigation doesn't complete as a real user would see it is the pure-browser cookie-transport case (§8), which is not a navigation defect — it's a downstream consequence of `auth.me` correctly returning `null` because no cookie ever arrived.

## 12. Previous Manus Fix Assessment

Inspected `4fcb464` (via `archive/manus-login-fix-4fcb464`) strictly for forensic comparison, per instruction — not restored, not copied, `storageProxy.test.ts` not touched.

**Why removing `dummyPassword.length < 8` did not solve the real issue:** because it was never blocking the real issue in the first place. This investigation's own live testing (§5, mode #7) confirms the button correctly enables for any password ≥8 characters (the only length any real dummy account can ever have — `min(8)` is enforced server-side on every account-creation and password-change path, unchanged in this investigation). The actual, reproducible problems found in this investigation — the sandbox-only cookie-transport limitation (§8) and the frozen-by-default new-dummy-account workflow (§7) — are both entirely unrelated to a client-side password-length check on a button's `disabled` attribute. No plausible version of that specific change could have addressed either.

## 13. Security Regression Assessment

No code was changed in this investigation, so there is no regression to assess in the traditional sense — but the investigation itself was conducted with these guarantees actively re-verified, live, in addition to reading the source:

- **Password hashing (scrypt) / timing-safe comparison:** untouched; directly exercised (not just read) via the invalid-password test (§5 #7), which failed exactly as scrypt+`timingSafeEqual` verification should.
- **Session security / role authorization / `adminProcedure` / `protectedProcedure` / `approvedProviderProcedure`:** untouched; `adminProcedure`'s gate was directly exercised by `testadmin` successfully reaching `/admin` and the real `admin.createDummyUser`/`admin.setDummyUserActive` calls succeeding only because that account genuinely has `role: 'admin'`.
- **Frozen-account authorization:** directly exercised, live, both directions (blocked while frozen, allowed after activation) — confirmed working correctly, not weakened, not changed.
- **`server/storageProxy.test.ts`:** not touched by this investigation at all, per explicit instruction; still in its original, strict, already-recovered state from the git recovery in Phase 4A.6.4's aftermath.
- **No hardcoded credentials, no client-side-only authentication, no authorization bypass** were introduced — no code changes occurred.

## 14. Code Changes, If Any

**None.** No genuine, reproducible application defect was found in the login button/flow itself.

## 15. Regression Tests Added, If Any

**None.** No code changed, so no regression tests were required or added, per this task's own instruction ("If no genuine defect can be reproduced: DO NOT CHANGE CODE... document the evidence").

## 16. Full Test Result

```
 Test Files  29 passed (29)
      Tests  286 passed (286)
```
(Identical to the Phase 4A.6.4 baseline, since this branch carries no code changes.)

## 17. TypeScript Result

```
$ npx tsc --noEmit
(no output — 0 errors)
```

## 18. Frontend Build Result

```
$ vite build
✓ built in 26.57s
```

## 19. Server Build Result

```
$ esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
dist/index.js  148.4kb
```

## 20. Browser Verification Evidence

- **Admin login**, real browser, real session (cookie-transport limitation compensated for exactly as described in §8 — no route interception, no navigation manipulation): captured full navigation sequence `/auth` → `/platform/homeowner` → `/admin`, final URL `/admin`, screenshot shows the real, live Admin Control Panel with real seeded user data (7 users, correct group counts, correct status badges) — sent to the user in this session.
- **Homeowner login:** final URL `/platform/homeowner`, confirmed correct.
- **Unapproved-engineer login:** final URL `/compliance`, confirmed correct — never reaches the platform.
- **Frozen-account workflow:** verified via real HTTP API calls (not browser UI clicks, since this is an admin-table-button-driven workflow already covered by existing admin UI code, not part of the login page itself) — creation → blocked sign-in (`403`) → real admin activation → successful sign-in (`200`), all against the live server and live database.
- **Invalid password:** verified via real HTTP call, correct `401` and clean, non-leaking error message.

## 21. Known Environment Limitations

1. **Real OAuth ("normal user") login cannot be end-to-end tested in this sandbox.** `OAUTH_SERVER_URL` is not configured (confirmed via the dev server's own startup log: `[OAuth] ERROR: OAUTH_SERVER_URL is not configured!`), so `startLogin()`'s target portal is unreachable. This is a pre-existing sandbox constraint, not a defect — the OAuth callback code path was read and traced directly (§3), shares the identical session-issuance and cookie logic already proven correct for the dummy path, and there is no code-level reason to expect it to behave differently.
2. **Pure, unaided browser interaction cannot complete any login in this sandbox** (dummy or, structurally, real) due to the `SameSite=None`-without-`Secure` cookie being rejected by Chrome over this sandbox's plain HTTP — confirmed deterministic, confirmed identical for the OAuth cookie-issuance code path, confirmed absent once compensated for by seeding a legitimately-issued token. This does not occur in a real HTTPS-terminated production deployment, for either login path.
3. Sessions are not server-side revocable (§8) — a pre-existing architectural property, not evaluated for change in this investigation.
4. `auth.me` returns unfiltered user rows including `passwordHash` (§9) — a pre-existing exposure, not evaluated for change in this investigation.

## 22. Final Recommendation

No genuine, reproducible application defect was found anywhere in the login button, the sign-in flow, session issuance, role detection, or navigation logic. Every failure mode this investigation could reproduce (invalid password, frozen account) behaved correctly, with clear and specific user-facing error messages. The one condition under which login does not visibly complete in this sandbox — the cookie-transport limitation — was proven, independently of the prior forensic report's conclusions, to be a property of this environment's plain-HTTP configuration rather than of the application, and to affect the real-user OAuth path identically in principle (not just the dummy path).

Two genuine, real, but entirely unrelated security-relevant conditions were surfaced as a byproduct of this investigation's required trace through session/cookie/`auth.me` handling (§8, §9) and are recorded here for the owner's attention as candidates for a dedicated, separately-scoped hardening phase — they were not created or worsened by this investigation, and fixing either would constitute exactly the kind of "unrelated functionality" or "authentication architecture" change this task's rules reserve for a proven-necessary case, which the reported login problem does not establish.

---

## Final Status

**LOGIN VERIFIED — NO APPLICATION DEFECT FOUND**
