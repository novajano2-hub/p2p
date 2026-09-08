#!/usr/bin/env node
/*
  Fails if prisma/migrations no longer produces the schema in schema.prisma:
  someone edited the schema without generating a migration, or edited a
  migration after the fact.

  This exists as a script rather than a one-line npm script because the shadow
  database URL has to be passed as an argument, and `"$SHADOW_DATABASE_URL"` in
  a package.json script is only expanded by a POSIX shell. npm runs scripts
  through cmd.exe on Windows, where it stays a literal and Prisma reports an
  unhelpful "relative URL without a base".
*/
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const shadowUrl = process.env.SHADOW_DATABASE_URL;
if (!shadowUrl) {
  console.error(
    "SHADOW_DATABASE_URL is not set.\n" +
      "It is a scratch database Prisma resets while comparing migrations, so it must\n" +
      "never point at one holding real rows. See .env.example.",
  );
  process.exit(1);
}

const cwd = fileURLToPath(new URL("..", import.meta.url));
const result = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--shadow-database-url",
    shadowUrl,
    "--exit-code",
  ],
  { cwd, stdio: "inherit", shell: process.platform === "win32" },
);

// migrate diff --exit-code: 0 no difference, 2 a difference, 1 an error.
if (result.status === 2) {
  console.error(
    "\nThe migrations and schema.prisma disagree.\n" +
      "Run `npm run db:migrate -- --name <change>` to generate the missing migration.",
  );
}
process.exit(result.status ?? 1);
