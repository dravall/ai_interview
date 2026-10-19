// Creates the test database named in .env.test (if missing) and applies all
// migrations to it. Run via `bun run test:setup`, which sets NODE_ENV=test so
// Bun loads .env.test.
import { $ } from "bun";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
const database = url.pathname.slice(1);
if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error(`Unexpected database name: ${database}`);

const admin = new URL(url);
admin.pathname = "/postgres";
const client = new Client({ connectionString: admin.toString() });
await client.connect();
const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${database}"`);
    console.log(`Created database ${database}`);
}
await client.end();

await $`bunx prisma migrate deploy`.env({ ...process.env, DATABASE_URL: url.toString() });
