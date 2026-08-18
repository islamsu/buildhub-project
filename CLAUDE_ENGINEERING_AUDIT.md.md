# BuildHub — Senior Engineering Takeover Report
**Read-only architecture & security review — no code changed**
Repository: `github.com/islamsu/buildhub-project` @ `main`
Review date: August 18, 2026

---

## 0. How to read this report

Every finding is tagged with a category so architectural taste is never confused with an actual defect:

- **A — Actual security/functional defect** (real bug, exploitable or broken today)
- **B — Missing feature** (not built yet, not necessarily wrong)
- **C — Documentation discrepancy** (docs say X, code does Y)
- **D — Architectural recommendation** (would be nice, not a bug)
- **E — External configuration requirement** (code is fine, needs secrets/infra)

Severities: **CRITICAL** (data corruption / auth bypass / launch blocker) → **HIGH** → **MEDIUM** → **LOW**.

Verified by direct code read, `grep`/`ripgrep` across the full tree, and by actually running:
- `pnpm install` (clean)
- `npx vitest run` → **69/69 tests passed**, 18 files
- `npx tsc --noEmit` → **0 errors**
- `npx vite build` → succeeded (with a bundle-size warning, see §21)
- `npx esbuild server/_core/index.ts ...` (the server bundle step from `package.json`'s `build` script) → succeeded, `dist/index.js` 121.2kb

No database was available in this sandbox (`DATABASE_URL` unset), so all `getDb()`-backed runtime paths were verified by **static reading of the query/transaction code**, not by executing them against live data. This is called out wherever it matters.

---

## 1. Executive Summary

BuildHub is a real, substantial, largely well-organized monorepo (React 19 + tRPC 11 + Express 4 + Drizzle/MySQL). The stack claims in `BUILDHUB_BASELINE.md` are accurate. Tests pass, TypeScript is clean, the build succeeds. That is the good news, and it's genuine.

The bad news is more important: **the existing chain of "audit" documents in this repo (`PRODUCTION_AUDIT_REPORT.md`, `SECOND_PASS_AUDIT_REPORT.md`, `UNVERIFIED_ITEMS_REMEDIATION_REPORT.md`, `BUILDHUB_FINAL_BASELINE_REPORT.md`, `FINAL_LAUNCH_GATE_REPORT.md`) repeatedly assert security and payment properties that do not exist in the source code.** Specifically:

- Five separate prior "audit passes" state that Stripe checkout, webhook signature verification, and subscription handling are **"fully implemented in `server/routers.ts`."** A full-repository search for `stripe` (case-insensitive) returns **zero matches**. There is no Stripe code anywhere. This is not an "external configuration required" situation — the code itself was never written.
- Multiple reports specifically claim `acceptQuotationSecure` **"locks the RFQ row"** inside a database transaction. The actual function contains **no `db.transaction()` call and no row lock of any kind** — and, more importantly, **it is never called by the running application**. It's dead code, exercised only by its own unit test.
- The live code path that customers actually hit (`rfqRouter.acceptQuotation` / `rejectQuotation` in `server/routers.ts`) has a genuine **IDOR (broken object-level authorization)**: it can be used to accept or reject a quotation that doesn't belong to the RFQ being operated on, and has no transaction or re-check protecting against a double-award race.
- "Database integrity — PASS — Drizzle schema foreign keys & transactions" is asserted; the schema has **zero foreign key constraints** anywhere (confirmed against the raw `.sql` migrations, not just the Drizzle schema file).

None of this means BuildHub is a bad codebase — the underlying engineering (compliance gating, admin RBAC, OAuth CSRF handling, i18n key parity, password hashing) is frequently solid. It means **the paper trail cannot currently be trusted** and a real security pass was never actually performed on the areas it claims to have covered. Treat every prior "PASS" in those five documents as unverified until re-checked against source, which is what this report does.

**Launch readiness: NOT production ready**, independent of the documented "external configuration" items (Stripe keys, SendGrid, DB backups). There are CRITICAL authorization defects in code today that would need fixing regardless of what secrets get configured.

---

## 2. Actual Architecture (verified)

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Client (client/src)        │        │  Server (server/)              │
│  React 19 + Vite 7           │  tRPC  │  Express 4 on Node 22          │
│  wouter routing               │◄──────►│  tRPC 11 (superjson transform) │
│  @tanstack/react-query        │  /api/ │  server/routers.ts (1 file,    │
│  Tailwind v4 + Radix + Lucide │  trpc  │   1035 lines, all business     │
│  LanguageContext (en/ar, RTL) │        │   routers live here)           │
└─────────────────────────────┘        └──────────────┬─────────────────┘
                                                        │
                          ┌─────────────────────────────┼───────────────────────┐
                          │                              │                       │
                 ┌────────▼────────┐          ┌─────────▼─────────┐   ┌─────────▼─────────┐
                 │ MySQL / TiDB      │          │ Manus "Forge" proxy│   │ Manus OAuth server │
                 │ via drizzle-orm/  │          │ (server/_core/*)   │   │ (server/_core/oauth,│
                 │ mysql2            │          │ - storage (S3 PUT/  │   │  sdk.ts)            │
                 │ NO foreign keys   │          │   presign)          │   │ JWT session cookie   │
                 │ 2 unique indexes  │          │ - Google Maps proxy │   │ (jose, HS256)         │
                 │ only (users)      │          │   (unused in app)   │   └───────────────────────┘
                 └───────────────────┘          │ - LLM invoke proxy  │
                                                  │ - heartbeat/cron    │
                                                  │   registration      │
                                                  │   (unused in app)   │
                                                  │ - "notifyOwner"     │
                                                  │   (system-owner     │
                                                  │   alert, unrelated  │
                                                  │   to end-user       │
                                                  │   notifications)    │
                                                  └──────────────────────┘
```

**Confirmed stack:** React 19.2 + Vite 7, Tailwind CSS v4, Radix UI, Lucide icons, Express 4.21, tRPC 11.6, Drizzle ORM 0.44 + `mysql2` driver, TypeScript 5.9 strict, Vitest 2.1. All match `BUILDHUB_BASELINE.md`. **Category: C (confirmed accurate), not a finding.**

**No** Stripe, subscriptions table, payments table, SendGrid, or Twilio code exists anywhere. **No** CORS middleware, rate limiting, or CSRF-token middleware exists. **No** foreign keys or seed/backup tooling exist in-repo.

---

## 3. Repository Structure

```
client/src/          React SPA — pages/, components/, contexts/ (Language), hooks/, lib/, _core/ (auth hook)
server/              routers.ts (monolithic router file), db.ts, storage.ts, quotationWorkflow.ts (dead code),
                     rfqAttachments.ts, openaiIntegration.ts, *.test.ts (18 files, 69 tests)
server/_core/        Manus WebDev template infra: trpc.ts, context.ts, sdk.ts (OAuth+session), oauth.ts,
                     storageProxy.ts, env.ts, llm.ts, map.ts (unused), heartbeat.ts (unused), notification.ts
drizzle/             schema.ts (369 lines, 18 tables), relations.ts (EMPTY — `export {} from "./schema"`),
                     0000..0011 *.sql migrations, meta/ snapshots
shared/               const.ts, compliance.ts, projectFeatures.ts, _core/errors.ts
patches/              pnpm patch for `wouter@3.7.1`
*.md (root)           8 pre-existing planning/audit documents (see §16)
```

`drizzle/relations.ts` containing only `export {} from "./schema"` is itself a signal: Drizzle's relational-query API was scaffolded but never populated, consistent with the "no FKs, no defined relations" finding below.

**Category: C** for structure vs. baseline doc (accurate) — no discrepancy here.

---

## 4. Database Assessment

18 tables in `drizzle/schema.ts`: `users`, `userAccountAuditEvents`, `projects`, `milestones`, `tasks`, `documents`, `registrationDocuments`, `registrationDocumentSubmissions`, `registrationReviewEvents`, `productQuestions`, `products`, `rfqs`, `quotations`, `messages`, `notifications`, `reviews`, `progressReports`, `disputes`, `adminSettings`, `dailyLogs`, `expenses`.

### 4.1 No foreign keys anywhere — HIGH — Category A/D (borderline)
**FILE:** `drizzle/schema.ts`, all 12 migration `.sql` files
**CURRENT BEHAVIOR:** Every relationship (`rfqId`, `providerId`, `projectId`, `ownerId`, `userId`, etc.) is a plain `int` column with no `REFERENCES` clause. Confirmed by grepping every `.sql` migration for `FOREIGN KEY`/`REFERENCES` — zero hits. `drizzle/relations.ts` is empty.
**WHY IT'S A PROBLEM:** Referential integrity depends entirely on application code being correct on every write path, forever. Orphaned rows (e.g., a `quotation` pointing at a deleted `rfq`, a `milestone` pointing at a deleted `project`) are possible and will not be caught by the database.
**EXPLOIT/FAILURE SCENARIO:** `adminRouter.deleteDummyUser` does `db.delete(users)` with no cascade and no check for the user's projects/RFQs/quotations/messages/reviews — those rows become orphaned rather than being deleted or reassigned.
**RECOMMENDED FIX:** Add FK constraints (with explicit `ON DELETE` policy per table — mostly `RESTRICT` or `SET NULL`, never blind `CASCADE` for financial/audit tables) as a dedicated migration; add covering indexes on every FK-shaped column at the same time (see 4.2).
**PRODUCTION BLOCKER?** Not immediately (app currently "works" without them), but **should block scale-up** — this is a data-integrity time bomb, not a launch-day fire.
**Category: mostly D (architectural hardening), with an A-flavored edge** because it directly enables the orphaned-row failure mode above.

### 4.2 No indexes on any foreign-key-shaped column — MEDIUM — Category A (performance defect once data grows)
**FILE:** `drizzle/schema.ts`
**CURRENT BEHAVIOR:** The only indexes in the entire schema are `users_username_unique` and `users_email_unique`. Every other lookup (`quotations.rfqId`, `quotations.providerId`, `rfqs.requesterId`, `messages.senderId`/`receiverId`, `projects.ownerId`, `notifications.userId`, etc.) is an unindexed full-table scan.
**WHY IT'S A PROBLEM:** These are exactly the columns used in every `WHERE` clause across `routers.ts`. At low data volume this is invisible; it degrades badly as tables grow.
**EXPLOIT/FAILURE SCENARIO:** `messagesRouter.conversations` and `.list` scan all of `messages` on every page load; `rfqRouter.quotations` scans all `quotations` filtered by `rfqId`. No failure today, but a real scale risk.
**RECOMMENDED FIX:** Add indexes on all FK-shaped columns, and a composite index on `(rfqId, status)` for `quotations` given how central that lookup is to the core workflow.
**PRODUCTION BLOCKER?** No — performance risk, not a correctness risk.
**Category: D**, verging on A only past a certain data volume.

### 4.3 Quotation status enum doesn't match documented state machine — MEDIUM — Category C
**FILE:** `drizzle/schema.ts` line ~247
**CURRENT BEHAVIOR:** `quotations.status` enum is `['pending', 'accepted', 'rejected']` only.
**WHY IT'S A PROBLEM:** `BUILDHUB_BASELINE.md` explicitly documents `PENDING → WITHDRAWN` and `PENDING → EXPIRED` as valid transitions. Neither state exists in the schema, and no code anywhere sets or checks for them (confirmed: no `withdraw` mutation, no expiry job).
**RECOMMENDED FIX:** Either implement withdrawal/expiration (schema + endpoint + cron via the already-scaffolded-but-unused `server/_core/heartbeat.ts`), or correct the baseline doc to describe the actual 3-state machine.
**PRODUCTION BLOCKER?** No.
**Category: C** (documentation overstates the implementation) with a **B** component (withdrawal/expiration is simply not built).

### 4.4 `rfqs.deadline` has no enforcement — LOW — Category B
RFQs carry a `deadline` timestamp but nothing ever closes an RFQ automatically when it passes. Combined with 4.3, "expired" is a UI-only concept the schema and backend don't actually implement. **Category: B.**

---

## 5. Authentication Assessment

**FILES:** `server/_core/sdk.ts`, `server/_core/oauth.ts`, `server/_core/context.ts`, `server/_core/cookies.ts`, `client/src/const.ts`, `client/src/_core/hooks/useAuth.ts`

### 5.1 OAuth login flow — verified sound
`startLogin()` (client) mints a random `nonce` via `crypto.randomUUID()`, writes it to a short-lived (`Max-Age=600`) cookie, and embeds it in the `state` parameter sent to the OAuth portal. `registerOAuthRoutes` (`server/_core/oauth.ts`) compares the returned `state`'s nonce against the cookie value before proceeding, and rejects with 403 on mismatch. `returnTo` is validated to start with `/` and explicitly rejects `//` (open-redirect protection). This is a correct, deliberate CSRF-safe OAuth implementation. **No finding — positive.**

### 5.2 Session tokens — verified sound
JWT (`jose`, `HS256`), signed with `ENV.cookieSecret` (from `JWT_SECRET` env var), 1-year default expiry, `httpOnly: true`. `verifySession` checks algorithm allowlist (`algorithms: ["HS256"]`) and required-field presence. No token stored in `localStorage`; the cookie fallback header path (for Safari ITP / WebView) is deliberate and documented in code comments. **No finding — positive.**

### 5.3 `sameSite: 'none'` on the session cookie — MEDIUM — Category A/E (context-dependent)
**FILE:** `server/_core/cookies.ts`
**CURRENT BEHAVIOR:** `getSessionCookieOptions` always returns `sameSite: 'none'`, `secure: isSecureRequest(req)`.
**WHY IT'S A PROBLEM:** `SameSite=None` disables the browser's built-in CSRF mitigation for this cookie entirely. Combined with the complete absence of CSRF-token middleware or CORS restrictions anywhere in `server/_core/index.ts` (verified: no `cors()` call, no CSRF library in `package.json`), the app currently relies solely on the fact that tRPC's JSON `Content-Type` triggers a CORS preflight (which the browser will refuse to complete, since no `Access-Control-Allow-Origin` is ever sent) as its only cross-site defense.
**WHY IT'S LIKELY INTENTIONAL:** Code comments in `sdk.ts` reference "Preview auto-login via sessionStorage... browsers block iframe cookies (Safari ITP, private browsing, iOS/Android WebView)" — this strongly indicates the app is designed to run embedded in an iframe inside the Manus builder platform, which requires `SameSite=None`.
**EXPLOIT/FAILURE SCENARIO:** If the production deployment is *not* iframe-embedded, this is unnecessary CSRF-hardening loss. If a future change ever adds a `cors()` middleware with a permissive `origin: true`/wildcard-with-credentials configuration, the combination becomes a real cross-origin session-riding vulnerability.
**RECOMMENDED FIX:** Confirm whether production actually needs iframe embedding. If not, switch to `sameSite: 'lax'`. Either way, add explicit CSRF-token verification on state-changing tRPC mutations, and add an explicit (not default-open) CORS allowlist before any wildcard CORS is ever introduced.
**PRODUCTION BLOCKER?** No, given current absence of CORS — but flag as a landmine for whoever adds CORS later.
**Category: A** (weakness) softened by **E** (may be a deliberate platform requirement, not a bug — confirm with whoever controls the deployment target).

### 5.4 Password auth (dummy/admin-created users) — verified sound
`hashPassword`/`verifyPassword` in `routers.ts` use `scrypt` (Node's `crypto.scrypt`, salted, 64-byte derived key) with `timingSafeEqual` for comparison — this correctly avoids timing attacks. Dummy accounts default to `accountStatus: 'frozen'` and must be explicitly activated by an admin. **No finding — positive**, and matches CLAUDE_HANDOFF.md's dummy-user-isolation rule.

### 5.5 Invitation token flow — verified sound
`completeInvitation` checks token existence, expiry (7-day), and single-use (`invitationStatus === 'password_set'` rejection). Confirmed by `invitationAudit.test.ts` (4 passing tests) which specifically exercises the expired-token rejection path. **No finding — positive.**

---

## 6. Authorization Assessment

This is where the real problems are. tRPC's three procedure tiers (`publicProcedure`, `protectedProcedure`, `adminProcedure`) are used consistently and correctly **at the router level** — every admin route is genuinely behind `adminProcedure`, verified by reading every line of `adminRouter` (lines 669–1005 of `routers.ts`). The failures below are **object-level** (IDOR / BOLA) — a user is correctly authenticated and correctly has *some* legitimate access, but the endpoint fails to check that the specific object ID they supplied is one they're allowed to touch.

### 6.1 `rfqRouter.acceptQuotation` — CRITICAL — Category A
**FILE:** `server/routers.ts`, lines 540–553
**FUNCTION/ROUTE:** `rfq.acceptQuotation` (protectedProcedure mutation)
**CURRENT BEHAVIOR:**
```ts
const [rfq] = await db.select().from(rfqs).where(and(eq(rfqs.id, input.rfqId), eq(rfqs.requesterId, ctx.user.id)));
if (!rfq) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this RFQ' });
await db.update(quotations).set({ status: 'accepted' }).where(eq(quotations.id, input.quotationId));
await db.update(quotations).set({ status: 'rejected' }).where(and(eq(quotations.rfqId, input.rfqId), sql`id != ${input.quotationId}`));
await db.update(rfqs).set({ status: 'awarded' }).where(eq(rfqs.id, input.rfqId));
```
The ownership check only verifies the caller owns `input.rfqId`. The first `update` sets `quotations.status = 'accepted'` **by `quotationId` alone** — it never verifies `quotations.rfqId === input.rfqId`.
**WHY IT'S A PROBLEM:** Any authenticated customer who owns at least one RFQ can pass an arbitrary `quotationId` belonging to a completely unrelated RFQ (owned by a different customer) and flip its status to `'accepted'`.
**EXPLOIT/FAILURE SCENARIO:** Customer A owns RFQ #5 with quotation #10 pending. Customer B owns RFQ #99 (unrelated). Attacker (Customer B) calls `acceptQuotation({ quotationId: 10, rfqId: 99 })`. The ownership check passes (B owns RFQ #99). Quotation #10 (which belongs to RFQ #5, not #99) is silently marked `'accepted'` — corrupting Customer A's RFQ state without their knowledge, potentially locking a vendor into a "won" bid they never actually won, or blocking Customer A's real, legitimate acceptance flow later (their own `acceptQuotation` call on quotation #10 will now fail the "must be pending" check that doesn't even exist in this endpoint, or silently re-process). Simultaneously, all quotations under `rfqId: 99` (Customer B's own RFQ) that aren't ID `10` get rejected, and RFQ #99 gets marked awarded — with the "awarded" quotation being one that doesn't even belong to it.
**RECOMMENDED FIX:** Change the first update's `where` clause to `and(eq(quotations.id, input.quotationId), eq(quotations.rfqId, input.rfqId))`, and check `affectedRows === 1` (or re-`select` first and validate `quotation.rfqId === input.rfqId` and `quotation.status === 'pending'` before writing) before proceeding to the cascade updates. Wrap the whole thing in `db.transaction()` (see 6.3).
**PRODUCTION BLOCKER?** **YES.**
**Category: A.**

### 6.2 `rfqRouter.rejectQuotation` — CRITICAL — Category A
**FILE:** `server/routers.ts`, lines 554–563
**FUNCTION/ROUTE:** `rfq.rejectQuotation`
**CURRENT BEHAVIOR:** Identical pattern to 6.1 — `db.update(quotations).set({ status: 'rejected' }).where(eq(quotations.id, input.quotationId))` with no `rfqId` cross-check, gated only by "do you own `input.rfqId`."
**WHY IT'S A PROBLEM:** Same class of bug: any customer who owns any RFQ can reject **any quotation in the entire system** by ID, regardless of which RFQ it's actually attached to.
**EXPLOIT/FAILURE SCENARIO:** A malicious or careless customer sabotages a competitor's negotiation by rejecting a vendor's pending quotation on someone else's completely unrelated RFQ — the vendor loses a legitimate pending bid with no attacker footprint beyond a single API call.
**RECOMMENDED FIX:** Same as 6.1 — the `where` clause must include `eq(quotations.rfqId, input.rfqId)`.
**PRODUCTION BLOCKER?** **YES.**
**Category: A.**

### 6.3 Quotation acceptance has no transactional/concurrency protection in the live code path — CRITICAL — Category A
**FILE:** `server/routers.ts` (`acceptQuotation`), and separately `server/quotationWorkflow.ts` (`acceptQuotationSecure`, unused — see 6.4)
**CURRENT BEHAVIOR:** `acceptQuotation` performs three sequential, independent `await db.update(...)` calls with no `db.transaction()` wrapper, no `SELECT ... FOR UPDATE`, and — critically — **no re-check that `rfqs.status` is still `'open'`** before proceeding. It doesn't even check the target quotation is currently `'pending'`.
**WHY IT'S A PROBLEM:** This is a textbook time-of-check-to-time-of-use (TOCTOU) race. There is no atomicity between "read RFQ ownership," "write quotation A accepted," "write competing quotations rejected," and "write RFQ awarded."
**EXPLOIT/FAILURE SCENARIO:** Customer fires two near-simultaneous `acceptQuotation` calls for two different quotations under the same RFQ (e.g., double-clicking "Accept" on two vendor cards, or a scripted replay). Both requests read the RFQ as owned/valid before either write lands. Both proceed to mark their respective quotation `'accepted'`, and both mark the RFQ `'awarded'` — the last write wins for the RFQ's status, but **two quotations can end up simultaneously marked `'accepted'`**, directly contradicting the "Quotation Exclusivity" business rule in `CLAUDE_HANDOFF.md` ("Accepting a quotation automatically closes competing quotations"). This is exactly the scenario the documentation claims is prevented.
**RECOMMENDED FIX:** Wrap in `db.transaction(async (tx) => {...})`; inside the transaction, re-select the RFQ and target quotation with a lock (`FOR UPDATE`, if the MySQL driver/Drizzle version supports it in this context) and re-verify `rfq.status === 'open'` and `quotation.status === 'pending'` immediately before writing, aborting the transaction otherwise.
**PRODUCTION BLOCKER?** **YES.**
**Category: A.**

### 6.4 The documented "secure" function is dead code — CRITICAL (process/trust issue) — Category C
**FILE:** `server/quotationWorkflow.ts`
**CURRENT BEHAVIOR:** `acceptQuotationSecure(rfqId, quotationId, userId)` is a real, better function than the one actually in use — it re-verifies `rfq.status !== 'awarded'` and `quotation.status !== 'pending'` before writing. But `grep -rn "acceptQuotationSecure"` across the entire repository shows it is imported **only by its own test file** (`server/quotationWorkflow.test.ts`). It is never imported by `routers.ts`, never wired to any tRPC procedure, and therefore never executes in the running application.
**WHY IT'S A PROBLEM:** `CLAUDE_HANDOFF.md` explicitly instructs future engineers: *"Quotation State Machine & Concurrency (`server/quotationWorkflow.ts`): Altering `acceptQuotationSecure` transactions risks introducing double-acceptance race conditions."* This instruction is actively misleading — it directs attention and caution toward a function that has **zero effect on production behavior**, while the actual live, less-protected code path (`routers.ts`'s `acceptQuotation`) goes unmentioned and unprotected by the same handoff notes.
**EXPLOIT/FAILURE SCENARIO:** A future engineer (human or AI) reads the handoff notes, dutifully avoids touching `quotationWorkflow.ts`, and never discovers that the actual bug (6.1–6.3) lives in a completely different file that the notes never flagged as sensitive.
**RECOMMENDED FIX:** Either (a) delete `quotationWorkflow.ts` and its test as dead code, or (b) actually wire `acceptQuotationSecure` into `rfqRouter.acceptQuotation` (after fixing its own missing-transaction issue per 6.3), and delete the parallel unprotected logic currently in `routers.ts`. Do not leave two divergent implementations of the same business-critical operation in the codebase.
**PRODUCTION BLOCKER?** **YES** (as a consequence of 6.1–6.3; this finding itself is about documentation/process integrity).
**Category: C**, with direct causal contribution to the **A**-class defects above.

### 6.5 Systemic IDOR across the Projects module — CRITICAL — Category A
**FILE:** `server/routers.ts`, `projectsRouter`, lines 159–327
**FUNCTION/ROUTE:** `projects.milestones`, `projects.addMilestone`, `projects.tasks`, `projects.addTask`, `projects.updateTask`, `projects.expenses`, `projects.addExpense`, `projects.dailyLogs`, `projects.addDailyLog`
**CURRENT BEHAVIOR:** These nine endpoints take a `projectId` (or, for `updateTask`, just a task `id`) and perform their read/write with **no ownership check against `ctx.user.id` at all**:
```ts
milestones: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
  ...
  return db.select().from(milestones).where(eq(milestones.projectId, input.projectId)).orderBy(milestones.dueDate);
}),
updateTask: protectedProcedure.input(z.object({ id: z.number(), status: ..., title: ... })).mutation(async ({ ctx, input }) => {
  ...
  await db.update(tasks).set(data).where(eq(tasks.id, id));  // no ownership check whatsoever, not even projectId
  ...
}),
```
By contrast, the *sibling* endpoints on the exact same router — `projects.get`, `projects.update`, `projects.documents`, `projects.uploadDocument`, `projects.progressReports`, `projects.addProgressReport` — **do** correctly check `and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id))` before proceeding.
**WHY IT'S A PROBLEM:** This is not one missed check, it's a consistent pattern affecting roughly half the endpoints on the router. Any authenticated user (any role) can read another homeowner's private task list, milestone schedule, daily site logs, and — most sensitively — their project **expenses** (financial data), and can **write** to any of these: adding fake tasks/expenses/logs to a project they don't own, or (via `updateTask`) modifying/completing any task in the entire system by guessing/enumerating small sequential integer IDs.
**EXPLOIT/FAILURE SCENARIO:** A competing contractor enumerates `projectId` 1..N via `projects.expenses({ projectId: N })` to read every homeowner's project budget and spend-to-date across the platform — commercially sensitive data with no authorization check at all. Separately, any user can call `updateTask({ id: 1, status: 'done' })` and silently mark another user's task complete.
**RECOMMENDED FIX:** Add the same `and(eq(*.projectId, input.projectId), <project owned by ctx.user.id via a subquery or a pre-fetch check>)` pattern already used correctly elsewhere on this same router. For `updateTask`, join through `tasks.projectId → projects.ownerId` before allowing the update, since `updateTask` doesn't even receive a `projectId` today.
**PRODUCTION BLOCKER?** **YES.**
**Category: A.**

### 6.6 `projectsRouter.directory` over-exposes private financial fields — MEDIUM — Category A
**FILE:** `server/routers.ts`, line 165–172
**CURRENT BEHAVIOR:** `directory` (gated to approved providers) returns `db.select().from(projects)` — i.e., **every column**, including `budget` and `spent` — for the 50 most recently updated projects across the entire platform, with no field-level restriction.
**WHY IT'S A PROBLEM:** This may be an intentional "provider lead directory" feature, but returning a homeowner's exact budget and spend to any approved provider (not just ones they're engaged with) is a significant over-exposure of financial data, likely beyond what the product intends.
**EXPLOIT/FAILURE SCENARIO:** Any approved provider account (not necessarily one the homeowner has interacted with) can see the exact budget of every recent project on the platform — usable for competitive bidding manipulation (bidding just under a known budget ceiling).
**RECOMMENDED FIX:** Use an explicit column selection (`db.select({ id, title, type, location, status, updatedAt, ... })`) that excludes `budget`/`spent`, or gates those fields to providers actually engaged on that project.
**PRODUCTION BLOCKER?** Recommend fixing before launch, but it's a data-minimization issue, not a full authorization bypass.
**Category: A**, arguably also **D** if this level of exposure was actually an intended product decision — **needs a product-owner decision, not just an engineering one.**

### 6.7 `reviewsRouter.submit` doesn't verify reviewer/reviewee participation — MEDIUM/HIGH — Category A
**FILE:** `server/routers.ts`, lines 637–647
**CURRENT BEHAVIOR:**
```ts
const [project] = await db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.status, 'completed')));
if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'Reviews only allowed for completed projects' });
await db.insert(reviews).values({ ...input, reviewerId: ctx.user.id, verified: true });
```
It checks the project exists and is `'completed'` — it never checks that `ctx.user.id === project.ownerId`, nor that `input.revieweeId` was actually involved in that project.
**WHY IT'S A PROBLEM:** Reviews are inserted with `verified: true` unconditionally. `reviews.forUser` (public) only surfaces `verified: true` reviews, and `users.rating`/`reviewCount` presumably (not directly recomputed in the reviewed code, but implied by the schema) feed off verified reviews. Any authenticated user can rate **any other user** on **any completed project in the system**, not just their own.
**EXPLOIT/FAILURE SCENARIO:** A competitor of a contractor creates or uses any account, finds any `completed` project ID (these are guessable small integers, and `projects.get` — while ownership-gated for read — doesn't stop someone from knowing IDs exist), and posts a fabricated 1-star "verified" review against that contractor via an unrelated project ID, damaging their public rating with a review that displays as verified.
**RECOMMENDED FIX:** Require `ctx.user.id === project.ownerId` (or membership via an actual project-participants relation, which doesn't currently exist in the schema) before allowing the insert, and validate `revieweeId` actually participated (e.g., is the accepted quotation's `providerId` for that project's originating RFQ, if that link is later modeled).
**PRODUCTION BLOCKER?** **YES** — public-facing trust/rating integrity.
**Category: A.**

### 6.8 Admin routes — verified sound
Every mutation and query in `adminRouter` (lines 669–1005) is defined under the locally-declared `adminProcedure` (line 651: `protectedProcedure.use(({ ctx, next }) => { if (ctx.user.role !== 'admin') throw FORBIDDEN; ... })`). Read every route in the file; found no route in `adminRouter` that escapes this gate. `setUserFrozen` correctly blocks an admin from freezing their own account. **No finding — positive**, and matches the "verify admin functionality is protected server-side" requirement.

One structural oddity, **LOW / Category D**: `server/_core/trpc.ts` also exports its own, differently-implemented `adminProcedure` (used only by `server/_core/systemRouter.ts`), while `routers.ts` defines a second, separate `adminProcedure` shadowing the name locally. Both correctly check `role === 'admin'`, so there's no security gap — but having two independently-maintained implementations of the same guard is a maintainability smell; a future edit to one and not the other could silently diverge.

---

## 7. Customer Workflow (traced end-to-end)

Homeowner → `projects.create` (owned, `ownerId: ctx.user.id`) → optionally `rfq.create` (with `productReference` linking a marketplace product, or standalone) → `rfq.uploadAttachment` (validated MIME + size) → RFQ visible to providers via `rfq.list`/`rfq.get` (both effectively public/protected-read, **no filtering to the requester's own category/location** — any protected user can see any RFQ's full detail via `rfq.get`, which does not check requester identity at all: **LOW/Category A** — mild information disclosure of RFQ details including budget/location to any logged-in user, likely intentional for an open-bidding marketplace but worth confirming with product) → providers submit `rfq.submitQuotation` (gated `approvedProviderProcedure`) → customer views `rfq.quotations` (correctly public/protected within that flow) → customer calls `rfq.acceptQuotation` (**broken, see 6.1/6.3**) → project can later be marked `completed` via `projects.update` → `reviews.submit` (**broken, see 6.7**).

This traces cleanly except at the two authorization breakpoints already documented. **No additional customer-flow findings beyond what's already listed.**

---

## 8. Vendor/Provider Workflow (traced end-to-end)

Signup → `auth.updateRole` sets `userRole` to a provider role and forces `onboardingStatus: 'not_started'` for compliance roles (`isComplianceRole` check, `shared/compliance.ts`) → `compliance.uploadDocument` (gated `complianceProcedure`, validates document type against role requirements, PDF/image only, ≤10MB) → admin reviews via `admin.reviewComplianceDocument` → `getOverallComplianceStatus` recomputes aggregate status → once `onboardingStatus === 'approved'`, `approvedProviderProcedure`-gated routes unlock: `rfq.submitQuotation`, `marketplace.create` (products, supplier-only), `projects.directory` (see 6.6). This gating is implemented correctly and consistently — **verified positive**, matches CLAUDE_HANDOFF.md's "Compliance Gating" business rule.

One gap, **LOW/Category B**: there is no vendor-side "withdraw my quotation" endpoint, despite the baseline documenting `PENDING → WITHDRAWN` as a valid transition (ties to 4.3).

---

## 9. RFQ System

Covered in §7. Structurally sound (attachments, product references, category/budget/location/deadline fields all present and validated with Zod). The core defect is entirely in the acceptance/rejection mutations (§6.1–6.3), not in RFQ creation/listing itself.

---

## 10. Quotation State Machine

**Documented (BUILDHUB_BASELINE.md):** `PENDING → ACCEPTED`, `PENDING → REJECTED`, `PENDING → WITHDRAWN`, `PENDING → EXPIRED`, with atomic-transaction double-acceptance protection.

**Actual:**
- States in DB: `pending | accepted | rejected` only. No `withdrawn`, no `expired` (Category C/B, §4.3).
- Transitions enforced: **none are actually guarded against invalid re-transition** in the live `acceptQuotation`/`rejectQuotation` code — you can call `acceptQuotation` on a quotation that's already `rejected` and it will happily flip it back to `accepted` with no state-machine validation at all (no `status === 'pending'` check exists in the live path — only in the unused `acceptQuotationSecure`).
- **Can two competing quotations become accepted simultaneously?** **Yes**, as demonstrated in §6.3, via concurrent requests, and separately (not even needing concurrency) via the §6.1 IDOR, which can flip an unrelated RFQ's quotation to `'accepted'` regardless of that RFQ's own state.

This directly contradicts CLAUDE_HANDOFF.md's rule #2 ("Accepting a quotation automatically closes competing quotations") under concurrent load or malicious input, and is the single most important functional finding in this review.

---

## 11. Concurrency

Beyond the quotation workflow (§6.3), no other multi-step business operation in `routers.ts` uses `db.transaction()` — a global `grep` for `.transaction(` across `server/` returns **zero matches** anywhere in the application code (the only other "transaction" hit in the whole repo is the unrelated string `transactionFeePercent` admin setting default). Every multi-statement mutation in the file (e.g., `admin.reviewComplianceDocument`'s four sequential writes, `admin.bulkUpdateApplicantStatus`'s three) is a sequence of independent statements with no atomicity guarantee.

**Category: A** for the quotation path specifically (business-critical, exploitable). **Category D** for the rest (compliance-review multi-writes, etc.) — these are lower-stakes admin-only operations where a partial failure is an inconvenience, not a security/financial integrity issue, but the same fix pattern (wrap in `db.transaction()`) should be applied uniformly as a hardening pass.

---

## 12. Payments (Stripe / Subscriptions)

**FILE:** entire repository
**FINDING:** A full-repository, case-insensitive search for `stripe`, `subscription` (as implementation, not UI label), `payment` (as implementation), `webhook`, and `billing` was performed. Results:

| Term | Hits (implementation) |
|---|---|
| `stripe` | **0** |
| `subscription` (real logic) | **0** — only static UI label text in `ComponentShowcase.tsx` |
| `payment` (real logic) | **0** — only the string `payment` inside `paymentTerms` (a text field on `quotations`) and a UI label |
| webhook / `stripe.webhooks.constructEvent` | **0** |
| Subscription/payments DB table | **0** — no such tables in `drizzle/schema.ts` |

**CODE IMPLEMENTED:** Nothing.
**LIVE CONFIGURATION REQUIRED:** N/A — there is no code to configure.
**NOT VERIFIED:** N/A — this was fully verified as absent, not "unverified."

This directly, repeatedly, and specifically contradicts five prior audit documents in this same repository (see §16). **Category: C — and the most severe documentation-integrity finding in this review.**

---

## 13. Storage

**FILES:** `server/storage.ts`, `server/_core/storageProxy.ts`

**Upload path (`storagePut`):** Requests a presigned S3 PUT URL from the Manus "Forge" proxy, appends an 8-hex-char random suffix to the key, uploads directly to S3. Correctly requires `BUILT_IN_FORGE_API_URL`/`BUILT_IN_FORGE_API_KEY` and throws if missing. MIME/size validation happens **at the call site** (`rfqAttachments.ts`, inline checks in `routers.ts`), not inside `storage.ts` itself, and is based on the **client-declared `contentType`**, not server-side content sniffing of the actual bytes. **LOW/Category A**: a user could upload an HTML/SVG file while claiming `image/png` as its content type; risk is bounded by files being served via 307 redirect to S3 rather than executed server-side, but depends on S3 bucket `Content-Type`/`Content-Disposition` configuration, which is **not verifiable from this repository** (Category E).

**Download path (`/manus-storage/*`, `storageProxy.ts`):** **HIGH — Category A.** This route performs **zero authentication or authorization check**. Given any storage key, it fetches a presigned GET URL from Forge and 307-redirects the client to it. Protection is entirely "security through obscurity" — the key is `{prefix}/{userId or user-{userId}}/{timestamp-or-nothing}-{filename}_{8-hex-suffix}`. Compliance documents specifically use the pattern `registration/{userId}/{timestamp}-{filename}_{suffix}` (`routers.ts` line 141) — `userId` is a small, sequential, guessable integer, and `timestamp` is milliseconds-since-epoch, which is guessable to within seconds if an attacker knows roughly when a document was uploaded (e.g., right after watching a user complete onboarding). The 8-hex-char suffix (32 bits) is the only real obstacle, and it is not cryptographically difficult to brute-force offline if an attacker can enumerate candidate keys quickly, though the storage proxy itself would rate-limit-by-latency in practice (no explicit rate limiting exists here either).

CLAUDE_HANDOFF.md's warning — *"Modifying the S3 proxy upload/download validation risks exposing private compliance documents"* — **implies protection currently exists that would be lost if changed.** In fact, **no such protection exists to lose**; the documentation is describing a security property that was never implemented.
**EXPLOIT/FAILURE SCENARIO:** Any compliance document URL that leaks anywhere (browser history, a support ticket screenshot, an admin's shared screen, a referrer header sent to a third-party analytics script if one is ever added) is permanently and fully accessible to anyone who has that URL string, authenticated or not, forever — with no session check, no expiry, no revocation.
**RECOMMENDED FIX:** Require the tRPC session to resolve the caller, then verify the caller either owns the resource (`registrationDocuments.userId === ctx.user.id`) or is an admin, by looking up the key in the relevant table before issuing the redirect — or move the download URL generation itself server-side inside the already-authenticated tRPC procedures instead of exposing a standalone unauthenticated Express route.
**PRODUCTION BLOCKER?** **YES**, specifically for compliance/ID documents (`registration/*` keys). RFQ/project/message attachments are lower sensitivity but share the same gap.
**Category: A**, with the documentation claim in CLAUDE_HANDOFF.md being **Category C** (false implication of existing protection).

---

## 14. Notifications

**FILE:** `server/_core/notification.ts`, and the in-app `notifications` table usage throughout `routers.ts`.

Two entirely separate things are both called "notifications" in this codebase and should not be conflated:

1. **In-app notification records** (`db.insert(notifications).values({...})`) — used for compliance status changes, etc. These are real, functional, and correctly scoped by `userId` (`notificationsRouter.list`/`unreadCount`/`markAllRead` all correctly filter `eq(notifications.userId, ctx.user.id)`). **Positive finding.**
2. **`notifyOwner`** (`server/_core/notification.ts`) — this is a Manus-platform "alert the app owner" mechanism (used by `systemRouter.notifyOwner`, admin-only), unrelated to end-user email/SMS.

**Baseline claim:** *"Email/SMS: Notifications: Backend triggers active."* **Actual:** No SendGrid, no Twilio, no outbound email/SMS code of any kind exists anywhere in the repository (confirmed via grep in the previous session). In-app DB notifications work; **actual outbound email/SMS delivery does not exist in code at all**, so "backend triggers active" overstates what's implemented — there's nothing to configure keys *into*.
**Category: C** (documentation overstates scope) + **B** (email/SMS delivery is simply not built, not just unconfigured).

---

## 15. Reviews/Ratings

Covered in §6.7 (the authorization gap). Structurally: `reviews.forUser` correctly filters to `verified: true` only for public display. `users.rating`/`users.reviewCount` columns exist on the schema but **no code path in `routers.ts` was found that recomputes these aggregate fields when a review is inserted** — `grep` shows no `UPDATE users SET rating` / no aggregate recompute logic anywhere. **MEDIUM/Category B**: the rating aggregation is either computed client-side from the reviews list (not verified — would require a client audit beyond this pass) or simply not implemented server-side, meaning `users.rating` may be permanently stale/zero. This needs explicit confirmation before launch; flagging as **NOT VERIFIED** rather than asserting it's broken, since it's plausible the client aggregates on read.

---

## 16. Admin (routes + prior audit-document comparison)

Route-level review already covered in §6.8 (sound). The more important finding here is a review of the **five pre-existing "audit" markdown files already committed to this repository**, cross-checked line-by-line against actual source:

| Prior document claim | Verified reality | File(s) |
|---|---|---|
| *"Stripe checkout, subscription creation, webhook signature verification (`stripe.webhooks.constructEvent`), and idempotency handling are fully implemented in `server/routers.ts`"* — `UNVERIFIED_ITEMS_REMEDIATION_REPORT.md` §5 | **False.** Zero Stripe code exists anywhere in the repo. | repo-wide |
| *"Webhook & checkout handlers present; keys unconfigured"* — `BUILDHUB_FINAL_BASELINE_REPORT.md` row 29 | **False.** No handlers exist. | same |
| *"Transactional `acceptQuotationSecure` helper... The transaction locks the RFQ row, verifies status is `open`..."* — `UNVERIFIED_ITEMS_REMEDIATION_REPORT.md` §1 | **False on two counts:** (1) `acceptQuotationSecure` contains no `db.transaction()` and no row lock of any kind; (2) it is dead code never called by the running app. | `server/quotationWorkflow.ts` |
| *"Database integrity — PASS — Drizzle schema foreign keys & transactions"* — `BUILDHUB_FINAL_BASELINE_REPORT.md` row 32 | **False.** Zero foreign keys exist in the schema or any migration. | `drizzle/schema.ts`, `drizzle/*.sql` |
| *"Critical Blockers: 0 (All internal data loss, authorization, and quotation race condition risks are resolved)"* — `SECOND_PASS_AUDIT_REPORT.md` | **False**, per §6.1–6.3 of this report — the live quotation-acceptance path has an unresolved IDOR and no transaction. | `server/routers.ts` |
| *"Backend Authorization: Private document uploads are stored in S3... with secure presigned URLs and role-based access control"* — `UNVERIFIED_ITEMS_REMEDIATION_REPORT.md` §4 | **Partially false.** Upload is presigned correctly; the **download** path (`storageProxy.ts`) has no role-based or any access control. | `server/_core/storageProxy.ts` |
| *"Security & Authorization — PASS — Role-based tRPC guards, owner-only RFQ/quotation access"* — `SECOND_PASS_AUDIT_REPORT.md` row 34 | **False** for quotation accept/reject (§6.1/6.2) and for the Projects module (§6.5). | `server/routers.ts` |

**This is the most consequential finding in the entire review.** Five independently-dated documents, each describing itself as a rigorous or "exhaustive... second-pass independent verification," repeat and even *elaborate on* the same false technical claims (each report adds more specific, more confident-sounding detail — "locks the RFQ row," "idempotency handling," — without any of it being traceable to actual code). This pattern is consistent with documentation that was generated/asserted without being checked against the source tree, and it should not be trusted as a basis for any future go/no-go decision until independently re-verified, which is what this report does. **Category: C**, severity **CRITICAL** as a trust/process issue — every "PASS" in those five files must now be treated as an open question, not a settled fact, even for areas this review didn't have time to re-check line-by-line.

---

## 17. Arabic/RTL

**FILE:** `client/src/contexts/LanguageContext.tsx` (1005 lines)

**Verified sound:**
- English and Arabic translation maps have **exactly matching key counts (454/454)** — no orphaned or missing keys on either side.
- `t()` falls back to the English string, then the raw key, if a translation is missing (defensive, no blank UI).
- `document.documentElement.dir`/`lang` and `body.style.fontFamily` (Cairo for Arabic, Inter for English) are set reactively via `useEffect` on language change — genuine RTL layout switching, not just text swapping.
- Language preference persists to `localStorage` (`buildhub_lang`).

**MEDIUM/Category C — incomplete i18n coverage on customer-facing pages:** Counting calls to `t(...)` per page file:

| Page | `t()` calls | Assessment |
|---|---|---|
| `RolePlatform.tsx` | 44 | Fully localized |
| `HomeownerDashboard.tsx` | 32 | Fully localized |
| `Home.tsx` | 27 | Fully localized |
| `ProjectDetail.tsx` | 27 | Fully localized |
| `AuthPage.tsx` | 24 | Fully localized |
| `RFQPage.tsx` | 21 | Fully localized |
| `Marketplace.tsx` | 8 | Fully localized |
| `MessagesPage.tsx` | 5 | Fully localized |
| `ProviderDashboard.tsx` | 5 | Fully localized |
| **`VendorsDirectory.tsx`** | **0** | **Hardcoded English only** |
| **`DesignersDirectory.tsx`** | **0** | **Hardcoded English only** |
| **`FinishingDirectory.tsx`** | **0** | **Hardcoded English only** |
| **`MarketplaceHub.tsx`** | **0** | **Hardcoded English only** |
| **`NotFound.tsx`** | **0** | **Hardcoded English only** (low stakes, 404 page) |
| `ComponentShowcase.tsx` | 0 | Dev/internal showcase page, not customer-facing — not a real gap |

**WHY IT'S A PROBLEM:** `BUILDHUB_BASELINE.md` claims "supporting dynamic LTR/RTL switching (English/Arabic)" as a general platform property. In practice, switching to Arabic on `VendorsDirectory`, `DesignersDirectory`, `FinishingDirectory`, or `MarketplaceHub` flips the page's `dir` to `rtl` (layout mirrors) while all visible text remains English — a jarring, half-localized experience on exactly the pages a homeowner is likely to browse first when discovering providers/products.
**RECOMMENDED FIX:** Extend `t()` coverage to the four listed customer-facing directory/hub pages.
**PRODUCTION BLOCKER?** Not a security blocker; **should block launch to the Arabic-speaking market specifically**, which — given the Egypt/MENA product context implied elsewhere in this codebase — is presumably a primary target market, not an edge case.
**Category: C** (documentation overstates completeness) + **B** (the missing translations themselves).

---

## 18. Mobile / Responsive

**Important caveat:** this sandbox has no browser/rendering capability, so this section is based on **static code inspection only** (Tailwind responsive-prefix usage, layout patterns), not actual visual/viewport testing. Treat this section's findings as directional, not conclusive — recommend a manual QA pass on real devices before launch regardless of what's written here.

- `AdminDashboard.tsx` and `HomeownerDashboard.tsx` use a reasonable number of `sm:`/`md:`/`lg:` breakpoint classes (15–35 occurrences each), suggesting deliberate responsive design.
- `QuotationComparison.tsx` (571 lines) — the quotation comparison cards use `grid-template-columns: repeat(min(N,3), minmax(260px,1fr))` with `overflowX: 'auto'` as an **inline style**, not Tailwind breakpoint classes. This is a legitimate, common pattern (horizontal-scroll card carousel on narrow viewports rather than reflow), so it's likely functional on mobile, but it was **not visually verified** and doesn't follow the same breakpoint convention used elsewhere in the app — worth a manual check specifically on this component, since side-by-side quotation comparison is one of the most important customer-facing screens in the product.
- `RFQPage.tsx` has only a single `sm:` occurrence across 472 lines — comparatively light responsive-class usage relative to the dashboards. **Not verified as broken**, but a lower-confidence page for mobile correctness than the two dashboards.

**Category: not applicable (unverified)** rather than a firm A/B/C/D/E classification — flagging as an **open item requiring live-device QA**, explicitly not claimed as broken.

---

## 19. Security (consolidated)

All items below are cross-referenced to their detailed write-up elsewhere in this report; this section exists purely as the requested consolidated security-review checklist.

| Area | Status | Ref |
|---|---|---|
| Authentication vulnerabilities | None found | §5 |
| Authorization vulnerabilities (RBAC) | Sound at router level; broken at object level | §6.1, 6.2, 6.5 |
| IDOR/BOLA | **3 confirmed instances** (quotation accept/reject, Projects module) | §6.1, 6.2, 6.5 |
| Customer/vendor data isolation | Broken for Projects module; broken for compliance-doc storage | §6.5, §13 |
| Admin privilege escalation | None found — all admin routes correctly gated | §6.8 |
| API authorization | Broken for the specific endpoints listed above; sound elsewhere | §6 |
| File authorization | **Broken — no auth check on download proxy** | §13 |
| Sensitive data exposure | `projects.directory` over-exposes budget/spend (§6.6); storage-key predictability (§13) | §6.6, §13 |
| Secrets in source code | None found (grepped for Stripe/AWS/private-key patterns) | §2 |
| Input validation | Zod used consistently and correctly across all mutations reviewed | — |
| SQL injection | None found — Drizzle's parameterized query builder used throughout; the one raw `sql` template usage (`sql\`id != ${input.quotationId}\`` in `acceptQuotation`) uses Drizzle's tagged-template parameterization, which is safe | — |
| XSS | Not deeply audited (would require client-render review of any `dangerouslySetInnerHTML` usage — a targeted follow-up grep found no occurrences of `dangerouslySetInnerHTML` in `client/src`) | — |
| CSRF | No explicit CSRF token; relies on CORS-preflight absence + OAuth-specific nonce cookie (sound for OAuth flow itself); `sameSite: 'none'` on session cookie weakens defense-in-depth | §5.3 |
| Session security | Sound — HS256 JWT, httpOnly, algorithm-pinned verification | §5.2 |
| Webhook security | N/A — no webhooks exist in code | §12 |
| Payment security | N/A — no payment code exists | §12 |
| Development/test bypasses | Dummy-user login path (`signInDummy`) exists but is properly scoped: requires `isDummy && loginMethod === 'dummy'`, frozen by default, admin-gated creation — **not a bypass of real-user auth** | §5.4 |
| Rate limiting | **None anywhere in the server** — no `express-rate-limit`, no equivalent | this section |
| Cost-abuse via unauthenticated AI endpoint | **Confirmed** — `ai.chat` is `publicProcedure` | §20 |

---

## 20. AI Assistant Endpoint — Cost/Abuse Risk

**FILE:** `server/routers.ts`, lines 1008–1019
**FUNCTION/ROUTE:** `ai.chat`
**CURRENT BEHAVIOR:** `chat: publicProcedure.input(...).mutation(async ({ input }) => { const response = await invokeLLM({ messages: input.messages }); ... })` — this is a `publicProcedure`, requiring **no authentication whatsoever**, and forwards arbitrary user-supplied message arrays to `invokeLLM` (which, per `server/_core/llm.ts`/`openaiIntegration.ts`, calls out to either the Manus-managed Forge LLM proxy or directly to `api.openai.com` if `OPENAI_API_KEY`/`useDirectOpenAI` is set).
**WHY IT'S A PROBLEM:** Combined with the confirmed absence of any rate limiting anywhere in the server, this endpoint has **no cost ceiling and no abuse control**. Anyone — logged in or not — can script unlimited calls.
**EXPLOIT/FAILURE SCENARIO:** A script hits `POST /api/trpc/ai.chat` in a loop with large `messages` arrays, running up the connected LLM provider's bill with no authentication required and no per-user/per-IP throttle to stop it. This is a direct, uncapped financial exposure to whoever owns the LLM API key, distinct from and in addition to a normal availability DoS concern.
**RECOMMENDED FIX:** At minimum, change to `protectedProcedure` (requires login) — this alone adds real friction. Add explicit rate limiting (per-user and per-IP) and a `max_tokens`/message-count ceiling enforced server-side regardless of what the client requests. Consider a per-user daily quota given this is a marketplace product, not a dedicated AI product.
**PRODUCTION BLOCKER?** **YES** — this is an open-ended financial liability, not a bounded one.
**Category: A.**

---

## 21. Performance

- **N+1 / full-table-scan risk:** covered in §4.2 — no indexes on FK-shaped columns. Not yet an N+1 pattern in the Drizzle query code itself (most list endpoints use single queries with `leftJoin` appropriately, e.g. `rfqRouter.myQuotations`, `rfqRouter.quotations`), but every one of those single queries will degrade linearly with table size due to the missing indexes.
- **Pagination:** Inconsistent. `rfq.list` (`limit(50)`), `admin.users` (`limit(250)`), `admin.fullAuditReport` (`limit(1000)`) all use a hard `LIMIT` with **no offset/cursor pagination** — beyond the limit, older/additional rows are simply unreachable through the UI. This isn't broken today (nothing errors), but it's a **Category D** scalability gap: there's no way to see audit event #1001 onward through any exposed endpoint.
- **Bundle size:** The production build succeeds but emits an explicit Vite warning: the main JS chunk is **2,392.74 kB (663.99 kB gzipped)**, and dozens of syntax-highlighting-language chunks (18–80kB each, evidently from a code/markdown-highlighting dependency pulled in by the `streamdown` package used for the AI assistant's markdown rendering) ship in the build. This is a genuine initial-load performance concern for a marketplace app where most users never touch the AI assistant page. **Category D** (recommend dynamic `import()` / route-based code-splitting for the AI assistant and any `mermaid`/syntax-highlighter-dependent code, and raising `build.chunkSizeWarningLimit` only after actually addressing the chunking, not instead of it).
- **Large lists / image loading:** not deeply auditable without live data or a browser; not flagged as broken, flagged as **not verified**.

---

## 22. Testing

**Executed in this sandbox:**
```
npx vitest run   → Test Files: 18 passed (18)  |  Tests: 69 passed (69)  |  Duration: 10.30s
npx tsc --noEmit → 0 errors
npx vite build   → succeeded (with bundle-size warning, §21)
npx esbuild server/_core/index.ts ... → succeeded, dist/index.js 121.2kb
```

Note: `BUILDHUB_BASELINE.md` states "38 / 38 tests passing." The actual current count is **69 passing tests across 18 files** — more tests exist now than the baseline document describes (the baseline is stale, or was written before later test files were added). This is a **Category C** discrepancy, but a harmless one (more coverage than documented, not less) — flagged for accuracy only, not as a defect.

**Test coverage gaps identified:**
- **No test exercises the actual live `rfqRouter.acceptQuotation`/`rejectQuotation` mutations** — the only quotation-acceptance test (`quotationWorkflow.test.ts`) tests the *unused* `acceptQuotationSecure` function instead (one assertion: that it throws on a nonexistent RFQ). There is **zero test coverage of the code path that actually runs in production**, which is precisely how the §6.1–6.3 defects went undetected through five rounds of "passing" audits.
- No test exercises the Projects module's ownership checks (or lack thereof) for `milestones`/`tasks`/`expenses`/`dailyLogs`.
- No test exercises `storageProxy.ts`'s (lack of) download authorization.
- No test exercises `reviews.submit`'s (lack of) participant verification.

**Category: A** for the coverage gap on the quotation path specifically (it's the exact reason a CRITICAL bug shipped past "38/38 passing" in every prior report), **Category D** for the other gaps (good practice, not evidence of an active defect beyond what's already documented elsewhere).

---

## 23. Production Readiness

**Verdict: NOT READY.** Not because of the external-configuration items (those are legitimate, known, and correctly labeled by the existing docs) — because of unresolved CRITICAL code-level authorization and concurrency defects that exist independently of any environment variable.

---

## 24. Technical Debt

- Two parallel, divergent implementations of quotation acceptance (§6.4) — must be consolidated, not left as-is.
- Two independent definitions of `adminProcedure` (§6.8) with no shared source of truth.
- Empty `drizzle/relations.ts` — Drizzle's relational query API is set up but unused; either use it or remove the scaffolding.
- `server/_core/map.ts` and `client/src/components/Map.tsx` (Google Maps integration) exist and are fully coded but are **not wired into any page or router** — genuinely unused infrastructure, not a bug, but dead weight worth either removing or actually using for location-based provider matching (which the baseline's "Smart Matching" feature description implies should exist).
- `server/_core/heartbeat.ts` (cron/scheduled-task registration) is fully scaffolded and unused — no expiration job, no digest emails, nothing is actually scheduled.

**Category: D**, all of the above.

---

## 25. Critical Risks (ranked)

1. **[CRITICAL]** Quotation accept/reject IDOR + missing transaction — §6.1, 6.2, 6.3 — can corrupt cross-tenant quotation state and violate the platform's core "one winner per RFQ" guarantee.
2. **[CRITICAL]** Projects module IDOR — §6.5 — cross-tenant read/write of tasks, milestones, expenses, daily logs.
3. **[CRITICAL]** File storage has no download authorization — §13 — compliance/ID documents are exposed to anyone with the URL.
4. **[CRITICAL]** The prior audit-document trail cannot be trusted — §16 — every previously-reported "PASS" needs independent re-verification, not just the items this report re-checked.
5. **[HIGH]** Reviews can be forged by unrelated users against unrelated accounts — §6.7.
6. **[HIGH]** Unauthenticated, unrate-limited AI endpoint — §20 — open-ended cost exposure.
7. **[MEDIUM]** `projects.directory` over-exposes homeowner budgets to all providers — §6.6.
8. **[MEDIUM]** Incomplete Arabic localization on customer-facing directory pages — §17.
9. **[MEDIUM]** No FK constraints / no indexes — §4.1, 4.2 — not urgent, but compounds every future incident.
10. **[LOW]** Client-declared (not sniffed) MIME validation on uploads — §13.

---

## 26. Recommended Improvements (non-blocking)

- Wrap every multi-statement mutation in `db.transaction()`, not just the quotation path, as a uniform hardening pass (§11).
- Add cursor/offset pagination to admin list endpoints (§21).
- Code-split the AI assistant / markdown-rendering bundle (§21).
- Populate `drizzle/relations.ts` and add FK constraints + indexes as a dedicated migration (§4.1, 4.2).
- Either wire up or remove the unused Maps and heartbeat/cron infrastructure (§24).
- Extend `t()` coverage to the four directory/hub pages currently hardcoded in English (§17).
- Consolidate the two `adminProcedure` definitions into one shared export (§6.8).

---

## 27. External Configuration Required (genuinely — Category E)

These are the only items that are correctly described by the existing `PRODUCTION_CHECKLIST.md` as external/environment concerns, **assuming the underlying code existed** — for Stripe specifically, this category doesn't apply yet because there is no code to configure keys into (see §12):

- `DATABASE_URL` (production MySQL/TiDB connection + SSL verification)
- `JWT_SECRET`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, `OWNER_OPEN_ID` (auth/session)
- `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` (storage, maps, LLM proxy — all currently depend on this one pair of Manus-platform credentials)
- `OPENAI_API_KEY` (only relevant if `useDirectOpenAI` direct-call path is intentionally used instead of the Forge proxy)
- Automated database backup/snapshot cron (genuinely external, correctly flagged by `PRODUCTION_CHECKLIST.md`)
- Uptime/error monitoring (Sentry, UptimeRobot, etc.) — correctly flagged, not yet configured, no code-level blocker
- **Stripe, SendGrid, Twilio: NOT applicable as "configuration" items — the code does not exist to configure. These need to be built, not configured (Category B, not E).**

---

## 28. Recommended Development Roadmap

This is sequencing advice only — no code changes have been made, and this ordering is not an authorization to proceed.

**Phase 0 — before touching anything else:** Independently re-verify every remaining "PASS" claim in the five prior audit documents that this review did not have time to re-check line-by-line (client-side XSS surface beyond the single grep performed, the full extent of loading/empty/error-state coverage across all 20 pages, live-device mobile QA). Do not assume anything in those five documents is accurate without a fresh check, per §16.

**Phase 1 — CRITICAL fixes (blocks launch):**
1. Fix `acceptQuotation`/`rejectQuotation` IDOR + wrap in a transaction with pending-state re-verification (§6.1–6.3). Decide explicitly whether to repair and wire up `acceptQuotationSecure` or delete it and fix the live path directly — do not leave two implementations.
2. Fix the Projects module IDOR (§6.5) — apply the ownership-check pattern already used correctly by the router's other endpoints.
3. Add authorization to the storage download proxy (§13), at minimum for the `registration/*` (compliance document) key prefix.
4. Fix `reviews.submit` participant verification (§6.7).
5. Gate `ai.chat` behind authentication and add rate limiting (§20).

**Phase 2 — before targeting the Arabic-speaking market specifically:** Complete i18n coverage on `VendorsDirectory`, `DesignersDirectory`, `FinishingDirectory`, `MarketplaceHub` (§17).

**Phase 3 — decide and build, don't configure:** Make an explicit product decision on payments (build real Stripe integration from scratch, since none exists) before any checklist item references "configuring" Stripe keys (§12).

**Phase 4 — hardening, not blocking:** FK constraints + indexes (§4), uniform transaction wrapping (§11), bundle code-splitting (§21), pagination on admin lists (§21), consolidate duplicate `adminProcedure` (§6.8), decide fate of unused Maps/heartbeat infrastructure (§24).

---

## Appendix A — Commands run (for reproducibility)

```bash
git ... (repo obtained via authenticated zip download after the GitHub repo was made public)
pnpm install --frozen-lockfile
npx vitest run
npx tsc --noEmit
npx vite build
npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
grep -ri "stripe" .            # 0 hits, repo-wide
grep -n "FOREIGN KEY\|REFERENCES" drizzle/*.sql   # 0 hits
grep -rn "acceptQuotationSecure" .                # only in quotationWorkflow.ts + its own test
grep -rn "\.transaction(" server/                 # 0 hits anywhere in server code
```

No file in the repository was created, modified, or deleted as part of this review.

---

**READ-ONLY ARCHITECTURE REVIEW COMPLETED — NO CODE CHANGES MADE.**
