# BuildHub — Database Migration Runbook: Foreign Keys & Indexes (0012)

**Status: designed and proven in a sandbox environment. NOT executed against staging or production. Do not run the "Production" section until the conditions in `BUILDHUB_DATABASE_INTEGRITY_REPORT.md` §14 are satisfied.**

This runbook covers applying `drizzle/0012_broken_nightmare.sql` — 42 foreign keys + 42 indexes across all 20 tables (see the integrity report for the full relationship list and rationale).

## 0. What this migration does and doesn't do

Does: adds an index and a `FOREIGN KEY` constraint to every FK-shaped column in the schema, with `ON DELETE RESTRICT` (29 relationships) or `ON DELETE SET NULL` (13 relationships) and `ON UPDATE RESTRICT` everywhere. Zero `CASCADE`.

Does not: touch any existing data, drop any column, change any existing index, or modify `quotationWorkflow.ts`'s transaction logic.

**Behavioral change to be aware of:** once this migration is applied, `admin.deleteDummyUser` will start rejecting deletions of dummy users that have real dependent data (projects, quotations, messages, etc.) instead of silently orphaning it. This is intentional (see integrity report §5) and the endpoint now returns a clear `CONFLICT` error instead of a raw database error — but it is a visible behavior change for whoever uses that admin feature.

## 1. Two failure modes discovered while proving this migration — read before running anything

**Failure mode A: the migration will refuse to apply if orphaned rows exist.** This is by design (that's what a FOREIGN KEY constraint does) but MySQL's error is not self-explanatory:

```
Cannot add or update a child row: a foreign key constraint fails
(`<db>`.`<table>`, CONSTRAINT `<name>` FOREIGN KEY (`<col>`) REFERENCES `<parent>` (`id`))
```

If you see this, **do not retry the migration as-is.** Go to §3 (orphan audit) and §4 (partial-failure cleanup) first.

**Failure mode B: MySQL/MariaDB DDL statements auto-commit individually — a partial failure leaves earlier statements in the same migration file applied, even though the migration is (correctly) not recorded as complete.** Reproduced twice in the sandbox: a failure on the 3rd of 42 `ALTER TABLE ADD CONSTRAINT` statements left the first 2 constraints already present in the database. `drizzle-kit`'s migrate command does *not* roll these back — there is no multi-statement DDL transaction in MySQL to roll back. A blind retry will then fail differently (`ER_ROW_IS_REFERENCED_2`-style duplicate-constraint errors) because it tries to re-add constraints that already exist. **Always check `information_schema.TABLE_CONSTRAINTS` for constraints already applied before retrying — see §4.**

## 2. Pre-flight (any environment)

```bash
# Confirm which migrations are already applied
mysql -u<user> -p<db> -e "SELECT * FROM __drizzle_migrations ORDER BY id;"

# Confirm current FK/index state (should be 0 FKs before this migration has ever run)
mysql -u<user> -p<db> -e "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='<db>' AND CONSTRAINT_TYPE='FOREIGN KEY';"
```

## 3. Orphan audit (run this before every environment, including staging)

Run one query per relationship, adapted from the pattern below (full list of 42 relationships is in the integrity report §1):

```sql
SELECT '<child>.<col> -> <parent>.id' AS relationship, COUNT(*) AS orphans
FROM <child> c LEFT JOIN <parent> p ON c.<col> = p.id
WHERE <c.col IS NOT NULL AND> p.id IS NULL;
```

If every relationship returns 0: proceed to §5.

If any relationship returns > 0:
- **Nullable column** (13 of the 42 — see integrity report §4 for which): safe to remediate automatically. `UPDATE <child> SET <col> = NULL WHERE <col> NOT IN (SELECT id FROM <parent>);` — this is exactly what the `ON DELETE SET NULL` constraint would have done automatically at the time of deletion, applied retroactively.
- **NOT NULL column** (29 of the 42): **STOP.** Do not delete, reassign, or otherwise modify these rows without a human decision. Record: which table, which rows (IDs), which parent is missing, and how many. Escalate for a business decision (reassign to a placeholder user, hard-delete the child row if it's genuinely disposable, or restore the missing parent) before proceeding. Do not apply this migration against this database until every NOT NULL orphan is resolved — the migration will simply fail (Failure mode A) if you try.

## 4. Applying the migration

```bash
export DATABASE_URL="mysql://<user>:<pass>@<host>:<port>/<db>"
npx drizzle-kit migrate
```

**If it fails (Failure mode A or a fresh orphan you missed):**

1. Check what actually got applied before it failed:
   ```sql
   SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA='<db>' AND CONSTRAINT_TYPE='FOREIGN KEY';
   ```
2. Drop every constraint that got partially applied (each `ALTER TABLE <table> DROP FOREIGN KEY <name>;`), returning the schema to its pre-migration state.
3. Confirm `__drizzle_migrations` does NOT have a row for `0012_broken_nightmare` (it shouldn't, but verify — do not proceed if it does; that would mean the schema and the journal have diverged).
4. Resolve the orphan that caused the failure (§3).
5. Re-run `npx drizzle-kit migrate` from a clean state.

## 5. Post-migration verification

```sql
-- Expect 42
SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA='<db>' AND CONSTRAINT_TYPE='FOREIGN KEY';

-- Expect 42 distinct index names ending in _idx
SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='<db>' AND INDEX_NAME LIKE '%\_idx';

-- Re-run the orphan audit from §3 — expect 0 everywhere
```

Then run the application test suite and TypeScript build against this database (or against the updated schema, since the existing suite is mock-based and doesn't require a live DB connection):

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

All three must pass before considering the migration successful in this environment.

## 6. Rollback

Foreign keys and indexes only — no data was changed or removed by this migration, so rollback is a pure schema operation:

```sql
-- Drop all 42 FKs (see integrity report §4 for the full list of constraint names,
-- generated as `<table>_<column>_<parent>_id_fk`, or read them from
-- drizzle/0012_broken_nightmare.sql directly)
ALTER TABLE <table> DROP FOREIGN KEY <name>;
-- ... repeat for all 42

-- Drop all 42 indexes
ALTER TABLE <table> DROP INDEX <name>_idx;
-- ... repeat for all 42
```

Remove the corresponding row from `__drizzle_migrations` only if you are fully reverting and do not intend to re-apply — otherwise `drizzle-kit migrate` will think this migration is already applied and skip it on the next attempt.

## 7. Production — DO NOT RUN YET

This migration has been proven against a disposable local database with synthetic data only. It has **not** been run against staging (no staging environment exists — see integrity report §0) or against any copy of real production data. Per the integrity report's final status (PASS WITH CONDITIONS), do not run this against production until:

1. §3's orphan audit has been run against real production data (or a faithful snapshot) with actual counts recorded.
2. Any NOT NULL orphans found have a documented remediation decision — not a default assumption.
3. This full runbook has been executed successfully against a real staging copy first.
4. A database backup/restore point exists and has been confirmed restorable (NOT VERIFIED as of this phase — see `BUILDHUB_PHASE3B1_INFRASTRUCTURE_DISCOVERY.md`).

When those conditions are met, production application is: take a backup, run §2–§5 against production exactly as documented above, with a rollback plan (§6) ready and a maintenance window if the orphan audit in §3 turned up NOT NULL violations requiring downtime to fix.
