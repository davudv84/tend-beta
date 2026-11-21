#!/usr/bin/env node
// Prints the SQL that gives a separate, least-privilege role to the application (see docs/database-roles.md).
//   node scripts/db-grants.mjs tend_app | psql "$OWNER_DATABASE_URL"
import { runtimeGrantsSql } from "../src/server/db.ts";
const role = process.argv[2];
if (!role) { console.error("Usage: node scripts/db-grants.mjs <role name>   (the role must already exist: NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS)"); process.exit(1); }
console.log(runtimeGrantsSql(role));
