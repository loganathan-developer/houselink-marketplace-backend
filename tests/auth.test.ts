import { config, parse } from "dotenv";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { testDatabaseUrl } from "./test-database.js";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import express from "express";
import cookieParser from "cookie-parser";
import { SignJWT, decodeJwt } from "jose";

// Asynchronous probes keep the HTTP test server and keep-alive timers responsive.
async function runNode(args: string[], options: { env: NodeJS.ProcessEnv; timeout?: number; encoding?: string }) {
  return new Promise<{ status: number | null; stdout: string; stderr: string; error: undefined }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: options.env, timeout: options.timeout ?? 15000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr, error: undefined }));
  });
}

config({ path: ".env.test", quiet: true });
const applicationConfig = await readFile(new URL("../.env", import.meta.url), "utf8").then(parse).catch(() => ({} as Record<string, string>));
// Explicit test database only; each run additionally owns a unique schema.
// Mixed case verifies that both Prisma and raw authentication SQL honor schema quoting.
const schema = `Auth_test_${randomUUID().replaceAll("-", "")}`;
const url = testDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL ?? applicationConfig.DATABASE_URL);
url.searchParams.set("schema", schema);
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";
process.env.OTP_PROVIDER = "mock";
process.env.ENABLE_MOCK_OTP_RETRIEVAL = "true";
process.env.ALLOW_ANY_DEV_OTP = "false";
process.env.COOKIE_SECURE = "false";
process.env.COOKIE_SAME_SITE = "lax";
process.env.JWT_SECRET = "test-only-jwt-secret-not-for-production-12345";
process.env.OTP_HASH_SECRET = "test-only-otp-secret-not-for-production-12345";
process.env.JWT_ISSUER = "houselink-test";
process.env.JWT_AUDIENCE = "houselink-test-browser";
process.env.JWT_ALGORITHM = "HS256";
process.env.FRONTEND_ORIGIN = "http://localhost:3000";
process.env.ACCESS_TOKEN_EXPIRES_IN = "15m";
process.env.REFRESH_TOKEN_EXPIRES_IN = "7d";
process.env.OTP_MAX_ATTEMPTS = "5";
const pool = new pg.Pool({ connectionString: url.toString() });
const { prisma } = await import("../src/config/database.js");
const { env } = await import("../src/config/env.js");
const { default: app } = await import("../src/app.js");
const { hashOtp, advisoryLockKey } = await import("../src/modules/auth/otp/otp.utils.js");
const { hashRefreshToken, signAccessToken } = await import("../src/modules/auth/token.service.js");
const { authenticate, requireRole } = await import("../src/middleware/auth.middleware.js");
const { errorHandler } = await import("../src/middleware/error.middleware.js");
let server: ReturnType<typeof app.listen>;
let roleServer: ReturnType<typeof app.listen>;
let base: string;
let roleBase: string;
let phoneNumber = 1000000000;
const csrf = { "X-CSRF-Protection": "1", Origin: env.FRONTEND_ORIGIN };
let schemaCreated = false;

async function withEnv<T>(
  overrides: Partial<typeof env>,
  callback: () => Promise<T>,
): Promise<T> {
  const original = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, env[key as keyof typeof env]]),
  ) as Partial<typeof env>;
  Object.assign(env, overrides);
  try {
    return await callback();
  } finally {
    Object.assign(env, original);
  }
}

before(async () => {
  const client = await pool.connect();
  try {
    const database = await client.query("SELECT current_database() AS name");
    assert.equal(database.rows[0].name, url.pathname.slice(1));
    await client.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await client.query(`SET search_path TO "${schema}"`);
    const migrations = new URL("../prisma/migrations/", import.meta.url);
    for (const entry of (await readdir(migrations, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await client.query(await readFile(new URL(`${entry.name}/migration.sql`, migrations), "utf8"));
    }
  } finally { client.release(); }
  await prisma.role.createMany({ data: [{ code: "BUYER" }, { code: "ADMIN" }] });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  const roleApp = express();
  roleApp.use(cookieParser());
  roleApp.get("/admin", authenticate, requireRole("ADMIN"), (_req, res) => res.json({ ok: true }));
  roleApp.use(errorHandler);
  roleServer = roleApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => roleServer.once("listening", resolve));
  const roleAddress = roleServer.address();
  assert(roleAddress && typeof roleAddress !== "string");
  roleBase = `http://127.0.0.1:${roleAddress.port}`;
});

beforeEach(async () => {
  // Independent scenarios must not exhaust another scenario's IP budget.
  await prisma.rateLimitBucket.deleteMany();
});

after(async () => {
  for (const active of [server, roleServer]) {
    if (active) { active.closeAllConnections(); await new Promise<void>((resolve) => active.close(() => resolve())); }
  }
  await prisma.$disconnect();
  try {
    if (schemaCreated) {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      assert.equal((await pool.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount, 0);
    }
  } finally { await pool.end(); }
});

async function request(path: string, cookie = "", body?: unknown, method = body === undefined ? "GET" : "POST") {
  return fetch(`${base}/api/auth${path}`, {
    method, headers: { ...csrf, Cookie: cookie, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookies(response: Response) {
  const values = response.headers.getSetCookie();
  const cookie = values.map((value) => value.split(";")[0]).join("; ");
  const access = /access_token=([^;]+)/.exec(cookie)?.[1];
  const refresh = /refresh_token=([^;]+)/.exec(cookie)?.[1];
  assert(access && refresh);
  return { cookie, access, refresh, values };
}
async function login(phone = `+91${++phoneNumber}`) {
  const id = randomUUID();
  await prisma.otpChallenge.create({ data: {
    id, destination: phone, channel: "PHONE", purpose: "LOGIN",
    expiresAt: new Date(Date.now() + 300000),
    codeDigest: hashOtp({ challengeId: id, destination: phone, channel: "PHONE", purpose: "LOGIN", otp: "012345" }),
  } });
  const response = await request("/otp/verify", "", { phone, challengeId: id, otp: "012345" });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  return { ...cookies(response), challengeId: id, userId: body.data.user.id as string, phone, body, sessionId: decodeJwt(cookies(response).access).sid as string };
}

async function challenge(phone = `+91${++phoneNumber}`) {
  const id = randomUUID();
  await prisma.otpChallenge.create({ data: { id, destination: phone, channel: "PHONE", purpose: "LOGIN", expiresAt: new Date(Date.now() + 300000), codeDigest: hashOtp({ challengeId: id, destination: phone, channel: "PHONE", purpose: "LOGIN", otp: "012345" }) } });
  return { id, phone, otp: "012345" };
}

async function raceAtDatabaseLock(key: bigint, send: () => Promise<Response>, second = send) {
  const client = await pool.connect();
  const requests: Promise<Response>[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [key.toString()]);
    requests.push(send(), second());
    // Prove both HTTP requests are concurrently waiting inside their DB transactions.
    const deadline = performance.now() + 2500;
    let waiting = 0;
    while (performance.now() < deadline) {
      const locks = await client.query("SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND classid::bigint=$1 AND objid::bigint=$2 AND objsubid=1 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())", [((key >> 32n) & 0xffffffffn).toString(), (key & 0xffffffffn).toString()]);
      waiting = locks.rows[0].count;
      if (waiting === 2) break;
      await delay(25);
    }
    assert.equal(waiting, 2, "Both requests must overlap at the database lock");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [key.toString()]);
    client.release();
    await Promise.allSettled(requests);
  }
  return Promise.all(requests);
}

test("complete request/mock/verify flow consumes OTP and creates one BUYER session", async () => {
  const phone = `+91${++phoneNumber}`;
  const response = await request("/otp/request", "", { phone });
  assert.equal(response.status, 200);
  const requestBody = await response.json();
  assert.deepEqual(Object.keys(requestBody.data), ["challengeId"]);
  const id = requestBody.data.challengeId as string;
  assert.equal(await prisma.authIdentity.count({ where: { identifier: phone } }), 0);
  const mock = await request(`/otp/mock/${id}`);
  assert.equal(mock.status, 200);
  const otp = (await mock.json()).data.otp;
  const pending = await prisma.otpChallenge.findUniqueOrThrow({ where: { id } });
  assert.equal(pending.destination, phone);
  assert.equal(pending.channel, "PHONE");
  assert.equal(pending.purpose, "LOGIN");
  assert.equal(pending.consumedAt, null);
  assert.equal(pending.userId, null);
  assert(pending.expiresAt > new Date());
  assert.equal(pending.codeDigest, hashOtp({ challengeId: id, destination: phone, channel: "PHONE", purpose: "LOGIN", otp }));
  assert.notEqual(pending.codeDigest, otp);
  const verified = await request("/otp/verify", "", { phone, challengeId: id, otp });
  assert.equal(verified.status, 200);
  const auth = cookies(verified);
  const body = await verified.json();
  assert.deepEqual(body.data.user.roles, ["BUYER"]);
  const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id } });
  assert(row.consumedAt);
  assert.equal(row.userId, body.data.user.id);
  assert.equal(await prisma.authSession.count({ where: { userId: row.userId! } }), 1);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId! } });
  assert.equal(user.status, "ACTIVE");
  const identity = await prisma.authIdentity.findUniqueOrThrow({ where: { provider_identifier: { provider: "PHONE", identifier: phone } } });
  assert.equal(identity.userId, user.id);
  assert(identity.verifiedAt <= new Date());
  const assignments = await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } });
  assert.deepEqual(assignments.map(({ role }) => role.code), ["BUYER"]);
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: decodeJwt(auth.access).sid as string }, include: { refreshTokens: true } });
  assert.equal(session.userId, user.id);
  assert.equal(session.context, "CUSTOMER");
  assert.equal(session.revokedAt, null);
  assert.equal(session.refreshTokens.length, 1);
  const refresh = session.refreshTokens[0]!;
  assert.equal(refresh.tokenHash, hashRefreshToken(auth.refresh));
  assert.notEqual(refresh.tokenHash, auth.refresh);
  assert.equal(refresh.consumedAt, null);
  assert.equal(refresh.revokedAt, null);
  assert(refresh.expiresAt <= session.idleExpiresAt && refresh.expiresAt <= session.absoluteExpiresAt);
  const expiry = (cookie: string) => Date.parse(/Expires=([^;]+)/.exec(cookie)![1]!);
  assert.equal(expiry(auth.values.find((value) => value.startsWith("access_token="))!), decodeJwt(auth.access).exp! * 1000);
  assert.equal(expiry(auth.values.find((value) => value.startsWith("refresh_token="))!), Math.floor(refresh.expiresAt.getTime() / 1000) * 1000);
  assert.equal((await request("/me", auth.cookie)).status, 200);
});

test("development mock allow-any OTP accepts different 6-digit codes without mock retrieval", async () => {
  await withEnv({ NODE_ENV: "development", OTP_PROVIDER: "mock", ALLOW_ANY_DEV_OTP: true }, async () => {
    for (const otp of ["123456", "987654"] as const) {
      const phone = `+91${++phoneNumber}`;
      const response = await request("/otp/request", "", { phone });
      assert.equal(response.status, 200);
      const challengeId = (await response.json()).data.challengeId as string;
      const verified = await request("/otp/verify", "", { challengeId, otp });
      assert.equal(verified.status, 200, await verified.clone().text());
      assert.deepEqual((await verified.json()).data.user.roles, ["BUYER"]);
      assert(cookies(verified).access);
      assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } })).attemptCount, 0);
    }
  });
});

test("development mock allow-any OTP still rejects malformed codes during validation", async () => {
  await withEnv({ NODE_ENV: "development", OTP_PROVIDER: "mock", ALLOW_ANY_DEV_OTP: true }, async () => {
    const value = await challenge();
    for (const otp of ["abcdef", "12345", "1234567"] as const) {
      const response = await request("/otp/verify", "", { challengeId: value.id, otp });
      assert.equal(response.status, 400, otp);
    }
    assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: value.id } })).attemptCount, 0);
  });
});

test("allow-any OTP is gated by development, mock provider and explicit opt-in", async () => {
  for (const overrides of [
    { NODE_ENV: "test" as const, OTP_PROVIDER: "mock" as const, ALLOW_ANY_DEV_OTP: true },
    { NODE_ENV: "development" as const, OTP_PROVIDER: "sms" as const, ALLOW_ANY_DEV_OTP: true },
    { NODE_ENV: "development" as const, OTP_PROVIDER: "mock" as const, ALLOW_ANY_DEV_OTP: false },
  ]) {
    await withEnv(overrides, async () => {
      const value = await challenge();
      const response = await request("/otp/verify", "", { challengeId: value.id, otp: "999999" });
      assert.equal(response.status, 401, JSON.stringify(overrides));
      assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: value.id } })).attemptCount, 1);
    });
  }
});

for (const state of ["expired", "invalidated"] as const) {
  test(`${state} OTP rejects without consumption, user creation or session creation`, async () => {
    const value = await challenge();
    await prisma.otpChallenge.update({ where: { id: value.id }, data: state === "expired" ? { expiresAt: new Date(0) } : { invalidatedAt: new Date() } });
    const users = await prisma.user.count();
    const sessions = await prisma.authSession.count();
    const response = await request("/otp/verify", "", { phone: value.phone, challengeId: value.id, otp: value.otp });
    assert.equal(response.status, 401);
    assert.deepEqual(response.headers.getSetCookie(), []);
    const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: value.id } });
    assert.equal(row.consumedAt, null);
    assert.equal(row.attemptCount, 0);
    assert.equal(await prisma.user.count(), users);
    assert.equal(await prisma.authSession.count(), sessions);
  });
}

test("simultaneous OTP verification consumes once and creates exactly one user/session/token", async () => {
  const value = await challenge();
  const users = await prisma.user.count();
  const responses = await raceAtDatabaseLock(advisoryLockKey(`otp:PHONE:LOGIN:${value.phone}`), () => request("/otp/verify", "", { phone: value.phone, challengeId: value.id, otp: value.otp }));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
  assert.deepEqual(responses.find((response) => response.status === 401)!.headers.getSetCookie(), []);
  const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: value.id } });
  assert(row.consumedAt && row.userId);
  assert.equal(row.attemptCount, 0);
  assert.equal(await prisma.user.count(), users + 1);
  assert.equal(await prisma.authIdentity.count({ where: { identifier: value.phone } }), 1);
  assert.equal(await prisma.authSession.count({ where: { userId: row.userId } }), 1);
  assert.equal(await prisma.refreshToken.count({ where: { session: { userId: row.userId } } }), 1);
});

test("existing user login reuses user and identity while creating a new session", async () => {
  const first = await login();
  const users = await prisma.user.count();
  const second = await login(first.phone);
  assert.equal(second.userId, first.userId);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(await prisma.user.count(), users);
  assert.equal(await prisma.authIdentity.count({ where: { identifier: first.phone } }), 1);
  assert.equal(await prisma.authSession.count({ where: { userId: first.userId } }), 2);
});

for (const status of ["BLOCKED", "DELETED"] as const) {
  test(`${status} user cannot log in or create a session with a correct OTP`, async () => {
    const value = await challenge();
    const user = await prisma.user.create({ data: { status, identities: { create: { provider: "PHONE", identifier: value.phone, verifiedAt: new Date() } } } });
    const users = await prisma.user.count();
    const response = await request("/otp/verify", "", { phone: value.phone, challengeId: value.id, otp: value.otp });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "INVALID_OTP");
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.equal(await prisma.user.count(), users);
    assert.equal(await prisma.authIdentity.count({ where: { identifier: value.phone } }), 1);
    assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.refreshToken.count({ where: { session: { userId: user.id } } }), 0);
    assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: value.id } })).consumedAt, null);
  });
}

test("test database configuration refuses unsafe targets and application database reuse", () => {
  for (const value of [undefined, "postgresql://localhost/houselink_dev", "postgresql://remote.example/houselink_test", "postgresql://localhost/postgres", "postgresql://localhost/auth_test?host=remote.example"]) {
    assert.throws(() => testDatabaseUrl(value));
  }
  assert.throws(() => testDatabaseUrl("postgresql://localhost/auth_test?schema=isolated", "postgresql://127.0.0.1:5432/auth_test"));
  assert.equal(testDatabaseUrl("postgresql://localhost/auth_test").pathname, "/auth_test");
});

test("OTP login atomically stores session and hash, returns only HttpOnly cookies", async () => {
  const signed = await login();
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: signed.sessionId }, include: { refreshTokens: true } });
  assert.equal(session.userId, signed.userId);
  assert.equal(session.refreshTokens.length, 1);
  assert.equal(session.revokedAt, null);
  assert.equal(session.refreshTokens[0]!.consumedAt, null);
  assert.equal(session.refreshTokens[0]!.revokedAt, null);
  const challenge = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: signed.challengeId } });
  assert(challenge.consumedAt);
  assert.equal(challenge.userId, signed.userId);
  assert.equal(challenge.attemptCount, 0);
  assert.equal(session.refreshTokens[0]!.tokenHash, hashRefreshToken(signed.refresh));
  assert.notEqual(session.refreshTokens[0]!.tokenHash, signed.refresh);
  assert(signed.values.every((value) => value.includes("HttpOnly") && value.includes("SameSite=Lax") && !value.includes("Domain=")));
  assert(signed.values[0]!.includes("Path=/api;"));
  assert(signed.values[1]!.includes("Path=/api/auth;"));
  assert.deepEqual(Object.keys(decodeJwt(signed.access)).sort(), ["aud", "exp", "iat", "iss", "jti", "sid", "sub"]);
  assert.deepEqual(Object.keys(signed.body.data), ["user"]);
  const replay = await request("/otp/verify", "", { phone: signed.phone, challengeId: signed.challengeId, otp: "012345" });
  assert.equal(replay.status, 401);
  assert.equal(await prisma.authSession.count({ where: { userId: signed.userId } }), 1);
});

test("wrong OTP attempts commit and invalidate at the limit", async () => {
  const phone = `+91${++phoneNumber}`;
  const id = randomUUID();
  await prisma.otpChallenge.create({ data: { id, destination: phone, channel: "PHONE", purpose: "LOGIN", expiresAt: new Date(Date.now() + 300000), codeDigest: hashOtp({ challengeId: id, destination: phone, channel: "PHONE", purpose: "LOGIN", otp: "012345" }) } });
  for (let n = 0; n < env.OTP_MAX_ATTEMPTS; n++) {
    const response = await request("/otp/verify", "", { phone, challengeId: id, otp: "999999" });
    assert.equal(response.status, 401);
    assert.deepEqual(response.headers.getSetCookie(), []);
    const current = await prisma.otpChallenge.findUniqueOrThrow({ where: { id } });
    assert.equal(current.attemptCount, n + 1);
    assert.equal(current.consumedAt, null);
  }
  const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id } });
  assert.equal(row.attemptCount, env.OTP_MAX_ATTEMPTS);
  assert(row.invalidatedAt);
  assert.equal(await prisma.authIdentity.count({ where: { identifier: phone } }), 0);
  assert.equal((await request("/otp/verify", "", { phone, challengeId: id, otp: "012345" })).status, 401);
});

test("session insertion failure rolls back OTP consumption and new account", async () => {
  const phone = `+91${++phoneNumber}`;
  const id = randomUUID();
  await prisma.otpChallenge.create({ data: { id, destination: phone, channel: "PHONE", purpose: "LOGIN", expiresAt: new Date(Date.now() + 300000), codeDigest: hashOtp({ challengeId: id, destination: phone, channel: "PHONE", purpose: "LOGIN", otp: "012345" }) } });
  await pool.query(`CREATE FUNCTION "${schema}".reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`);
  await pool.query(`CREATE TRIGGER reject_session BEFORE INSERT ON "${schema}"."AuthSession" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_session()`);
  try {
    assert.equal((await request("/otp/verify", "", { phone, challengeId: id, otp: "012345" })).status, 500);
    assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id } })).consumedAt, null);
    assert.equal(await prisma.authIdentity.count({ where: { identifier: phone } }), 0);
  } finally {
    await pool.query(`DROP TRIGGER reject_session ON "${schema}"."AuthSession"`);
    await pool.query(`DROP FUNCTION "${schema}".reject_session()`);
  }
});

test("production cookies require Secure; mock flags parse correctly and production mock is refused", async () => {
  const code = `
    const { env } = await import('./src/config/env.ts');
    const { setAuthCookies, clearAuthCookies } = await import('./src/modules/auth/auth.cookies.ts');
    const options = [];
    const res = { cookie: (_name, _value, opts) => options.push(opts), clearCookie: (_name, opts) => options.push(opts) };
    setAuthCookies(res, { accessToken: 'test', refreshToken: 'test', accessExpiresAt: new Date(), refreshExpiresAt: new Date() });
    clearAuthCookies(res);
    console.log(JSON.stringify({ mockEnabled: env.ENABLE_MOCK_OTP_RETRIEVAL, allowAnyDevOtp: env.ALLOW_ANY_DEV_OTP, options }));
  `;
  const probe = (overrides: Record<string, string>) => runNode( ["--import", "tsx", "--input-type=module", "-e", code], {
    encoding: "utf8", env: { ...process.env, NODE_ENV: "production", OTP_PROVIDER: "sms", ENABLE_MOCK_OTP_RETRIEVAL: "false", ALLOW_ANY_DEV_OTP: "false", COOKIE_SECURE: "true", FRONTEND_ORIGIN: "https://shop.example.com", JWT_SECRET: randomBytes(32).toString("hex"), OTP_HASH_SECRET: randomBytes(32).toString("hex"), ...overrides },
  });
  const result = await probe({});
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mockEnabled, false);
  assert.equal(parsed.allowAnyDevOtp, false);
  assert(parsed.options.every((value: { secure: boolean; httpOnly: boolean }) => value.secure && value.httpOnly));
  assert.notEqual((await probe({ COOKIE_SECURE: "false" })).status, 0);
  assert.notEqual((await probe({ OTP_PROVIDER: "mock" })).status, 0);
  assert.notEqual((await probe({ ENABLE_MOCK_OTP_RETRIEVAL: "true" })).status, 0);
  assert.notEqual((await probe({ ALLOW_ANY_DEV_OTP: "true" })).status, 0);
  assert.notEqual((await probe({ NODE_ENV: "development", COOKIE_SECURE: "false", COOKIE_SAME_SITE: "none" })).status, 0);
  for (const overrides of [
    { FRONTEND_ORIGIN: "http://shop.example.com" }, { JWT_SECRET: "replace-with-secure-jwt-secret-value" },
    { DATABASE_URL: "https://example.com/db" }, { PORT: "65536" }, { TRUST_PROXY: "true" }, { TRUST_PROXY: "0.0.0.0/0" },
  ]) assert.notEqual((await probe(overrides)).status, 0);
  assert.equal((await probe({ TRUST_PROXY: "127.0.0.1,10.10.0.0/24" })).status, 0);
});

test("actual application startup rejects mock OTP in production", async () => {
  const result = await runNode( ["--import", "tsx", "src/server.ts"], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, NODE_ENV: "production", OTP_PROVIDER: "mock", ENABLE_MOCK_OTP_RETRIEVAL: "false", ALLOW_ANY_DEV_OTP: "false", COOKIE_SECURE: "true" },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OTP_PROVIDER cannot be 'mock' in production/);
  assert.doesNotMatch(result.stdout, /HouseLink API listening/);
});

test("missing/invalid CSRF rejects every auth mutation without changing PostgreSQL state", async () => {
  const signed = await login();
  const value = await challenge();
  const state = async () => ({
    otp: await prisma.otpChallenge.findUniqueOrThrow({ where: { id: value.id } }),
    session: await prisma.authSession.findUniqueOrThrow({ where: { id: signed.sessionId } }),
    token: await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(signed.refresh) } }),
    users: await prisma.user.count(), sessions: await prisma.authSession.count(), tokens: await prisma.refreshToken.count(),
  });
  const original = await state();
  for (const path of ["/otp/verify", "/refresh", "/logout", "/logout-all"]) {
    for (const variant of ["missing", "invalid", "hostile-origin"]) {
      const headers: Record<string, string> = { Cookie: signed.cookie, "Content-Type": "application/json", Origin: env.FRONTEND_ORIGIN };
      if (variant !== "missing") headers["X-CSRF-Protection"] = variant === "invalid" ? "wrong" : "1";
      if (variant === "hostile-origin") headers.Origin = "https://evil.example";
      const response = await fetch(`${base}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify({ phone: value.phone, challengeId: value.id, otp: value.otp }) });
      assert.equal(response.status, 403, `${path}: ${variant}`);
      assert.deepEqual(response.headers.getSetCookie(), []);
      assert.deepEqual(await state(), original);
    }
  }
});

test("refresh rotates once; old token reuse commits session revocation", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const signed = await login();
  const original = await prisma.authSession.findUniqueOrThrow({ where: { id: signed.sessionId } });
  const rotated = await request("/refresh", signed.cookie, {});
  assert.equal(rotated.status, 200);
  const next = cookies(rotated);
  assert.notEqual(next.refresh, signed.refresh);
  assert.notEqual(next.access, signed.access, "Refresh must issue a distinct access token even in the same second");
  assert.notEqual(decodeJwt(next.access).jti, decodeJwt(signed.access).jti);
  const old = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(signed.refresh) } });
  assert(old.consumedAt && old.replacedById);
  const replacement = await prisma.refreshToken.findUniqueOrThrow({ where: { id: old.replacedById } });
  assert.equal(replacement.tokenHash, hashRefreshToken(next.refresh));
  assert.equal(replacement.consumedAt, null);
  assert.equal(replacement.revokedAt, null);
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: signed.sessionId } });
  assert.equal(session.absoluteExpiresAt.getTime(), original.absoluteExpiresAt.getTime());
  assert.equal((await request("/me", next.cookie)).status, 200);
  assert.equal((await request("/refresh", signed.cookie, {})).status, 401);
  assert((await prisma.authSession.findUniqueOrThrow({ where: { id: signed.sessionId } })).revokedAt);
  assert.equal(await prisma.refreshToken.count({ where: { sessionId: signed.sessionId, revokedAt: null } }), 0);
  assert.equal((await request("/me", next.cookie)).status, 401);
  assert.equal((await request("/refresh", next.cookie, {})).status, 401);
});

test("simultaneous refresh requests produce one rotation and revoke on reuse", async () => {
  const signed = await login();
  const responses = await raceAtDatabaseLock(advisoryLockKey(`auth-user:${signed.userId}`), () => request("/refresh", signed.cookie, {}));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
  assert.equal(await prisma.refreshToken.count({ where: { sessionId: signed.sessionId } }), 2);
  assert.equal(await prisma.refreshToken.count({ where: { sessionId: signed.sessionId, consumedAt: { not: null } } }), 1);
  assert.equal(await prisma.refreshToken.count({ where: { sessionId: signed.sessionId, revokedAt: null } }), 0);
  assert((await prisma.authSession.findUniqueOrThrow({ where: { id: signed.sessionId } })).revokedAt);
});

test("refresh rejects expired/revoked tokens, expired/revoked sessions, blocked/deleted users", async () => {
  for (const mode of ["token-expired", "token-revoked", "session-expired", "session-idle", "session-revoked", "BLOCKED", "DELETED"] as const) {
    const signed = await login();
    const past = new Date(Date.now() - 10000);
    if (mode === "token-expired") await prisma.refreshToken.updateMany({ where: { sessionId: signed.sessionId }, data: { expiresAt: past } });
    if (mode === "token-revoked") await prisma.refreshToken.updateMany({ where: { sessionId: signed.sessionId }, data: { revokedAt: past } });
    if (mode === "session-expired") await prisma.authSession.update({ where: { id: signed.sessionId }, data: { absoluteExpiresAt: past } });
    if (mode === "session-idle") await prisma.authSession.update({ where: { id: signed.sessionId }, data: { idleExpiresAt: past } });
    if (mode === "session-revoked") await prisma.authSession.update({ where: { id: signed.sessionId }, data: { revokedAt: past } });
    if (mode === "BLOCKED" || mode === "DELETED") await prisma.user.update({ where: { id: signed.userId }, data: { status: mode } });
    assert.equal((await request("/refresh", signed.cookie, {})).status, 401, mode);
    if (!mode.startsWith("token")) assert.equal((await request("/me", signed.cookie)).status, 401, mode);
  }
  assert.equal((await request("/refresh", "", {})).status, 401);
});

test("authentication validates signature, claims, issuer, audience, algorithm, session and expiry", async () => {
  const signed = await login();
  const key = new TextEncoder().encode(env.JWT_SECRET);
  const jwt = (overrides = {}, secret = key, alg = "HS256") => new SignJWT({ sub: signed.userId, sid: signed.sessionId, iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), ...overrides }).setProtectedHeader({ alg, typ: "JWT" }).sign(secret);
  const badTokens = [
    signed.access.slice(0, -8) + "tampered",
    await jwt({ exp: 1 }), await jwt({ iss: "wrong" }), await jwt({ aud: "wrong" }),
    await jwt({}, new TextEncoder().encode("a".repeat(32))), await jwt({}, key, "HS384"),
    await jwt({ sid: randomUUID() }), await jwt({ sid: 123 }), await jwt({ sub: randomUUID() }),
  ];
  assert.equal((await request("/me")).status, 401);
  for (const token of badTokens) assert.equal((await request("/me", `access_token=${token}`)).status, 401);
  const me = await request("/me", signed.cookie);
  assert.equal(me.status, 200);
  assert.equal(me.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys((await me.json()).data.user).sort(), ["id", "name", "roles", "status"]);
});

test("authorization reads current database roles and denies by default", async () => {
  const signed = await login();
  const adminRequest = () => fetch(`${roleBase}/admin`, { headers: { Cookie: signed.cookie } });
  assert.equal((await fetch(`${roleBase}/admin`)).status, 401);
  assert.equal((await adminRequest()).status, 403);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  await prisma.userRole.create({ data: { userId: signed.userId, roleId: role.id } });
  assert.equal((await adminRequest()).status, 403, "Customer OTP cannot authorize ADMIN even when the account has the role");
  await prisma.authSession.update({ where: { id: signed.sessionId }, data: { context: "STAFF" } });
  assert.equal((await adminRequest()).status, 403, "Staff context without MFA is insufficient");
  await prisma.authSession.update({ where: { id: signed.sessionId }, data: { mfaVerifiedAt: new Date() } });
  assert.equal((await adminRequest()).status, 200);
  await prisma.userRole.delete({ where: { userId_roleId: { userId: signed.userId, roleId: role.id } } });
  assert.equal((await adminRequest()).status, 403);
});

test("logout revokes immediately, clears matching cookies, is idempotent, supports expired access", async () => {
  const signed = await login();
  const expired = await signAccessToken(signed.userId, signed.sessionId, new Date(Date.now() - 10000));
  const response = await request("/logout", `access_token=${expired}; refresh_token=${signed.refresh}`, {});
  assert.equal(response.status, 200);
  const cleared = response.headers.getSetCookie();
  assert.equal(cleared.length, 2);
  assert(cleared[0]!.includes("Path=/api;") && cleared[1]!.includes("Path=/api/auth;"));
  assert(cleared.every((value) => value.includes("HttpOnly") && value.includes("Expires=Thu, 01 Jan 1970")));
  assert.equal((await request("/me", signed.cookie)).status, 401);
  assert.equal((await request("/refresh", signed.cookie, {})).status, 401);
  assert((await prisma.authSession.findUniqueOrThrow({ where: { id: signed.sessionId } })).revokedAt);
  assert.equal(await prisma.refreshToken.count({ where: { sessionId: signed.sessionId, revokedAt: null } }), 0);
  assert.equal((await request("/logout", signed.cookie, {})).status, 200);
  assert.equal((await request("/logout", "", {})).status, 200);
});

test("logout-all invalidates other device sessions", async () => {
  const first = await login();
  const second = await login(first.phone);
  assert.equal(first.userId, second.userId);
  assert.equal((await request("/logout-all", first.cookie, {})).status, 200);
  assert.equal(await prisma.authSession.count({ where: { userId: first.userId, revokedAt: null } }), 0);
  assert.equal(await prisma.refreshToken.count({ where: { session: { userId: first.userId }, revokedAt: null } }), 0);
  for (const signed of [first, second]) {
    assert.equal((await request("/me", signed.cookie)).status, 401);
    assert.equal((await request("/refresh", signed.cookie, {})).status, 401);
  }
});

test("CSRF, exact CORS, body limit, mock delivery and shared rate limiting", async () => {
  assert.equal((await fetch(`${base}/api/auth/logout`, { method: "POST" })).status, 403);
  assert.equal((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...csrf, Origin: "https://evil.example" } })).status, 403);
  const preflight = await fetch(`${base}/api/auth/refresh`, { method: "OPTIONS", headers: { Origin: env.FRONTEND_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "X-CSRF-Protection" } });
  assert.equal(preflight.headers.get("access-control-allow-origin"), env.FRONTEND_ORIGIN);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  assert.equal((await request("/otp/verify", "", { padding: "x".repeat(20000) })).status, 413);
  const response = await request("/otp/request", "", { phone: `+91${++phoneNumber}` });
  assert.equal(response.status, 200);
  const id = (await response.json()).data.challengeId;
  const mock = await request(`/otp/mock/${id}`);
  assert.equal(mock.status, 200);
  assert.match((await mock.json()).data.otp, /^\d{6}$/);
  await prisma.rateLimitBucket.updateMany({ data: { hits: 10000 } });
  assert.equal((await request("/me")).status, 429);
  await prisma.rateLimitBucket.updateMany({ data: { expiresAt: new Date(0) } });
  assert.equal((await request("/me")).status, 401);
});

test("health, readiness, security headers, JSON errors and 404 use safe responses", async () => {
  for (const path of ["health", "ready"]) {
    const response = await fetch(`${base}/api/${path}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("x-request-id")!, /^[a-f0-9-]{36}$/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const missing = await fetch(`${base}/api/missing`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).success, false);
  const malformed = await fetch(`${base}/api/auth/otp/request`, { method: "POST", headers: { ...csrf, "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "INVALID_JSON");
});

test("OTP validation requires challenge UUID and a string code, rejects roles and unsupported purposes", async () => {
  const value = await challenge();
  const valid = { phone: value.phone, challengeId: value.id, otp: value.otp };
  for (const body of [
    { phone: value.phone, otp: value.otp }, { ...valid, challengeId: "not-a-uuid" },
    { ...valid, otp: 12345 }, { ...valid, otp: "12345" }, { ...valid, roles: ["ADMIN"] },
    { ...valid, channel: "EMAIL" }, { ...valid, purpose: "LINK_IDENTITY" },
    { ...valid, email: "user@example.com" },
  ]) assert.equal((await request("/otp/verify", "", body)).status, 400);
  for (const body of [{ phone: "123" }, { email: "invalid" }, { phone: value.phone, role: "SELLER" }, { phone: value.phone, purpose: "LINK_IDENTITY" }]) {
    assert.equal((await request("/otp/request", "", body)).status, 400);
  }
  assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: value.id } })).attemptCount, 0);
});

test("OTP verification is bound to challenge ID, normalized destination, channel and purpose", async () => {
  const value = await challenge();
  for (const body of [
    { phone: value.phone, challengeId: randomUUID(), otp: value.otp },
    { phone: `+91${++phoneNumber}`, challengeId: value.id, otp: value.otp },
    { email: "user@example.com", challengeId: value.id, otp: value.otp },
  ]) assert.equal((await request("/otp/verify", "", body)).status, 401);
  await prisma.otpChallenge.update({ where: { id: value.id }, data: { purpose: "LINK_IDENTITY" } });
  assert.equal((await request("/otp/verify", "", { phone: value.phone, challengeId: value.id, otp: value.otp })).status, 401);
  assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: value.id } })).attemptCount, 0);
});

test("email OTP normalizes case, binds the HMAC channel, creates BUYER and reuses the identity", async () => {
  const email = `Audit+${randomUUID()}@Example.COM`;
  const normalized = email.toLowerCase();
  const response = await request("/otp/request", "", { email: ` ${email} `, purpose: "LOGIN", channel: "EMAIL" });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  const mock = await request(`/otp/mock/${data.challengeId}`);
  const otp = (await mock.json()).data.otp as string;
  const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: data.challengeId } });
  assert.equal(row.destination, normalized);
  assert.equal(row.channel, "EMAIL");
  assert.equal(row.codeDigest, hashOtp({ challengeId: row.id, destination: normalized, channel: "EMAIL", purpose: "LOGIN", otp }));
  assert.notEqual(row.codeDigest, hashOtp({ challengeId: row.id, destination: normalized, channel: "PHONE", purpose: "LOGIN", otp }));
  const verified = await request("/otp/verify", "", { email, challengeId: row.id, otp });
  assert.equal(verified.status, 200);
  const user = (await verified.json()).data.user;
  assert.deepEqual(user.roles, ["BUYER"]);
  assert.equal(user.email, normalized);
  assert.equal((await request("/me", cookies(verified).cookie)).status, 200);
  await prisma.otpChallenge.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 120000) } });
  const next = await request("/otp/request", "", { email: normalized });
  assert.equal(next.status, 200);
  const nextId = (await next.json()).data.challengeId;
  const nextOtp = (await (await request(`/otp/mock/${nextId}`)).json()).data.otp;
  const again = await request("/otp/verify", "", { email: normalized, challengeId: nextId, otp: nextOtp });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).data.user.id, user.id);
  assert.equal(await prisma.authIdentity.count({ where: { provider: "EMAIL", identifier: normalized } }), 1);
});

for (const status of ["BLOCKED", "DELETED"] as const) {
  test(`${status} email account is rejected without recreation`, async () => {
    const email = `${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { status, identities: { create: { provider: "EMAIL", identifier: email, verifiedAt: new Date() } } } });
    const id = randomUUID();
    await prisma.otpChallenge.create({ data: { id, destination: email, channel: "EMAIL", purpose: "LOGIN", expiresAt: new Date(Date.now() + 300000), codeDigest: hashOtp({ challengeId: id, destination: email, channel: "EMAIL", purpose: "LOGIN", otp: "012345" }) } });
    const response = await request("/otp/verify", "", { email, challengeId: id, otp: "012345" });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "INVALID_OTP");
    assert.equal(await prisma.authIdentity.count({ where: { identifier: email } }), 1);
    assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), 0);
  });
}

test("resend cooldown survives consumption; resend invalidates old challenges and destination cap applies", async () => {
  const phone = `+91${++phoneNumber}`;
  const response = await request("/otp/request", "", { phone: ` ${phone.slice(0, 3)} (${phone.slice(3, 7)})-${phone.slice(7)} ` });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.deepEqual(Object.keys(data), ["challengeId"]);
  assert.equal((await request("/otp/request", "", { phone })).status, 429);
  await prisma.otpChallenge.update({ where: { id: data.challengeId }, data: { consumedAt: new Date() } });
  assert.equal((await request("/otp/request", "", { phone })).status, 429);
  await prisma.otpChallenge.update({ where: { id: data.challengeId }, data: { consumedAt: null, createdAt: new Date(Date.now() - 120000) } });
  const next = await request("/otp/request", "", { phone });
  assert.equal(next.status, 200);
  assert((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: data.challengeId } })).invalidatedAt);
  for (let n = 2; n < env.OTP_DESTINATION_MAX_PER_WINDOW; n++) {
    await prisma.otpChallenge.create({ data: { destination: phone, channel: "PHONE", purpose: "LOGIN", expiresAt: new Date(), codeDigest: "test-fixture", createdAt: new Date(Date.now() - 120000) } });
  }
  await prisma.otpChallenge.updateMany({ where: { destination: phone }, data: { createdAt: new Date(Date.now() - 120000) } });
  const limited = await request("/otp/request", "", { phone });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "OTP_DESTINATION_RATE_LIMITED");
});

test("concurrent OTP requests create one challenge; concurrent wrong guesses persist both attempts", async () => {
  const phone = `+91${++phoneNumber}`;
  const responses = await raceAtDatabaseLock(advisoryLockKey(`otp:PHONE:LOGIN:${phone}`), () => request("/otp/request", "", { phone }));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 429]);
  assert.equal(await prisma.otpChallenge.count({ where: { destination: phone } }), 1);
  const value = await challenge();
  const wrong = await raceAtDatabaseLock(advisoryLockKey(`otp:PHONE:LOGIN:${value.phone}`), () => request("/otp/verify", "", { phone: value.phone, challengeId: value.id, otp: "999999" }));
  assert(wrong.every((response) => response.status === 401));
  assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: value.id } })).attemptCount, 2);
});

test("provider failure invalidates challenge, reveals no provider details and preserves cooldown", async (context) => {
  const { otpProvider } = await import("../src/modules/auth/otp/otp-provider.factory.js");
  const stub = context.mock.method(otpProvider, "sendOtp", async () => { throw new Error("private-provider-error"); });
  const phone = `+91${++phoneNumber}`;
  try {
    const response = await request("/otp/request", "", { phone });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private-provider-error|stack|Prisma/);
    const row = await prisma.otpChallenge.findFirstOrThrow({ where: { destination: phone } });
    assert(row.invalidatedAt);
    assert.equal(await prisma.authIdentity.count({ where: { identifier: phone } }), 0);
    assert.equal((await request("/otp/request", "", { phone })).status, 429);
  } finally { stub.mock.restore(); }
});

test("CSRF requires trusted Origin or Referer as well as the custom header", async () => {
  for (const headers of [
    { "X-CSRF-Protection": "1" },
    { "X-CSRF-Protection": "1", Referer: "https://evil.example/path" },
    { "X-CSRF-Protection": "1", Origin: "null", Referer: `${env.FRONTEND_ORIGIN}/page` },
    { "X-CSRF-Protection": "1", Referer: `${env.FRONTEND_ORIGIN}.evil.example/` },
  ]) assert.equal((await fetch(`${base}/api/auth/logout`, { method: "POST", headers })).status, 403);
  assert.equal((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { "X-CSRF-Protection": "1", Referer: `${env.FRONTEND_ORIGIN}/page` } })).status, 200);
});

for (const endpoint of ["/logout", "/logout-all"]) {
  test(`${endpoint} racing refresh leaves no usable token or access session`, async () => {
    const first = await login();
    const other = endpoint === "/logout-all" ? await login(first.phone) : first;
    const responses = await raceAtDatabaseLock(advisoryLockKey(`auth-user:${first.userId}`),
      () => request(endpoint, first.cookie, {}), () => request("/refresh", other.cookie, {}));
    assert.equal(responses[0]!.status, 200);
    assert([200, 401].includes(responses[1]!.status));
    assert.equal(await prisma.authSession.count({ where: { userId: first.userId, revokedAt: null } }), 0);
    assert.equal(await prisma.refreshToken.count({ where: { session: { userId: first.userId }, revokedAt: null } }), 0);
    for (const cookie of [first.cookie, other.cookie, ...(responses[1]!.status === 200 ? [cookies(responses[1]!).cookie] : [])]) {
      assert.equal((await request("/me", cookie)).status, 401);
      assert.equal((await request("/refresh", cookie, {})).status, 401);
    }
  });
}

test("invalid, unknown and oversized refresh tokens are rejected", async () => {
  for (const token of ["invalid", "a".repeat(43), "a".repeat(500)]) {
    const response = await request("/refresh", `refresh_token=${token}`, {});
    assert.equal(response.status, 401);
    assert.deepEqual(response.headers.getSetCookie(), []);
  }
});

test("mock route is not mounted when disabled and rejects non-loopback access", async () => {
  const { getDevelopmentMockOtp } = await import("../src/modules/auth/auth.service.js");
  assert.throws(() => getDevelopmentMockOtp(randomUUID(), "203.0.113.7"), /localhost/);
  assert.throws(() => getDevelopmentMockOtp(randomUUID(), undefined), /localhost/);
  const code = `const { default: router } = await import('./src/modules/auth/auth.routes.ts');
    console.log(router.stack.some(layer => layer.route?.path === '/otp/mock/:challengeId'));`;
  const result = await runNode( ["--import", "tsx", "--input-type=module", "-e", code], {
    encoding: "utf8", timeout: 15000, env: { ...process.env, ENABLE_MOCK_OTP_RETRIEVAL: "false" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "false");
});
