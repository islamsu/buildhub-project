# BuildHub — Phase 3C: Database Integrity & Performance Hardening

**Branch:** `claude/phase3c-database-hardening` (based on `claude/phase3a-product-completeness`)
**Scope:** Database schema only — foreign keys, indexes, orphan audit, transaction audit, delete-behavior audit. No Stripe, no email/SMS, no auth/infra redesign, no production changes.

## 0. Correcting the phase's stated baseline

The Phase 3C prompt asserted that staging environment, backups, restore procedure, and real-database concurrency testing were all "VERIFIED." **That is false.** Per `BUILDHUB_PHASE3B1_INFRASTRUCTURE_DISCOVERY.md` (this same engagement, Phase 3B.1), none of those exist or were reachable from this session — there is no Manus dashboard/API access, no staging environment, no backup/restore mechanism, and no way to test against real production traffic. That finding still stands; nothing in Phase 3C changed it. This report treats those items as **NOT VERIFIED** throughout, and states clearly wherever a claim rests only on synthetic data versus real BuildHub data.

What *is* new and genuinely verified in this phase: a disposable local MariaDB 10.11.14 instance (`buildhub_verify`), installed via `apt` inside this sandbox (Docker Hub pulls are blocked by the egress proxy), used to run the real `drizzle-kit generate`/`migrate` pipeline, seed synthetic data, and observe actual MySQL-protocol behavior — not mocks, not assumptions. This is still not staging or production, and is called out as such everywhere it matters.

---

## 1. Relationship matrix

All FK-shaped columns across the 20-table schema (`drizzle/schema.ts`), found by inspecting every column ending in `Id`/`By` plus manual review:

| # | Table.column | References | Nullable | Orphan risk source |
|---|---|---|---|---|
| 1 | users.createdBy | users.id | Y | admin-created accounts |
| 2 | users.onboardingReviewedBy | users.id | Y | compliance review |
| 3 | userAccountAuditEvents.userId | users.id | Y* | **deleteDummyUser (see §3)** |
| 4 | userAccountAuditEvents.actorId | users.id | Y | actor deleted later |
| 5 | projects.ownerId | users.id | N | **deleteDummyUser** |
| 6 | milestones.projectId | projects.id | N | project deletion (none exists today) |
| 7 | tasks.projectId | projects.id | N | project deletion |
| 8 | tasks.milestoneId | milestones.id | Y | milestone deletion |
| 9 | tasks.assigneeId | users.id | Y | **deleteDummyUser** |
| 10 | documents.projectId | projects.id | N | project deletion |
| 11 | documents.uploaderId | users.id | N | **deleteDummyUser** |
| 12 | registrationDocuments.userId | users.id | N | **deleteDummyUser** |
| 13 | registrationDocuments.reviewedBy | users.id | Y | reviewer deleted later |
| 14 | registrationDocumentSubmissions.documentId | registrationDocuments.id | N | none today |
| 15 | registrationDocumentSubmissions.userId | users.id | N | **deleteDummyUser** |
| 16 | registrationReviewEvents.userId | users.id | N | **deleteDummyUser** |
| 17 | registrationReviewEvents.documentId | registrationDocuments.id | Y | none today |
| 18 | registrationReviewEvents.actorId | users.id | N | actor deletion |
| 19 | productQuestions.productId | products.id | N | product deletion (none exists) |
| 20 | productQuestions.askerId | users.id | N | **deleteDummyUser** |
| 21 | products.supplierId | users.id | N | supplier deletion |
| 22 | rfqs.requesterId | users.id | N | requester deletion |
| 23 | rfqs.projectId | projects.id | Y | project deletion |
| 24 | quotations.rfqId | rfqs.id | N | none today |
| 25 | quotations.providerId | users.id | N | **deleteDummyUser** |
| 26 | messages.senderId | users.id | N | sender deletion |
| 27 | messages.receiverId | users.id | N | **deleteDummyUser** |
| 28 | messages.projectId | projects.id | Y | project deletion |
| 29 | messages.quotationId | quotations.id | Y | quotation deletion |
| 30 | notifications.userId | users.id | N | **deleteDummyUser** |
| 31 | reviews.projectId | projects.id | N | project deletion |
| 32 | reviews.reviewerId | users.id | N | reviewer deletion |
| 33 | reviews.revieweeId | users.id | N | **deleteDummyUser** |
| 34 | progressReports.projectId | projects.id | N | project deletion |
| 35 | progressReports.authorId | users.id | N | **deleteDummyUser** |
| 36 | disputes.reporterId | users.id | N | reporter deletion |
| 37 | disputes.respondentId | users.id | Y | **deleteDummyUser** |
| 38 | disputes.projectId | projects.id | Y | project deletion |
| 39 | adminSettings.updatedBy | users.id | N | admin deletion |
| 40 | dailyLogs.projectId | projects.id | N | project deletion |
| 41 | dailyLogs.authorId | users.id | N | **deleteDummyUser** |
| 42 | expenses.projectId | projects.id | N | project deletion |

\* `userAccountAuditEvents.userId` was made nullable **during this phase** — see §3 and §8 for why.

**Baseline confirmed unchanged from earlier phases:** zero FKs, zero FK-shaped indexes existed before this phase (only `users_username_unique`, `users_email_unique`, `adminSettings.settingKey` unique). `drizzle/relations.ts` is still an empty scaffold.

**The single active orphan-creation path in the whole app** is `admin.deleteDummyUser` (`server/routers.ts`) — it deletes a `users` row with no cascade check against any of the 15 relationships marked above. Every other user/project/product deletion path in the codebase does not exist (there is no `deleteProject`, `deleteProduct`, etc. today), so orphan risk is currently concentrated entirely in this one endpoint.

---

## 2. Orphan-data audit

**Real production/staging data:** NOT VERIFIED — not reachable from this session (see §0). Nobody has run this audit against real BuildHub data. This is the load-bearing caveat of the whole report.

**Methodology validation (synthetic data, this session only):** To prove the orphan-detection approach actually works — not just that it looks plausible — I seeded a disposable MariaDB copy with a small dataset, then reproduced the exact `deleteDummyUser` code path (insert an audit event referencing a dummy user, then delete that user with no cascade check) against 15 relationships simultaneously. I then ran a single audit query (`LEFT JOIN ... WHERE parent.id IS NULL`, one clause per relationship, all 42) against the result.

**Result:** all 15 deliberately-orphaned relationships were correctly detected with orphan count 1; all other 27 relationships correctly showed 0. This confirms the detection SQL has no false positives or false negatives on this data shape. The full 42-relationship audit query is not committed to the repo (it's a diagnostic script, not application code) but every WHERE clause is reproducible directly from the relationship matrix in §1: `SELECT COUNT(*) FROM <child> c LEFT JOIN <parent> p ON c.<col> = p.id WHERE <c.col IS NOT NULL AND> p.id IS NULL`.

This is **methodology validation, not a real audit**. Whether real BuildHub production data has zero, a few, or many orphans from `deleteDummyUser` having been used before this phase is unknown and cannot be determined without database access that does not exist in this session.

---

## 3. Orphan remediation plan

For the 15 relationships at risk from `deleteDummyUser`, remediation splits cleanly on nullability:

**Nullable columns (3) — safe to auto-remediate via `ON DELETE SET NULL`:** `tasks.assigneeId`, `disputes.respondentId`, and (after the fix below) `userAccountAuditEvents.userId`. Losing the reference on these doesn't lose the row or its meaning — a task becomes unassigned, a dispute becomes unassigned-respondent, an audit event keeps its `action`/`note`/`createdAt` but shows "deleted user" instead of a name.

**NOT NULL columns (12) — require a business decision, cannot be auto-remediated.** These are: `projects.ownerId`, `documents.uploaderId`, `registrationDocuments.userId`, `registrationDocumentSubmissions.userId`, `registrationReviewEvents.userId`, `productQuestions.askerId`, `quotations.providerId`, `messages.receiverId`, `notifications.userId`, `reviews.revieweeId`, `progressReports.authorId`, `dailyLogs.authorId`. If any of these are found orphaned in real data, there is no safe default — the options are (a) reassign to a real replacement user, (b) hard-delete the child row (acceptable only for low-value rows like notifications; never for financial/compliance/review data), or (c) restore the deleted user record. **This report does not choose one — that is the STOP condition the phase spec requires.** Because no real orphan count exists yet (§2), there is nothing to decide today; the decision is deferred until a real audit is run against actual data, which must happen before any FK constraint is applied outside this sandbox.

**What was actually cleaned up in this session:** the 15 relationships were deliberately orphaned as *synthetic test fixtures* purely to prove the migration fails safely (§5) and the detection SQL works (§2). Those synthetic rows were then deleted outright — this is fine because they are not real data, but it is explicitly **not** the same operation as remediating real orphans, and this report does not treat it as a precedent for handling real ones.

---

## 4. Foreign key proposals

All 42 relationships from §1 get an explicit FK, generated from `drizzle/schema.ts` via `drizzle-kit generate` into `drizzle/0012_broken_nightmare.sql`. Design rules applied uniformly:

- **`ON UPDATE RESTRICT`** everywhere — every PK is a surrogate autoincrement int that is never updated in application code, so this is a no-op in practice, but it signals intent and matches the "prefer RESTRICT, never CASCADE for convenience" instruction consistently for both directions.
- **`ON DELETE RESTRICT`** (29 of 42) for every NOT NULL relationship pointing at financial, quotation, review, compliance, or audit-adjacent data, and for every project-scoped child table. This means: you cannot delete a user or project that still has real dependent data — the database forces an explicit decision instead of silently orphaning rows, which is exactly what `deleteDummyUser` was doing before this phase.
- **`ON DELETE SET NULL`** (13 of 42) only for genuinely optional, historical, or "soft" references: admin/reviewer attribution fields (`onboardingReviewedBy`, `reviewedBy`, `createdBy`), optional project linkage (`rfqs.projectId`, `messages.projectId`), optional task/dispute assignment (`tasks.milestoneId`, `tasks.assigneeId`, `disputes.respondentId`, `disputes.projectId`), optional message-to-quotation linkage (`messages.quotationId`), optional document linkage on a review event (`registrationReviewEvents.documentId`), and the two audit-trail actor/subject columns (`userAccountAuditEvents.userId`, `.actorId`).
- **No `ON DELETE CASCADE` anywhere.** Zero uses. A cascading delete on any of these tables would silently destroy financial, compliance, or audit history — never acceptable per the phase's explicit instruction, and enforced by a regression test (§13).

Full FK list with orphan counts against the (synthetic, cleaned) local database and required cleanup: **0 orphans, 0 cleanup needed**, because the local DB was cleaned before the migration was proven to apply (§5). Real-data orphan counts: unknown (§2/§3).

---

## 5. A critical design correction found only by testing against a real database

Testing this migration against a real MariaDB instance immediately surfaced a self-inflicted bug the design-only phase of this work would not have caught: `deleteDummyUser` (`server/routers.ts`) **always** inserts a `userAccountAuditEvents` row referencing the user being deleted, immediately before deleting that user (`action: 'dummy_user_deleted'`). Every dummy user also gets a `dummy_user_created` audit event at creation time. If `userAccountAuditEvents.userId` had been left `NOT NULL` with `ON DELETE RESTRICT` (the initial, "conservative" choice, matching the phase's stated preference for audit tables), **every single dummy-user deletion would have failed**, 100% of the time, with no exceptions — the RESTRICT constraint would have blocked the delete because of the very audit row the deletion itself just wrote.

This is now fixed: `userAccountAuditEvents.userId` is nullable with `ON DELETE SET NULL` — the correct semantics for an audit trail is that it must outlive the thing it's about. Verified directly against the real database (not simulated): a dummy user with two audit events (create + delete) was deleted successfully, and both audit rows survived with `userId` correctly set to `NULL`.

This is the argument for treating "prefer RESTRICT for audit tables" as a starting posture, not an absolute rule — the correct behavior is relationship-specific, and this one relationship needed SET NULL to avoid breaking existing functionality.

---

## 6. Index audit (evidence-based)

Every FK-shaped column gets a single-column index — 41 of the 42 relationships. Justified directly by the grep counts already gathered from `server/routers.ts` and `server/quotationWorkflow.ts` in an earlier turn of this phase: `projects.ownerId` (19 occurrences, heaviest use), `quotations.rfqId` (9), `quotations.providerId` (5), `rfqs.requesterId` (3), `quotations.status` (3), `messages.senderId`/`receiverId` (3 each), `notifications.userId` (3), `rfqs.projectId` (2), `tasks.projectId` (2), `reviews.revieweeId` (2), and the remaining single-occurrence columns. No column was indexed "just in case" — every one of the 42 is queried by exact match somewhere in the router or workflow code, which is what makes an index effective in the first place.

**Measured, not assumed, performance impact** (§12 has the full EXPLAIN evidence): on a synthetic 20,038-row `projects` table, `WHERE ownerId = ?` went from a full table scan (`type: ALL`, 20,038 rows examined) to an index lookup (`type: ref`, 10 rows examined). On a 39,089-row `quotations` table, `WHERE rfqId = ?` went from `ALL`/39,089 rows to `ref`/8 rows.

---

## 7. Composite index analysis

One composite index was added, and only one — `notifications(userId, read)`. Justification: `server/routers.ts:652` runs `SELECT count(*) FROM notifications WHERE userId = ? AND read = false` for the unread-badge count, which is a hot path (evaluated on essentially every authenticated page load). A single-column index on `userId` alone would still require scanning every notification for that user to filter by `read`; the composite serves both the unread-count query and the plain `WHERE userId = ?` list query (`routers.ts:647`) via the same leftmost-prefix index, without needing a second index.

No other composite was added. `quotations(rfqId, status)` was considered (there's a join filtering both in `routers.ts:690`) but rejected — the filter there is `rfqs.projectId` + `quotations.status`, not `quotations.rfqId` + `quotations.status`, so the existing single-column indexes on `quotations.rfqId` and `rfqs.projectId` already cover it; a composite would be speculative, not evidence-based.

---

## 8. Unique-constraint audit

Existing: `users.username`, `users.email`, `adminSettings.settingKey` — all correct, unchanged.

**Duplicate-review prevention** (`reviews` table, one review per reviewer/reviewee/project) is currently enforced only at the application level (confirmed in earlier phases of this engagement, Phase 2/3A). A `UNIQUE (projectId, reviewerId, revieweeId)` constraint would harden this at the database layer — but adding it now would require knowing whether real production data already contains duplicates, which is unverifiable from this session (§0/§2). **Not added this phase.** Recommended as a follow-up once real data can be audited: run `SELECT projectId, reviewerId, revieweeId, COUNT(*) FROM reviews GROUP BY 1,2,3 HAVING COUNT(*) > 1` against real data first; if it returns zero rows, the unique index is a same-day, low-risk addition.

---

## 9. Transaction audit

Every multi-statement mutation found across `server/routers.ts` and `server/quotationWorkflow.ts`, classified by what breaks if a failure happens between statements:

| Mutation | Writes | Class | Why |
|---|---|---|---|
| `quotationWorkflow.ts` (accept/reject quotation) | Multiple, with `db.transaction()` + `.for('update')` row locking | — | **Already correct from Phase 1/3A. Not touched — no regression found.** |
| `admin.deleteDummyUser` | insert audit event, delete user | HIGH | Money/identity-adjacent (deletes a real row); now additionally protected by 42 FK constraints, which convert "partial failure leaves an orphan" into "the DB itself refuses the unsafe half" — see §5 fix for the resulting UX handling |
| `registration.reviewComplianceDocument` | update doc, update submission, **read-then-compute** overall status, update user, insert review event, notify | HIGH | 5 sequential DB operations plus a read-after-write recomputation (`overallStatus` is derived from a fresh `SELECT` of all the applicant's documents, read *after* the first `UPDATE` in the same handler) — a concurrent review of a different document for the same applicant between the update and the re-read could compute a stale `overallStatus`. Determines onboarding/compliance outcome. |
| `registration.uploadDocument` | storage upload (side effect), insert document, insert submission, update user status, insert review event | HIGH | Changes onboarding/compliance status; non-DB side effect (file upload) happens before any DB write |
| `admin.bulkUpdateApplicantStatus` | select applicants, bulk update users, bulk insert review events, notify | MEDIUM-HIGH | Bulk scope (up to 100 users) raises blast radius, but logic is simpler than `reviewComplianceDocument` (no read-after-write recomputation) |
| `admin.updateApplicantStatus` | update user, insert review event, notify | MEDIUM | Single status field, no derived/recomputed value |
| `projects.addProgressReport` | insert progress report, update project.progress | MEDIUM | Visible project state, but not financial/compliance |
| `admin.createUser` / `resendInvitation` / `completeInvitation` | multi-write account provisioning | LOW-MEDIUM | Account provisioning, not financial or state-critical; worst case is a retryable invitation flow |
| `admin.setUserFrozen` | update user, insert audit event | LOW | Audit-trail-only risk if the second write fails |

**No new `db.transaction()` wrapping was added this phase.** The phase spec explicitly warns against "blindly wrapping everything in transactions," and every mutation above that isn't already transactional was already working correctly under MySQL's default per-statement autocommit for its actual risk profile — the FK constraints added in this phase (§4) now provide referential-integrity protection at the database layer for the highest-risk case (`deleteDummyUser`) without needing an application-level transaction change. `reviewComplianceDocument`'s read-after-write race is a real, pre-existing risk, but reproducing and fixing it is a transaction-logic change to onboarding, not a database-integrity/index/FK change — flagging it here as a finding for a future, narrowly-scoped phase rather than fixing it under Phase 3C's stated boundaries.

---

## 10. Delete-behavior audit

See §4 for the full RESTRICT/SET NULL rationale. Summary: 29 RESTRICT, 13 SET NULL, 0 CASCADE, across all 42 relationships. A regression test (`server/databaseIntegrity.test.ts`) locks in that no relationship ever uses CASCADE for either delete or update, and that each of the 42 relationships has the exact `onDelete`/`onUpdate` pair listed in §4 — so a future PR that "helpfully" changes one to CASCADE, or drops an index, fails CI immediately.

---

## 11. Migration design and staged sequence

Migration file: `drizzle/0012_broken_nightmare.sql` (auto-generated by `drizzle-kit generate` from the updated `drizzle/schema.ts` — not hand-written, so it's guaranteed to match the schema exactly). Sequence used and proven in this session, twice, end to end:

1. **Audit** — run the orphan-detection queries from §2 against the target database.
2. **Cleanup** — remediate any orphans found, per the decision framework in §3 (never automatic for NOT NULL columns).
3. **Indexes + constraints** — apply `0012_broken_nightmare.sql` (indexes and FKs are in the same file; MySQL's `ADD INDEX` for the FK-supporting index and `ADD CONSTRAINT ... FOREIGN KEY` can be applied in one pass since we've already confirmed clean data).
4. **Verify** — re-run the orphan queries (should be empty) and confirm `information_schema.TABLE_CONSTRAINTS` / `information_schema.STATISTICS` show the expected 42 FKs and 42 indexes.
5. **Test** — run the full application test suite and TypeScript build against the migrated schema.

Full details, including the two real failure modes discovered while proving this sequence, are in `BUILDHUB_DATABASE_MIGRATION_RUNBOOK.md`.

---

## 12. Performance verification (measured, not assumed)

Synthetic bulk data was seeded specifically because the existing dataset (a handful of rows) is too small for MySQL's cost-based optimizer to ever choose an index over a table scan — any "before/after" comparison on tiny tables would show identical, misleading results. Seeded: 2,000 users, 20,038 projects, 5,000 RFQs, 39,089 quotations.

| Query | Before (no index) | After (with index) |
|---|---|---|
| `SELECT * FROM projects WHERE ownerId = ?` | `type: ALL`, 20,038 rows scanned | `type: ref`, 10 rows scanned |
| `SELECT * FROM quotations WHERE rfqId = ?` | `type: ALL`, 39,089 rows scanned | `type: ref`, 8 rows scanned |

Both confirmed by dropping the index, re-running `EXPLAIN`, then re-adding it and re-running `EXPLAIN` again — real before/after on the same data, not a projection.

---

## 13. Regression testing

- **Existing suite:** 164 tests, all still passing, unchanged.
- **New tests added (47):**
  - `server/databaseIntegrity.test.ts` (44 tests) — schema-shape tests using `getTableConfig()` from `drizzle-orm/mysql-core` (no live DB needed, so this runs in normal CI). Asserts all 42 relationships have the exact index + `onDelete`/`onUpdate` pair from §4, and that no relationship anywhere in the schema ever uses `cascade`.
  - `server/admin.test.ts` (+3 tests) — `deleteDummyUser` happy path, rejection of non-dummy users, and the new FK-conflict → `CONFLICT` error mapping from §5/§14.
- **Total: 211 tests, all passing.** `tsc --noEmit` clean. `vite build` + `esbuild` server bundle both clean.
- Quotation-workflow security tests (Phase 1) untouched and still passing — `quotationWorkflow.ts` was not modified.

---

## 14. Migration safety — what was and wasn't proven

**Proven, with real evidence, in this session:**
- The original 12 migrations apply cleanly to an empty database (re-verified from scratch this phase).
- The new migration correctly **fails** against data containing FK-shaping-violating orphans (`ER_NO_REFERENCED_ROW_2`), reproduced twice across two schema iterations.
- The new migration **succeeds** against orphan-free data, producing exactly 42 FKs and 42 indexes (verified via `information_schema`, not just CLI exit code).
- A concrete, real design bug (§5) was caught and fixed by testing against an actual database — this would not have been caught by schema review alone.
- App-level correctness: existing 164 tests + 47 new tests all pass against the updated schema; `tsc`/build both clean.

**A second real finding, important for the runbook:** MySQL/MariaDB DDL statements auto-commit individually. `drizzle-kit migrate`'s "transaction" wrapper cannot roll back `ALTER TABLE` statements that already succeeded when a later statement in the same migration file fails. This was observed twice: a failure partway through left 2 of 42 FK constraints already applied, with the migration correctly **not** recorded as applied in `__drizzle_migrations` (so a blind retry re-attempts all 42 statements and collides with the 2 already-present ones — a *different*, more confusing error than the original one). **This means partial-failure cleanup must be manual and is documented step-by-step in the runbook.**

**NOT proven, and cannot be from this session:**
- Whether real BuildHub production/staging data contains any of the orphan patterns in §1/§2. No such database is reachable.
- Migration behavior against a realistic production-sized, production-shaped dataset (only synthetic data was used).
- Anything about staging, since no staging environment exists (§0).

---

## Final test results

| Check | Result |
|---|---|
| Previous tests | 164 |
| New tests | 47 |
| Passed | 211 / 211 |
| Failed | 0 |
| Skipped | 0 |
| TypeScript (`tsc --noEmit`) | PASS |
| Frontend build (`vite build`) | PASS |
| Server build (`esbuild`) | PASS |
| Database migration (empty → 12 existing migrations) | PASS (real MariaDB) |
| Database migration (12 existing + new FK/index migration, orphan-free) | PASS (real MariaDB) |
| Database migration (fail-safe on orphaned data) | PASS — correctly rejected (real MariaDB) |
| Staging integrity | NOT VERIFIED — no staging environment exists (§0) |
| Performance verification | PASS — measured EXPLAIN before/after on synthetic bulk data (§12) |

## Final status: **PASS WITH CONDITIONS**

PASS is not available because a real orphan-data audit against actual BuildHub production/staging data has never been performed — no such database is reachable from this or any prior session in this engagement (§0). Everything that *can* be verified from this sandbox has been verified with real evidence, not simulated: the migration applies cleanly to an empty database, fails safely against orphaned data, succeeds against clean data, and a genuine design bug was caught and fixed by testing against a real database rather than schema review alone.

**Conditions that must be satisfied before this migration is applied to production:**
1. Run the orphan-detection audit from §2 against real production data (or a faithful snapshot of it) and record the actual counts.
2. If any orphans are found in the 12 NOT-NULL relationships (§3), make and document the remediation decision per row — do not proceed with an automatic default.
3. Re-run the full staged sequence (§11) against a real staging copy, not just the synthetic local database used in this session.
4. Only then apply to production, following `BUILDHUB_DATABASE_MIGRATION_RUNBOOK.md`.

No Stripe, email/SMS, or auth/infra work was started. No production system was touched. Stopping here per the phase's explicit instruction, pending authorization for the next phase.
