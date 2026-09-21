import "dotenv/config";
import pg from "pg";

// This provisioning command can only use the local development server.
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.endsWith("_dev")) {
  throw new Error("Local development PostgreSQL required for test provisioning");
}
url.pathname = "/postgres";
url.search = "";
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  const name = "houselink_auth_step15_test";
  if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [name])).rowCount) {
    await client.query("CREATE ROLE houselink_auth_step15_test LOGIN PASSWORD 'houselink-test-only-local' NOSUPERUSER NOCREATEDB NOCREATEROLE");
  }
  if (!(await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [name])).rowCount) {
    await client.query("CREATE DATABASE houselink_auth_step15_test OWNER houselink_auth_step15_test");
  }
  console.log("Dedicated local authentication test database ready");
} finally { await client.end(); }
