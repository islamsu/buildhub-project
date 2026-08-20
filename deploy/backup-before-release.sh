#!/usr/bin/env bash
# ── Pre-release database backup ────────────────────────────────────────────
#
# Called by .github/workflows/deploy-production.yml immediately before
# migrations run. Lives on the server at /srv/buildhub/ alongside .env and
# docker-compose.yml.
#
#   ./backup-before-release.sh <image-tag>
#
# Vultr Managed Databases keep their own scheduled backups, and those are the
# real disaster-recovery story. This one exists for a narrower and more likely
# problem: a migration that turns out to be wrong. A snapshot taken five minutes
# before it ran is worth more than one taken at 03:00, because it is the only
# copy that contains the last five minutes of customer data AND predates the
# change being reverted.
#
# The dump is VERIFIED before it is trusted. A backup nobody checked is a
# rumour, and the moment you find out it was empty is the moment you need it.
#
# mysqldump runs from a PINNED CLIENT IMAGE rather than from whatever happens to
# be installed on the host. The migration step in the deploy workflow already
# works this way, and the reason is the same: a host carrying MariaDB's client
# tools cannot dump a MySQL 8 server correctly - it rejects --set-gtid-purged
# and --ssl-mode outright - and discovering that during an incident is too late.
#
# --no-tablespaces because a managed database does not grant the application
# user the PROCESS privilege, and without it mysqldump errors out trying to dump
# tablespace metadata BuildHub does not use.

set -euo pipefail

IMAGE_TAG="${1:?usage: backup-before-release.sh <image-tag>}"
BACKUP_DIR="${BACKUP_DIR:-/srv/buildhub/backups}"
RETAIN="${BACKUP_RETAIN:-10}"
# Pinned so the client always matches the managed server, whatever the host has.
MYSQL_CLIENT_IMAGE="${MYSQL_CLIENT_IMAGE:-mysql:8.0}"
# REQUIRED everywhere real. Overridable only so the restore drill can run
# against a local container that has no certificate.
SSL_MODE="${DB_SSL_MODE:-REQUIRED}"

# DATABASE_URL is the single source of connection truth, same as the app's.
# Parsed rather than duplicated into separate host/user/password variables,
# because two places to change a password is one place to forget.
if [[ -z "${DATABASE_URL:-}" ]]; then
  set -a; . /srv/buildhub/.env; set +a
fi
: "${DATABASE_URL:?DATABASE_URL is not set and was not found in /srv/buildhub/.env}"

parse() { node -e '
  const u = new URL(process.env.DATABASE_URL);
  const field = process.argv[1];
  const value = { host: u.hostname, port: u.port || "3306", user: decodeURIComponent(u.username),
                  password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, "") }[field];
  process.stdout.write(value ?? "");
' "$1"; }

DB_HOST="$(parse host)"; DB_PORT="$(parse port)"
DB_USER="$(parse user)"; DB_PASS="$(parse password)"; DB_NAME="$(parse database)"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/buildhub-${STAMP}-${IMAGE_TAG}.sql.gz"

echo "[backup] dumping ${DB_NAME} from ${DB_HOST}:${DB_PORT} -> ${TARGET}"

# --single-transaction keeps the dump consistent without locking the site.
# --set-gtid-purged=OFF so the dump can be restored into a fresh instance.
# --ssl-mode=REQUIRED because the app requires it and a backup path that
# quietly does not is a hole in exactly the same wall.
docker run --rm --network host -e MYSQL_PWD="$DB_PASS" "$MYSQL_CLIENT_IMAGE" \
  mysqldump \
    --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
    --single-transaction --quick --routines --triggers --events \
    --no-tablespaces \
    --set-gtid-purged=OFF --ssl-mode="$SSL_MODE" \
    "$DB_NAME" | gzip -9 > "$TARGET"

# ── Verify, rather than assume ──────────────────────────────────────────────
if [[ ! -s "$TARGET" ]]; then
  echo "[backup] FAILED: the dump is empty" >&2
  rm -f "$TARGET"
  exit 1
fi

if ! gzip -t "$TARGET" 2>/dev/null; then
  echo "[backup] FAILED: the archive is corrupt" >&2
  rm -f "$TARGET"
  exit 1
fi

# A dump that ran out of disk halfway still gzips cleanly. mysqldump writes this
# marker as its final line, so its absence means truncation.
if ! gzip -dc "$TARGET" | tail -5 | grep -q "Dump completed"; then
  echo "[backup] FAILED: the dump is truncated - no completion marker" >&2
  rm -f "$TARGET"
  exit 1
fi

TABLES="$(gzip -dc "$TARGET" | grep -c '^CREATE TABLE' || true)"
if (( TABLES < 20 )); then
  echo "[backup] FAILED: only ${TABLES} tables in the dump; BuildHub has 28" >&2
  rm -f "$TARGET"
  exit 1
fi

echo "[backup] verified: ${TABLES} tables, $(du -h "$TARGET" | cut -f1)"

# ── Retention ───────────────────────────────────────────────────────────────
# Oldest first, keeping the most recent RETAIN. Deliberately does not touch
# anything it did not create.
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/buildhub-*.sql.gz 2>/dev/null | tail -n +"$((RETAIN + 1))")
for file in "${OLD[@]:-}"; do
  [[ -n "$file" ]] || continue
  echo "[backup] pruning $(basename "$file")"
  rm -f "$file"
done

echo "$TARGET" > "$BACKUP_DIR/.latest"
echo "[backup] done"
