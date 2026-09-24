import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { TOTP, Secret } from "otpauth";

// This is a real HTTP/CLI smoke check against the migrated development database.
// Only its uniquely identified accounts and records are removed in finally.
if (process.env.NODE_ENV !== "development") throw new Error("Smoke verification requires explicit NODE_ENV=development.");
const runId = randomUUID();
const email = `day8-smoke-${runId}@example.test`;
const buyerEmail = `day8-buyer-${runId}@example.test`;
const password = randomBytes(32).toString("hex");
process.env.ADMIN_MFA_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
process.env.ENABLE_MOCK_OTP_RETRIEVAL = "true";
const { env } = await import("../src/config/env.js");
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.DATABASE_URL).hostname)) throw new Error("Smoke verification requires a loopback development database.");
if (env.OTP_PROVIDER !== "mock") throw new Error("Smoke verification requires local mock OTP delivery.");
const { prisma } = await import("../src/config/database.js");
const { default: app } = await import("../src/app.js");
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
let adminCookie = "", buyerCookie = "";
let categoryId: string | undefined, attributeId: string | undefined;
const brandIds: string[] = [];
let checks = 0;

async function request(method: string, path: string, body?: unknown, expected = 200, buyer = false) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1", Origin: env.FRONTEND_ORIGIN, Cookie: buyer ? buyerCookie : adminCookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, expected, `${method} ${path}: unexpected HTTP ${response.status}`);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) {
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    if (buyer) buyerCookie = cookie; else adminCookie = cookie;
  }
  checks++;
  console.log(`PASS ${method} ${path} (${expected})`);
  return response.json();
}

try {
  const child = spawn(process.execPath, ["--import", "tsx", "prisma/provision-admin.ts"], {
    env: { ...process.env, DEV_ADMIN_EMAIL: email, DEV_ADMIN_PASSWORD: password },
    stdio: ["ignore", "ignore", "ignore"], windowsHide: true,
  });
  const [exitCode] = await once(child, "exit");
  assert.equal(exitCode, 0, "Development provisioning CLI failed");
  console.log("PASS development provisioning CLI");
  const login = await request("POST", "/api/admin/auth/login", { email, password });
  const setup = await request("POST", "/api/admin/auth/mfa/setup", { challengeToken: login.data.challengeToken });
  const totp = new TOTP({ secret: Secret.fromBase32(setup.data.manualKey), digits: 6, period: 30, algorithm: "SHA1" });
  const confirmation = await request("POST", "/api/admin/auth/mfa/confirm", { challengeToken: setup.data.challengeToken, otp: totp.generate() });
  await request("GET", "/api/admin/auth/me");
  for (const module of ["categories", "attributes", "brands"]) await request("GET", `/api/admin/${module}`);
  categoryId = (await request("POST", "/api/admin/categories", { name: `Smoke ${runId}`, slug: `smoke-${runId}` }, 201)).data.category.id;
  await request("PATCH", `/api/admin/categories/${categoryId}`, { description: "Day 8 smoke verification" });
  attributeId = (await request("POST", "/api/admin/attributes", { name: `Smoke ${runId}`, code: `smoke_${runId.replaceAll("-", "")}`, type: "SELECT" }, 201)).data.attribute.id;
  await request("PATCH", `/api/admin/attributes/${attributeId}`, { name: "Smoke updated" });
  const valueId = (await request("POST", `/api/admin/attributes/${attributeId}/values`, { value: "large", label: "Large" }, 201)).data.value.id;
  await request("PATCH", `/api/admin/attributes/${attributeId}/values/${valueId}`, { label: "L" });
  await request("POST", `/api/admin/categories/${categoryId}/attributes`, { attributeId }, 201);
  await request("PATCH", `/api/admin/categories/${categoryId}/attributes/${attributeId}`, { isRequired: true });
  await request("GET", `/api/admin/categories/${categoryId}/attributes`);
  for (const action of ["approve", "reject"]) {
    const brand = (await request("POST", "/api/admin/brands", { name: `Smoke ${action} ${runId}` }, 201)).data.brand;
    brandIds.push(brand.id);
    await request("PATCH", `/api/admin/brands/${brand.id}`, { description: "Smoke verification" });
    await request("PATCH", `/api/admin/brands/${brand.id}/${action}`, action === "approve" ? {} : { reason: "Smoke review" });
  }
  await request("POST", "/api/admin/auth/refresh", {});
  await request("POST", "/api/admin/auth/logout", {});
  await request("GET", "/api/admin/brands", undefined, 401);
  const later = await request("POST", "/api/admin/auth/login", { email, password });
  // A fresh authenticator time step is required after enrollment.
  await delay(31000 - (Date.now() % 30000));
  await request("POST", "/api/admin/auth/mfa/verify", { challengeToken: later.data.challengeToken, otp: totp.generate() });
  await request("POST", "/api/admin/auth/logout", {});
  const recovery = await request("POST", "/api/admin/auth/login", { email, password });
  await request("POST", "/api/admin/auth/mfa/recovery", { challengeToken: recovery.data.challengeToken, recoveryCode: confirmation.data.recoveryCodes[0] });
  await request("POST", "/api/admin/auth/logout-all", {});
  await request("GET", "/api/admin/auth/me", undefined, 401);
  const otp = await request("POST", "/api/auth/otp/request", { email: buyerEmail }, 200, true);
  const mock = await request("GET", `/api/auth/otp/mock/${otp.data.challengeId}`, undefined, 200, true);
  await request("POST", "/api/auth/otp/verify", { challengeId: otp.data.challengeId, email: buyerEmail, otp: mock.data.otp }, 200, true);
  await request("GET", "/api/auth/me", undefined, 200, true);
  await request("GET", "/api/admin/brands", undefined, 403, true);
  await request("POST", "/api/auth/logout", {}, 200, true);
  console.log(`PASS ${checks} HTTP checks; no fixture sessions or token signing used.`);
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await prisma.$transaction(async (tx) => {
      if (categoryId) await tx.categoryAttribute.deleteMany({ where: { categoryId } });
      if (attributeId) {
        await tx.attributeValue.deleteMany({ where: { attributeId } });
        await tx.attribute.delete({ where: { id: attributeId } });
      }
      if (categoryId) await tx.category.delete({ where: { id: categoryId } });
      await tx.brand.deleteMany({ where: { id: { in: brandIds } } });
      const identities = await tx.authIdentity.findMany({ where: { provider: "EMAIL", identifier: { in: [email, buyerEmail] } }, select: { userId: true } });
      const userIds = identities.map(({ userId }) => userId);
      const userWhere = { userId: { in: userIds } };
      await tx.refreshToken.deleteMany({ where: { session: userWhere } });
      await tx.authSession.deleteMany({ where: userWhere });
      await tx.adminRecoveryCode.deleteMany({ where: userWhere });
      await tx.adminLoginChallenge.deleteMany({ where: userWhere });
      await tx.adminMfaCredential.deleteMany({ where: userWhere });
      await tx.passwordCredential.deleteMany({ where: userWhere });
      await tx.otpChallenge.deleteMany({ where: { OR: [userWhere, { destination: { in: [email, buyerEmail] } }] } });
      await tx.authIdentity.deleteMany({ where: userWhere });
      await tx.userRole.deleteMany({ where: userWhere });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    console.log("Smoke-owned accounts and business records removed; existing records preserved.");
  } finally { await prisma.$disconnect(); }
}
