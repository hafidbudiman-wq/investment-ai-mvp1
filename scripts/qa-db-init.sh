#!/bin/sh
set -eu

: "${TARGET_PGHOST:?TARGET_PGHOST is required}"
: "${TARGET_PGPORT:?TARGET_PGPORT is required}"
: "${TARGET_PGUSER:?TARGET_PGUSER is required}"
: "${TARGET_PGPASSWORD:?TARGET_PGPASSWORD is required}"

export PGPASSWORD="$TARGET_PGPASSWORD"
attempt=0
until pg_isready -h "$TARGET_PGHOST" -p "$TARGET_PGPORT" -U "$TARGET_PGUSER"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "p0a_shadow_database_target_unavailable"
    exit 1
  fi
  sleep 2
done

if psql -h "$TARGET_PGHOST" -p "$TARGET_PGPORT" -U "$TARGET_PGUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='p0a_shadow'" | grep -q 1; then
  echo "p0a_shadow_database_already_exists"
else
  createdb -h "$TARGET_PGHOST" -p "$TARGET_PGPORT" -U "$TARGET_PGUSER" p0a_shadow
  echo "p0a_shadow_database_created"
fi

unset PGPASSWORD
