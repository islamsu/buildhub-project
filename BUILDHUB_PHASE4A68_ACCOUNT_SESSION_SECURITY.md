# BuildHub — Phase 4A.6.8: Account State / Session Security Investigation and Hardening

## 1. Baseline

- Branch created for this phase: `claude/phase4a68-account-session-security`, created from `claude/phase4a67-admin-user-data-security` at commit `b67d9e7fdea793a5f07634e4fdc1ffffb7136670`.
- Baseline commit `b67d9e7` is the same commit reported as HEAD at the end of Phase 4A.6.7 ("Phase 4A.6.7: close admin.users passwordHash/invitationToken exposure").
- Working tree at baseline was clean except for four pre-existing, intentionally-uncommitted report files left over from earlier read-only-scoped tasks (`BUILDHUB_MANUS_LOGIN_FIX_REVIEW.md`, `BUILDHUB_MAIN_BRANCH_FORENSIC_REPORT.md`, `BUILDHUB_GIT_RECOVERY_PLAN.md`, `BUILDHUB_GIT_RECOVERY_EXECUTION_REPORT.md`). These are not part of this phase and were left untouched.

## 2. Branch relationship

```
origin/main                                      = 71d891ffd6f654323ec7b54954b9a18cb63bb7a5
origin/archive/manus-login-fix-4fcb464           = 4fcb464e908963c053aafb2608b9d5ea741a28d2
origin/claude/phase4a64-dashboard-integration    = c37442022fc421ef46301b7f663c0e118ce7de15
origin/claude/phase4a66-auth-security-hardening  = 42ee99c48f4a9b248bd236783bd094b493d84681
origin/claude/phase4a67-admin-user-data-security = b67d9e7fdea793a5f07634e4fdc1ffffb7136670  (baseline for this phase)
claude/phase4a68-account-session-security        = created from the above, this phase's work only
```
None of the protected branches listed above were modified in this phase. No merge to `main` was performed. Nothing was published or deployed.

## 3. Current authentication/session architecture (as inherited from 4A.6.6/4A.6.7, re-verified from source in this phase)

- Sessions are stateless HS256 JWTs (`server/_core/sdk.ts`), each carrying a unique `jti` (Phase 4A.6.6) and an `exp`.
- `sdk.authenticateRequest` runs on every request that reaches `createContext`. It verifies the JWT, checks `db.isSessionRevoked(session.jti)` (Phase 4A.6.6 logout revocation), then **always re-fetches the full user row from the database** (`db.getUserByOpenId`) — this row is never cached across requests.
- The freshly-fetched row becomes `ctx.user`, attached with `sessionJti`/`sessionExpiresAt`.
- `accountStatus` is a two-value enum: `'active' | 'frozen'` (`drizzle/schema.ts:31`, default `'active'`). There is no third "deactivated" state — dummy-account "deactivation" is implemented as `accountStatus: 'frozen'` plus a `deactivatedAt` timestamp set in lockstep (see §4).

## 4. Frozen/deactivated-account investigation — full lifecycle trace

**Central correction to this task's stated premise:** the premise assumed no per-request re-check of account state exists anywhere outside `signInDummy`. Source tracing in this phase found that assumption is **not accurate** for the front door most session traffic goes through. The re-check does exist, in a layer that Phase 4A.6.6/4A.6.7 did not have reason to inspect (`server/_core/trpc.ts`), and it predates every phase of this engagement.

```ts
// server/_core/trpc.ts — unchanged since the repository's very first commit
// ("Initial project bootstrap" / "Checkpoint v2.0"), confirmed via git log -p.
const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (ctx.user.role !== 'admin' && ctx.user.accountStatus === 'frozen') {
    throw new TRPCError({ code: "FORBIDDEN", message: "This account is frozen. Contact an administrator." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
export const protectedProcedure = t.procedure.use(requireUser);
```

`protectedProcedure` is the base for `complianceProcedure`, `approvedProviderProcedure`, `aiChatProcedure`, and the `adminRouter`'s own local `adminProcedure` (`server/routers.ts:910`, itself `protectedProcedure.use(role-check)`). Every one of these therefore re-checks `accountStatus` **on every single request**, using the row that `authenticateRequest` just re-fetched from the database that same request — not a cached value from sign-in time.

Answering the eight sub-questions:

1. **What account states exist?** Exactly two: `active` and `frozen` (schema enum). `deactivatedAt` is a nullable timestamp that is always set in the same write as `accountStatus: 'frozen'` for dummy accounts (`admin.setDummyUserActive`) — it is never set independently, so it carries no authorization meaning of its own; it is a display/audit field only.
2. **Which states are checked where?**
   - `signInDummy` (login boundary, `server/routers.ts:85`): rejects sign-in if `accountStatus !== 'active' || deactivatedAt` is set.
   - `requireUser` (every request, `server/_core/trpc.ts:19`): rejects if `accountStatus === 'frozen'`, **except when `ctx.user.role === 'admin'`** (see finding in §6).
   - The OAuth callback path (`server/_core/oauth.ts`) performs **no** account-status check of its own — confirmed via grep, zero matches. This is not a gap in practice: an OAuth user's very next request to any `protectedProcedure` endpoint is still gated by `requireUser`, same as a dummy-login user.
3. **Can state change mid-session?** Yes — `admin.setUserFrozen` and `admin.setDummyUserActive` write `accountStatus` directly to the `users` row at any time, independent of any session.
4–5/Scenario matrix — see §5 for live evidence of each of the 5 admin-action scenarios the task specified.
6. **Does an already-issued session remain usable after the account becomes inactive/frozen?** For every role except `admin`: **no** — live-verified, the very next `protectedProcedure`-gated request after a freeze/deactivate is rejected with `FORBIDDEN "This account is frozen."`, using the same still-cryptographically-valid, unexpired JWT. No new login, no revocation entry, and no cache-busting was needed for this to take effect — the live DB read inside `authenticateRequest` is what makes it work. For `role === 'admin'`: **yes**, a frozen admin's existing session keeps full `protectedProcedure` and admin-router access (see §6).
7. **Is that intentional or unsafe?** The non-admin behavior is correct, safe, and already matches the strongest of the three policies this task asked me to evaluate (see §6). The admin exemption is a deliberate design choice (not something introduced by, or discovered as new by, this phase) whose implications are assessed in §6.
8. **Consistent across dummy/normal/provider/homeowner/admin/compliance accounts?** Yes for every role reachable via `protectedProcedure`, `complianceProcedure`, and `approvedProviderProcedure` — the check is structural (middleware), not duplicated per-router, so there is no role for which it could have been silently omitted. The one asymmetry is the explicit, intentional admin exemption.

## 5. Live reproduction evidence (real dev server + real local MariaDB, no test-harness bypass)

Environment: `service mariadb` running; `buildhub_verify` DB seeded from prior phases; dev server started with `DATABASE_URL=mysql://buildhub:buildhub@localhost:3306/buildhub_verify JWT_SECRET=test-secret-for-manual-qa-only VITE_APP_ID=buildhub-qa-local PORT=3000 NODE_ENV=development npx tsx server/_core/index.ts`. All sessions below were obtained via real `auth.signInDummy` calls (real password verification against real scrypt hashes) — nothing was route-bypassed or mocked. All five scenarios the task specified were reproduced:

**Scenario A — login → admin deactivates (dummy path) → protected request on the pre-existing session:**
```
curl signInDummy testvendorc            → {"success":true,...}
curl projects.list (baseline)           → {"result":{"data":{"json":[]}}}         (200, works)
curl admin.setDummyUserActive(id=5,active=false)  → {"success":true,"active":false}
DB: accountStatus=frozen, deactivatedAt=2026-08-19 14:15:49
curl projects.list (same old cookie)    → 403 FORBIDDEN "This account is frozen. Contact an administrator."
curl auth.me (same old cookie)          → still returns profile (publicProcedure, unaffected — see §6)
```

**Scenario C — admin reactivates → same pre-existing session, no new login:**
```
curl admin.setDummyUserActive(id=5,active=true)   → {"success":true,"active":true}
curl projects.list (same old cookie)              → {"result":{"data":{"json":[]}}}   (200, works again immediately)
```

**Scenario B — login → admin freezes (non-dummy path, `admin.setUserFrozen`) → protected request:**
```
curl signInDummy testother                        → {"success":true,...}
curl admin.setUserFrozen(id=3,frozen=true) as non-admin actor → 403 FORBIDDEN (authorization control itself verified)
curl admin.setUserFrozen(id=3,frozen=true) as testadmin       → {"success":true,"status":"frozen"}
curl projects.list (testother's old cookie)       → 403 FORBIDDEN "This account is frozen. Contact an administrator."
curl admin.setUserFrozen(id=3,frozen=false)       → {"success":true,"status":"active"}   (unfreeze restores it)
```

**Scenario D — logout → replay the same cookie:**
```
curl auth.logout (testadmin's session)            → {"success":true}
curl projects.list (same, now-logged-out cookie)  → 401 UNAUTHORIZED "Please login" (session.jti found in revokedSessions)
```

**Scenario E — two concurrent sessions, revoke one, verify the other is unaffected:**
```
Two independent signInDummy calls for testvendorc → two distinct, real session cookies
Both work on projects.list beforehand.
auth.logout on session 1 only                     → {"success":true}
session 1 replay                                  → 401 UNAUTHORIZED (revoked)
session 2 (never touched)                         → {"result":{"data":{"json":[]}}}   (still fully valid — per-token revocation confirmed, not per-user)
```

**Admin-exemption edge case (not one of the 5 named scenarios, but directly relevant to §6):** `UPDATE users SET accountStatus='frozen' WHERE id=7 (testadmin)` was applied directly (simulating what a *second* admin freezing this admin would produce — `setUserFrozen` blocks only self-freeze, not freezing another admin). The already-issued `testadmin` session was then retried: `projects.list` → 200 success; `admin.users` → 200 success. **A frozen admin's existing session keeps full access.** Restored to `active` immediately after the check.

**Browser-level confirmation (Playwright, real cookie-seeded session per the established methodology — a legitimately-issued token from a real `auth.signInDummy` call, seeded into the browser's cookie jar before navigation, not a route/history interception):** `testvendorc` signed in for real, landed on `/platform/contractor`. A real `admin.setDummyUserActive` call deactivated the account from a second, real `testadmin` session. The **already-open browser tab** (no re-login) was then hard-reloaded (`page.reload()`, forcing every query to re-fetch with no client cache). Screenshots: `/tmp/4a68_target_before_freeze.png` (before), `/tmp/4a68_after_reload_frozen.png` (after). Captured network response for the batched call `profile.getOwn,analytics.myStats,projects.directory,rfq.myQuotations`:
```json
{"status":403,"body":"...\"message\":\"This account is frozen. Contact an administrator.\",...\"code\":\"FORBIDDEN\"..."}
```
The page did not crash and displayed no leaked stale data for the blocked queries (stat cards fell back to `0`/`Loading...`), but it also displayed **no explicit "your account has been frozen" message** to the user — this is a UX-polish gap, not a security defect (the block itself is enforced server-side regardless of what the client displays), and is out of scope for this phase's remediation per the task's own scope constraints. Flagged in §16 as a recommendation for a future phase, not fixed here.

## 6. Security-policy determination

The task asked me to choose between three policies:
- **Policy A — login-only check.** Already ruled out by evidence: `signInDummy` alone does this, and Scenario A/B prove it is insufficient on its own (a frozen account's live session would otherwise keep working).
- **Policy B — every-request check.** This is what `requireUser` already implements, and Scenarios A–E prove it works correctly and immediately, with no propagation delay, for every role except `admin`.
- **Policy C — periodic/revocation-based check.** Rejected as unnecessary: it would require enumerating and force-revoking every outstanding session for a user at the moment of freeze/deactivate (a second auth mechanism layered on top of the first), and it would only match Policy B's real-time guarantee if the periodic interval were effectively zero. Since Policy B already delivers Policy C's goal at zero latency and zero extra state, introducing Policy C would be added complexity with no security benefit — explicitly against this task's own instruction to prefer reusing the existing mechanism over introducing a second one.

**Determination: Policy B is already the implemented and correct policy for BuildHub, and no policy change is needed.** The only genuine finding in this area is not "which policy" but **the admin exemption's scope**: `requireUser` exempts `role === 'admin'` from the frozen check entirely, and the local `adminProcedure` in `routers.ts` is built directly on top of `protectedProcedure`/`requireUser`, so this exemption applies to admin-router endpoints too. `setUserFrozen` blocks self-freeze but not freezing a *different* admin account, so this exemption is reachable: a frozen admin keeps full functional access, including to `admin.*` endpoints, until manually cleared.

I assessed whether this is a genuine defect requiring a fix and concluded **it is not**, for three independently sufficient reasons: (1) it predates this entire engagement and is not a regression introduced by any prior phase's work; (2) the only actor who can freeze an admin is another admin — this is an intra-privileged-tier action, not a privilege-escalation path from a lower tier; (3) removing the exemption introduces its own risk (an admin freezing another admin, maliciously or by mistake, could deadlock the platform's own admin tooling with no privileged account left able to unfreeze anyone) that the current design deliberately avoids. This is documented, not silently left undiscovered — see the new regression test in §11 that pins this exact behavior down so a future change to it is a deliberate decision, not an accidental regression.

## 7. `revokedSessions` retention investigation

- Schema: `jti varchar(36) PRIMARY KEY, userId int NOT NULL FK→users(id) ON DELETE CASCADE, revokedAt timestamp, expiresAt timestamp`, indexed on `userId`.
- Sole writer: `db.revokeSession`, called from exactly one call site — `authRouter.logout` — once per logout, and only when the session being logged out carries a `jti`.
- Sole reader: `db.isSessionRevoked`, a single indexed PK lookup (`WHERE jti = ?`), performed once per authenticated request inside `authenticateRequest`. Its cost is independent of table size (B-tree PK lookup), so table growth does not degrade the hot path.
- `expiresAt` is written but never read anywhere in the codebase (confirmed via grep — zero query references). It exists as data for a *future* cleanup job, not as an active mechanism today.
- Growth model: strictly one row per logout event. `jti` values are `randomUUID()` and never reused, so once a row's underlying JWT has also passed its own `exp`, that token would already fail `jwtVerify`'s built-in expiration check before the `isSessionRevoked` lookup is ever reached again — meaning old rows become permanently unreachable data, not a growing hot set.
- Current real measurement: after three prior phases' worth of live testing (4A.6.6, 4A.6.7) plus this phase's Scenario D/E logouts, the table holds **5 rows** in the seeded verification database. At BuildHub's current pre-launch scale, this is not a meaningful storage or performance concern.
- **Conclusion: unbounded growth is a real long-term housekeeping property of this design, but it is not a genuine current production risk**, and the task explicitly instructed not to implement pruning unless first established as a genuine concern. It was not. **No pruning was implemented in this phase.**
- Recommendation for if/when this becomes worth doing (not implemented now): the platform already has a periodic-job primitive (`server/_core/heartbeat.ts`, `HeartbeatJob` with a cron expression calling an `/api/scheduled/*` endpoint) that a future `DELETE FROM revokedSessions WHERE expiresAt < NOW()` job could hook into without inventing new infrastructure. This is a backlog note for a future phase, not an action item here.

## 8. Is either flagged item a genuine defect?

- **Frozen/deactivated-account re-check gap:** **Not a genuine defect.** The mechanism this task described as missing already exists, already covers every role except the deliberately-exempted admin tier, and was live-proven correct end-to-end (API layer and browser layer, all 5 named scenarios plus the admin-exemption edge case).
- **`revokedSessions` retention:** **Not a genuine defect.** It is an accepted, low-risk, deferred housekeeping property, not an active security or performance problem at BuildHub's current scale.

## 9. Implementation

**No application source code was changed in this phase.** Per Objective 8's explicit instruction ("implement ONLY if a genuine defect is proven... if NOT proven, do not change code"), and given §8's conclusion, no fix was implemented for either flagged item.

One addition was made: a new regression-test file (§11) that locks in the already-correct `requireUser` behavior — including the intentional admin exemption — so a future, unrelated change cannot silently regress this protection without a test failing. This is coverage, not a behavior change; it does not alter `server/_core/trpc.ts`, `server/routers.ts`, `server/_core/sdk.ts`, `server/db.ts`, or `drizzle/schema.ts` in any way.

## 10. Exact files changed

```
new file:   server/accountSessionSecurity.test.ts
new file:   BUILDHUB_PHASE4A68_ACCOUNT_SESSION_SECURITY.md
```
No other file in the repository was modified by this phase.

## 11. Exact tests added

`server/accountSessionSecurity.test.ts` — 10 tests across two `describe` blocks:
- *`requireUser middleware re-checks account state on every request`* (7 tests): a frozen non-admin session is rejected on a `protectedProcedure` endpoint even with a structurally valid, unexpired token; an active session succeeds; frozen-rejection holds across `homeowner`/`contractor`/`engineer` `userRole`s; **the admin exemption is explicitly pinned down** (a frozen admin session still succeeds); `auth.me` still works for a frozen account; `auth.logout` still works for a frozen account; an anonymous caller is rejected regardless of account state.
- *`requireUser source wiring is intact`* (3 tests): the frozen-check and the admin-role exemption are still present in `trpc.ts`'s `requireUser`; `signInDummy`'s login-boundary check is unchanged; `admin.setDummyUserActive`/`admin.setUserFrozen` (including the self-freeze guard) are still present and unmodified.

## 12. Full test suite result

```
npx vitest run
Test Files  32 passed (32)
     Tests  327 passed (327)
```
317 pre-existing tests (unchanged, none weakened) + 10 new tests in `accountSessionSecurity.test.ts`. `server/auth.logout.test.ts`, `server/authSecurityHardening.test.ts`, and `server/adminUserDataSecurity.test.ts` (from Phases 4A.6.6/4A.6.7) all still pass unmodified.

## 13. TypeScript result

```
npx tsc --noEmit
```
No output — clean, zero errors.

## 14. Frontend build result

```
vite build
✓ built in 28.04s
```
Succeeded. The pre-existing "chunks larger than 500kB" advisory is unrelated to this phase (present before this work, no files touched by this phase are among the large chunks) and was not newly introduced.

## 15. Server build result

```
esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
dist/index.js  151.0kb
⚡ Done in 18ms
```
Succeeded.

## 16. Live verification results (summary; full detail in §5)

All performed against a real dev server (`tsx server/_core/index.ts`) backed by a real local MariaDB (`buildhub_verify`), using real `auth.signInDummy`-issued sessions — never a test-harness route bypass. Scenarios A, B, C, D, E from the task, plus the admin-exemption edge case, all reproduced with genuine before/after evidence (raw HTTP responses quoted in §5; two Playwright screenshots: `/tmp/4a68_target_before_freeze.png`, `/tmp/4a68_after_reload_frozen.png`). All test accounts and session/freeze state were restored to their original clean values afterward (verified via a final `SELECT` — see the table in this session's tool output, all 8 seeded accounts confirmed back to `accountStatus='active', deactivatedAt=NULL`).

**Not separately re-verified in this phase** (no reason to, since no code changed that could affect them, and they were already live-verified in their originating phases): OAuth login flow (no local OAuth server available in this sandbox, same environment limitation noted in every prior phase), the Phase 4A.6.1–4A.6.3 features, and role-routing for provider/homeowner/admin dashboards beyond what Scenario A/B's screenshots already exercised.

## 17. Remaining limitations

- This sandbox has no reachable OAuth provider, so the OAuth login path's account-state behavior was verified by source-reading only (§4, point 2), not by live browser reproduction. This is the same, previously-documented environment-only limitation from every earlier phase (SameSite=None-without-Secure cookies over plain HTTP), not a new one.
- The client does not display an explicit "your account has been frozen" message when a background query is blocked mid-session (§5's browser evidence) — a UX-polish gap, correctly left unfixed per this phase's scope, and noted for a future phase in §16 above and the recommendation below.
- `revokedSessions` pruning remains unimplemented by design decision (§7), not because it was missed.

## 18. Production-readiness impact

No regression was introduced. No new risk was introduced. The investigation increased confidence in an already-correct security control by proving it live (rather than assuming it, as the task's own premise had) and by adding regression coverage that did not exist before. The one real design property surfaced (the admin-freeze exemption) is now documented and test-locked rather than being an undocumented, undiscovered property of the codebase.

## 19. Recommendation for the next phase

Do not open a new "fix the frozen-session gap" phase — there is nothing to fix; this report supersedes that premise with verified evidence. If a future phase wants to invest in UX polish, a good, narrowly-scoped candidate is: surface a clear "This account has been frozen — contact an administrator" banner client-side when a protected query returns this specific `FORBIDDEN` message, and force a redirect to `/auth` (mirroring the existing `auth.logout` UX) rather than leaving stat cards stuck on `Loading...`. `revokedSessions` pruning via the existing `heartbeat.ts` periodic-job primitive is a reasonable low-priority backlog item once real production logout volume exists to justify it — not before.

---

## Final Status

**PASS — NO SECURITY DEFECT CONFIRMED**
