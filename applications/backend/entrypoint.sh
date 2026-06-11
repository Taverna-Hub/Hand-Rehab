#!/bin/sh
set -eu

max_attempts="${MIGRATION_MAX_ATTEMPTS:-30}"
sleep_seconds="${MIGRATION_RETRY_SECONDS:-2}"
attempt=1

while [ "$attempt" -le "$max_attempts" ]; do
  if alembic upgrade head; then
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000
  fi

  echo "Alembic migration failed; retrying in ${sleep_seconds}s (${attempt}/${max_attempts})" >&2
  attempt=$((attempt + 1))
  sleep "$sleep_seconds"
done

echo "Alembic migration failed after ${max_attempts} attempts" >&2
exit 1
