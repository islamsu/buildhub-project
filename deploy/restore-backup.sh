#!/usr/bin/env bash
# ── Restore a database backup ──────────────────────────────────────────────
#
# The counterpart nobody writes, which is why so many backups turn out to be
# unrestorable. Lives on the server at /srv/buildhub/.
#
#   ./restore-backup.sh                       # restore the most recent backup
#   ./restore-backup.sh <path-to-.sql.gz>     # restore a specific one
#   RESTORE_TARGET_DB=buildhub_drill ./restore-backup.sh   # restore elsewhere
#
# DESTRUCTIVE. It overwrites the target database, so it demands an explicit
# typed confirmation unless RESTORE_ASSUME_YES=1. Restoring the wrong dump over
# a live database is a worse day than the one that made you reach for it.
#
# RESTORE_TARGET_DB is how you rehearse: point it at a scratch database and the
# drill costs nothing and touches nothing real. Run it on a schedule. A backup
# that has never been restored is an assumption, not a safeguard.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/buildhub/backups}"
MYSQL_CLIENT_IMAGE="${MYSQL_CLIENT_IMAGE:-mysql:8.0}"
SSL_MODE="${DB_SSL_MODE:-REQUIRED}"

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
DB_USER="$(parse user)"; DB_PASS="$(parse password)"
TARGET_DB="${RESTORE_TARGET_DB:-$(parse database)}"

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" ]]; then
  ARCHIVE="$(cat "$BACKUP_DIR/.latest" 2>/dev/null || true)"
  [[ -n "$ARCHIVE" ]] || ARCHIVE="$(ls -1t "$BACKUP_DIR"/buildhub-*.sql.gz 2>/dev/null | head -1 || true)"
fi
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "[restore] no backup found in $BACKUP_DIR" >&2; exit 1; }

# Check the archive BEFORE dropping anything. Discovering the dump is corrupt
# after truncating the database is the worst possible ordering.
gzip -t "$ARCHIVE" 2>/dev/null || { echo "[restore] archive is corrupt: $ARCHIVE" >&2; exit 1; }
gzip -dc "$ARCHIVE" | tail -5 | grep -q "Dump completed" \
  || { echo "[restore] archive is truncated: $ARCHIVE" >&2; exit 1; }

echo "[restore] archive : $ARCHIVE"
echo "[restore] target  : ${TARGET_DB} on ${DB_HOST}:${DB_PORT}"

if [[ "${RESTORE_ASSUME_YES:-}" != "1" ]]; then
  echo
  echo "This will REPLACE every table in '${TARGET_DB}'."
  read -r -p "Type the database name to confirm: " typed
  [[ "$typed" == "$TARGET_DB" ]] || { echo "[restore] aborted"; exit 1; }
fi

# Same pinned client as the backup, for the same reason.
run_sql() {
  docker run --rm -i --network host -e MYSQL_PWD="$DB_PASS" "$MYSQL_CLIENT_IMAGE" \
    mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
      --ssl-mode="$SSL_MODE" "$@"
}

echo "[restore] recreating ${TARGET_DB}"
run_sql -e "DROP DATABASE IF EXISTS \`${TARGET_DB}\`; CREATE DATABASE \`${TARGET_DB}\` CHARACTER SET utf8mb4;"

echo "[restore] loading"
gzip -dc "$ARCHIVE" | run_sql "$TARGET_DB"

# ── Verify the restore, rather than trusting a zero exit code ───────────────
TABLES="$(run_sql -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${TARGET_DB}';")"
USERS="$(run_sql -N -B -e "SELECT COUNT(*) FROM \`${TARGET_DB}\`.users;" 2>/dev/null || echo "0")"
MIGRATIONS="$(run_sql -N -B -e "SELECT COUNT(*) FROM \`${TARGET_DB}\`.__drizzle_migrations;" 2>/dev/null || echo "0")"

echo "[restore] tables=${TABLES} users=${USERS} migrations_applied=${MIGRATIONS}"
if (( TABLES < 20 )); then
  echo "[restore] FAILED: only ${TABLES} tables restored" >&2
  exit 1
fi

echo "[restore] done"
