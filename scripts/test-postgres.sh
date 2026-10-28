#!/bin/sh
# Runs src/server/postgres.test.ts against a throwaway PostgreSQL cluster: a temporary data directory, loopback only,
# a random port, trust auth for a local test user, deleted when the run ends. Nothing outside the temp directory is touched.
#   npm run test:postgres
# Needs initdb and pg_ctl on PATH (e.g. `brew install postgresql@17`). To use a server you already run, skip this script and set TEND_TEST_DATABASE_URL.
set -eu
# Some environments carry an invalid locale (initdb and the postmaster refuse to start with it).
export LC_ALL=C
for b in initdb pg_ctl; do
  command -v "$b" >/dev/null 2>&1 || { echo "$b not found. Install PostgreSQL, or set TEND_TEST_DATABASE_URL to a local server and run the test file directly." >&2; exit 2; }
done
DIR=$(mktemp -d)
PORT=$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
cleanup() { pg_ctl -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT INT TERM
initdb -D "$DIR/data" -U tend_test --auth=trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PORT -h 127.0.0.1 -k $DIR" -l "$DIR/server.log" -w start >/dev/null
TEND_TEST_DATABASE_URL="postgres://tend_test@127.0.0.1:$PORT/postgres" node --no-warnings --test src/server/postgres.test.ts
