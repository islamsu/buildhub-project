# BuildHub — Backup, Restore and Rollback Runbook

Everything here has been executed against a real MySQL 8 instance, not written
from memory. The drill results are at the bottom.

---

## The two things that can go wrong on a release

**The image is bad.** The application starts but misbehaves. Recovery is fast
and lossless: roll back to the previous image.

**The migration is bad.** The schema changed under live data. Recovery needs the
pre-release backup, and it is not lossless — anything written after the backup is
gone. This is the case worth rehearsing.

The deploy workflow already handles the first automatically: it records the
running image before releasing, and on a failed smoke test it restores that
image and fails the run. It does **not** revert migrations automatically, and
deliberately so — an automatic schema revert during an incident is how you lose
the data you were trying to save.

---

## Before every production release (automatic)

`.github/workflows/deploy-production.yml` runs `deploy/backup-before-release.sh`
immediately before migrations. The backup is tagged with the image being
released, so the dump and the change it precedes are linked by name.

It **verifies its own output** rather than trusting an exit code:

| Check | Catches |
|---|---|
| file is non-empty | the dump never started |
| `gzip -t` passes | truncated or corrupt archive |
| ends with `Dump completed` | ran out of disk halfway (still gzips cleanly) |
| at least 20 `CREATE TABLE` | connected to the wrong database |

A failure at any of these deletes the bad archive and aborts the release before
migrations run.

Ten backups are retained by default (`BACKUP_RETAIN`). Vultr Managed Databases
keep their own scheduled backups — those are the disaster-recovery story. These
are for the narrower, likelier problem of a migration that turns out to be wrong.

---

## Rolling back a bad image

Automatic on a failed smoke test. To do it by hand:

```bash
ssh user@production-host
cd /srv/buildhub
docker compose --env-file .env --env-file .image.env.previous up -d --pull always
```

Then re-run the smoke suite from your machine:

```bash
node scripts/smoke.mjs https://buildhub.example.com
```

`.image.env.previous` is written on every release, so there is always exactly
one rollback target: the image that was running before this deploy.

---

## Restoring a backup

```bash
ssh user@production-host
cd /srv/buildhub

./restore-backup.sh                    # most recent backup
./restore-backup.sh backups/<file>     # a specific one
```

It is **destructive** and demands you type the database name to confirm. It
checks the archive is intact **before** dropping anything — discovering a corrupt
dump after truncating the database is the worst possible ordering.

After restoring, verify and re-release the matching image:

```bash
docker compose --env-file .env --env-file .image.env.previous up -d --pull always
node scripts/smoke.mjs https://buildhub.example.com
```

---

## The restore drill — run this quarterly

A backup that has never been restored is an assumption. `RESTORE_TARGET_DB`
points the restore at a scratch database, so the drill touches nothing real:

```bash
ssh user@production-host
cd /srv/buildhub
RESTORE_TARGET_DB=buildhub_drill RESTORE_ASSUME_YES=1 ./restore-backup.sh
```

Expect `tables=28`, a plausible `users=` count, and `migrations_applied=19` (or
higher as migrations are added). Drop the scratch database afterwards.

If the restore fails, **the backups are not working** and that is a production
incident in its own right, whether or not anything else is wrong today.

---

## Drill results — 20 August 2026

Executed against MySQL 8.0.46, using the real scripts, not a simulation.

| Step | Result |
|---|---|
| Backup | 28 tables verified, archive intact, completion marker present |
| Destroy (simulating a bad migration) | `tables=0` |
| Restore | `tables=28 users=2 migrations_applied=19` |
| Data integrity | both seeded users returned; RFQ budget exactly `424242.00` |
| Structure integrity | 51 foreign keys, 98 indexes — identical to pre-backup |
| Application against the restored database | smoke suite **9/9 passed** |

Two real defects were found and fixed by running it:

**`backup-before-release.sh` did not exist.** The production workflow called it
by name. The release would have failed at the step immediately before migrations.
A test now asserts every `./*.sh` a workflow invokes is present in `deploy/`.

**mysqldump needs `--no-tablespaces`.** Without it, it fails on the `PROCESS`
privilege, which a managed database does not grant the application user. Both
scripts also now run the client from a **pinned image** rather than the host's,
because a host carrying MariaDB's client tools cannot dump a MySQL 8 server at
all — it rejects `--set-gtid-purged` and `--ssl-mode` outright.

---

## What still needs your action

- Confirm Vultr's own scheduled backups are enabled on the managed database, and
  note the retention window.
- Put `backups/` on a volume that is not the application disk, so a full disk
  cannot destroy both at once.
- Schedule the quarterly drill and record the date it was last run.
