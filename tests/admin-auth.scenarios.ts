import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { decodeJwt } from "jose";
import type { PrismaClient } from "../src/generated/prisma/client.js";

type Send = (path: string, cookie?: string, body?: unknown, method?: string) => Promise<Response>;
export function registerAdminAuthTests(deps: { prisma: PrismaClient; send: Send; sendWithoutCsrf: Send; buyerLogin: () => Promise<{ cookie: string; refresh: string; userId: string; sessionId: string }> }) {
  const { prisma, send } = deps;
  const scenario = (name: string, fn: () => Promise<void>) => test(`admin-auth: ${name}`, fn);
  const api = (path: string, body?: unknown, cookie = "") => send(`/admin/auth${path}`, cookie, body);
  const data = async (res: Response, status = 200) => {
    assert.equal(res.status, status, await res.clone().text());
    return (await res.json()).data;
  };
  const cookies = (res: Response) => {
    const values = res.headers.getSetCookie();
    assert.equal(values.length, 2);
    assert(values.every((value) => value.includes("HttpOnly") && value.includes("SameSite=Lax")));
    const cookie = values.map((value) => value.split(";")[0]).join("; ");
    const access = /admin_access_token=([^;]+)/.exec(cookie)![1]!;
    const refresh = /admin_refresh_token=([^;]+)/.exec(cookie)![1]!;
    assert(values.some((value) => value.startsWith("admin_access_token=") && value.includes("Path=/api/admin;")));
    assert(values.some((value) => value.startsWith("admin_refresh_token=") && value.includes("Path=/api/admin/auth;")));
    return { cookie, access, refresh, sessionId: decodeJwt(access).sid as string };
  };
  const provision = async () => {
    const { env } = await import("../src/config/env.js");
    const { provisionDevelopmentAdmin } = await import("../src/modules/admin-auth/admin-auth.provision.js");
    const email = `admin-${randomUUID()}@example.test`, password = randomBytes(24).toString("hex");
    const original = env.NODE_ENV;
    env.NODE_ENV = "development";
    try { return { ...await provisionDevelopmentAdmin({ email, password }), email, password }; }
    finally { env.NODE_ENV = original; }
  };
  const passwordLogin = async (account: { email: string; password: string }) => {
    const res = await api("/login", { email: account.email, password: account.password });
    assert.equal(res.headers.getSetCookie().length, 0);
    return data(res);
  };
  const setup = async () => {
    const account = await provision();
    const challenge = await passwordLogin(account);
    assert.equal(challenge.nextStep, "MFA_SETUP");
    const enrollment = await data(await api("/mfa/setup", { challengeToken: challenge.challengeToken }));
    const { authenticator } = await import("../src/modules/admin-auth/admin-auth.crypto.js");
    return { ...account, challenge, enrollment, totp: authenticator(enrollment.manualKey) };
  };
  const enroll = async () => {
    const account = await setup();
    const res = await api("/mfa/confirm", { challengeToken: account.enrollment.challengeToken, otp: account.totp.generate({ timestamp: Date.now() - 30000 }) });
    const result = await data(res);
    return { ...account, ...cookies(res), recoveryCodes: result.recoveryCodes as string[] };
  };
  const invalidCode = (totp: Awaited<ReturnType<typeof setup>>["totp"]) => {
    const valid = [-1, 0, 1].map((n) => totp.generate({ timestamp: Date.now() + n * 30000 }));
    return ["000000", "111111", "222222", "333333"].find((code) => !valid.includes(code))!;
  };

  scenario("provisioning hashes passwords, is repeatable and refuses buyer promotion", async () => {
    const account = await provision();
    const credential = await prisma.passwordCredential.findUniqueOrThrow({ where: { userId: account.userId } });
    assert(credential.passwordHash.startsWith("$argon2id$"));
    assert(!credential.passwordHash.includes(account.password));
    const { verifyPassword } = await import("../src/modules/admin-auth/admin-auth.crypto.js");
    assert(await verifyPassword(credential.passwordHash, account.password));
    const { env } = await import("../src/config/env.js");
    const { provisionDevelopmentAdmin } = await import("../src/modules/admin-auth/admin-auth.provision.js");
    const original = env.NODE_ENV;
    try {
      env.NODE_ENV = "development";
      const second = await provisionDevelopmentAdmin({ email: account.email.toUpperCase(), password: "different-password-123" });
      assert.equal(second.userId, account.userId);
      assert.equal(second.created, false);
      assert.equal((await prisma.passwordCredential.findUniqueOrThrow({ where: { userId: account.userId } })).passwordHash, credential.passwordHash);
      const buyer = await deps.buyerLogin();
      const email = `buyer-${randomUUID()}@example.test`;
      await prisma.authIdentity.create({ data: { userId: buyer.userId, provider: "EMAIL", identifier: email, verifiedAt: new Date() } });
      await assert.rejects(provisionDevelopmentAdmin({ email, password: account.password }), /Refusing/);
      env.NODE_ENV = "production";
      await assert.rejects(provisionDevelopmentAdmin({ email: account.email, password: account.password }), /development/);
    } finally { env.NODE_ENV = original; }
  });

  scenario("password-only login is restricted and challenges are stored hashed", async () => {
    const account = await provision();
    const challenge = await passwordLogin({ ...account, email: account.email.toUpperCase() });
    assert.equal(challenge.nextStep, "MFA_SETUP");
    assert.equal(await prisma.authSession.count({ where: { userId: account.userId } }), 0);
    const stored = await prisma.adminLoginChallenge.findFirstOrThrow({ where: { userId: account.userId } });
    assert.notEqual(stored.tokenHash, challenge.challengeToken);
    assert(stored.expiresAt.getTime() - Date.now() <= 300000);
    assert.equal((await send("/admin/brands", `admin_access_token=${challenge.challengeToken}`)).status, 401);
  });

  scenario("all password failures are generic including inactive, non-admin and missing credential", async () => {
    const account = await provision();
    const assertGeneric = async (body: unknown) => {
      const res = await api("/login", body);
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error.code, "INVALID_CREDENTIALS");
      assert.equal(res.headers.getSetCookie().length, 0);
    };
    await assertGeneric({ email: `unknown-${randomUUID()}@example.test`, password: account.password });
    await assertGeneric({ email: account.email, password: "wrong" });
    await prisma.user.update({ where: { id: account.userId }, data: { status: "BLOCKED" } });
    await assertGeneric({ email: account.email, password: account.password });
    await prisma.user.update({ where: { id: account.userId }, data: { status: "DELETED" } });
    await assertGeneric({ email: account.email, password: account.password });
    await prisma.user.update({ where: { id: account.userId }, data: { status: "ACTIVE" } });
    await prisma.userRole.deleteMany({ where: { userId: account.userId } });
    await assertGeneric({ email: account.email, password: account.password });
    await prisma.passwordCredential.delete({ where: { userId: account.userId } });
    await assertGeneric({ email: account.email, password: account.password });
  });

  scenario("login account rate limits, CSRF and strict schemas are enforced", async () => {
    const account = await provision();
    const body = { email: account.email, password: account.password };
    assert.equal((await deps.sendWithoutCsrf("/admin/auth/login", "", body)).status, 403);
    assert.equal((await api("/login", { ...body, roles: ["ADMIN"] })).status, 400);
    assert.equal((await api("/login", {})).status, 400);
    for (let i = 0; i < 10; i++) assert.equal((await api("/login", { ...body, password: "wrong" })).status, 401);
    const limited = await api("/login", body);
    assert.equal(limited.status, 429);
    assert(limited.headers.get("retry-after"));
  });

  scenario("enrollment secrets are encrypted and no session exists before confirmation", async () => {
    const account = await setup();
    assert.equal(account.enrollment.nextStep, "MFA_CONFIRM");
    assert(account.enrollment.otpauthUri.startsWith("otpauth://totp/"));
    const stored = await prisma.adminMfaCredential.findUniqueOrThrow({ where: { userId: account.userId } });
    assert.equal(stored.activatedAt, null);
    assert(!stored.encryptedSecret.includes(account.enrollment.manualKey));
    const { decryptSecret } = await import("../src/modules/admin-auth/admin-auth.crypto.js");
    assert.equal(decryptSecret(stored.encryptedSecret, account.userId), account.enrollment.manualKey);
    assert.throws(() => decryptSecret(stored.encryptedSecret, randomUUID()));
    assert.equal(await prisma.authSession.count({ where: { userId: account.userId } }), 0);
    assert.equal((await api("/mfa/setup", { challengeToken: account.challenge.challengeToken })).status, 401);
    assert.equal((await api("/mfa/verify", { challengeToken: account.enrollment.challengeToken, otp: account.totp.generate() })).status, 401);
    assert.equal((await api("/mfa/setup", {})).status, 400);
    assert.equal((await api("/mfa/setup", { challengeToken: randomBytes(32).toString("base64url") })).status, 401);
  });

  scenario("wrong enrollment codes consume attempts and confirmation is single-use", async () => {
    const account = await setup();
    assert.equal((await api("/mfa/confirm", { challengeToken: account.enrollment.challengeToken, otp: invalidCode(account.totp) })).status, 401);
    const body = { challengeToken: account.enrollment.challengeToken, otp: account.totp.generate() };
    const result = await data(await api("/mfa/confirm", body));
    assert.equal(result.recoveryCodes.length, 10);
    assert.equal(new Set(result.recoveryCodes).size, 10);
    const codes = await prisma.adminRecoveryCode.findMany({ where: { userId: account.userId } });
    assert(codes.every((code) => !result.recoveryCodes.includes(code.codeHash)));
    assert.equal((await api("/mfa/confirm", body)).status, 401);
    const challenge = await passwordLogin(account);
    assert.equal((await api("/mfa/setup", { challengeToken: challenge.challengeToken })).status, 401);
  });

  scenario("expired enrollment and attempts exhausted cannot create sessions", async () => {
    const account = await setup();
    for (let i = 0; i < 5; i++) assert.equal((await api("/mfa/confirm", { challengeToken: account.enrollment.challengeToken, otp: invalidCode(account.totp) })).status, 401);
    assert.equal((await api("/mfa/confirm", { challengeToken: account.enrollment.challengeToken, otp: account.totp.generate() })).status, 401);
    const challenge = await passwordLogin(account);
    await prisma.adminLoginChallenge.updateMany({ where: { userId: account.userId }, data: { expiresAt: new Date(0) } });
    assert.equal((await api("/mfa/setup", { challengeToken: challenge.challengeToken })).status, 401);
    assert.equal(await prisma.authSession.count({ where: { userId: account.userId } }), 0);
  });

  scenario("confirmation creates STAFF + MFA cookies and safe profile", async () => {
    const account = await enroll();
    const session = await prisma.authSession.findUniqueOrThrow({ where: { id: account.sessionId } });
    assert.equal(session.context, "STAFF");
    assert(session.mfaVerifiedAt);
    const response = await api("/me", undefined, account.cookie);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const profile = await data(response);
    assert.deepEqual(Object.keys(profile).sort(), ["context", "mfaVerified", "user"]);
    assert.deepEqual(Object.keys(profile.user).sort(), ["email", "id", "roles"]);
    assert.equal(profile.user.email, account.email);
    assert.equal(profile.context, "STAFF");
    assert.equal(profile.mfaVerified, true);
    assert.equal((await send("/admin/brands", `access_token=${account.access}`)).status, 403);
    assert.equal((await send("/ADMIN/brands", `access_token=${account.access}`)).status, 403);
    assert.equal((await send("/ADMIN/brands", account.cookie)).status, 200);
    assert.equal((await send("/auth/me", `access_token=${account.access}`)).status, 401);
  });

  scenario("subsequent TOTP login succeeds and prevents challenge and step replay", async () => {
    const account = await enroll();
    const challenge = await passwordLogin(account);
    assert.equal(challenge.nextStep, "MFA_VERIFY");
    const body = { challengeToken: challenge.challengeToken, otp: account.totp.generate() };
    const verified = await api("/mfa/verify", body);
    const result = await data(verified);
    assert.equal(result.recoveryCodes, undefined);
    cookies(verified);
    assert.equal((await api("/mfa/verify", body)).status, 401);
    const second = await passwordLogin(account);
    assert.equal((await api("/mfa/verify", { ...body, challengeToken: second.challengeToken })).status, 401);
  });

  scenario("concurrent TOTP requests across challenges accept a step only once", async () => {
    const account = await enroll();
    const first = await passwordLogin(account), second = await passwordLogin(account);
    const otp = account.totp.generate();
    const results = await Promise.all([first, second].map((challenge) => api("/mfa/verify", { challengeToken: challenge.challengeToken, otp })));
    assert.deepEqual(results.map((res) => res.status).sort(), [200, 401]);
  });

  scenario("expired and exhausted login challenges fail even with a valid TOTP", async () => {
    const account = await enroll();
    const challenge = await passwordLogin(account);
    for (let i = 0; i < 5; i++) assert.equal((await api("/mfa/verify", { challengeToken: challenge.challengeToken, otp: invalidCode(account.totp) })).status, 401);
    assert.equal((await api("/mfa/verify", { challengeToken: challenge.challengeToken, otp: account.totp.generate() })).status, 401);
    const next = await passwordLogin(account);
    await prisma.adminLoginChallenge.updateMany({ where: { userId: account.userId }, data: { expiresAt: new Date(0) } });
    assert.equal((await api("/mfa/verify", { challengeToken: next.challengeToken, otp: account.totp.generate() })).status, 401);
  });

  scenario("recovery requires a password challenge and atomically consumes the code", async () => {
    const account = await enroll();
    assert.equal((await api("/mfa/recovery", { recoveryCode: account.recoveryCodes[0] })).status, 400);
    assert.equal((await api("/mfa/recovery", { challengeToken: account.enrollment.challengeToken, recoveryCode: account.recoveryCodes[0] })).status, 401);
    const first = await passwordLogin(account), second = await passwordLogin(account);
    assert.equal((await api("/mfa/recovery", { challengeToken: first.challengeToken, recoveryCode: "0".repeat(32) })).status, 401);
    const results = await Promise.all([first, second].map((challenge) => api("/mfa/recovery", { challengeToken: challenge.challengeToken, recoveryCode: account.recoveryCodes[0] })));
    assert.deepEqual(results.map((res) => res.status).sort(), [200, 401]);
    const success = results.find((res) => res.status === 200)!;
    assert.equal((await data(success)).recoveryCodes, undefined);
    const session = await prisma.authSession.findUniqueOrThrow({ where: { id: cookies(success).sessionId } });
    assert.equal(session.context, "STAFF");
    assert(session.mfaVerifiedAt);
    const next = await passwordLogin(account);
    assert.equal((await api("/mfa/recovery", { challengeToken: next.challengeToken, recoveryCode: account.recoveryCodes[0] })).status, 401);
  });

  scenario("role removal or blocking during MFA prevents session creation", async () => {
    for (const change of ["role", "status", "password"] as const) {
      const account = await enroll();
      const challenge = await passwordLogin(account);
      if (change === "role") await prisma.userRole.deleteMany({ where: { userId: account.userId } });
      if (change === "status") await prisma.user.update({ where: { id: account.userId }, data: { status: "BLOCKED" } });
      if (change === "password") await prisma.passwordCredential.update({ where: { userId: account.userId }, data: { passwordChangedAt: new Date(Date.now() + 1000) } });
      assert.equal((await api("/mfa/verify", { challengeToken: challenge.challengeToken, otp: account.totp.generate() })).status, 401);
      assert.equal((await api("/mfa/recovery", { challengeToken: challenge.challengeToken, recoveryCode: account.recoveryCodes[0] })).status, 401);
      assert.equal(await prisma.authSession.count({ where: { userId: account.userId } }), 1);
    }
  });

  scenario("existing admin APIs enforce current roles, context, MFA and active status", async () => {
    const account = await enroll();
    const buyer = await deps.buyerLogin();
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
    for (const path of ["/admin/brands", "/admin/categories", "/admin/attributes"]) {
      assert.equal((await send(path)).status, 401);
      assert.equal((await send(path, buyer.cookie)).status, 403);
      assert.equal((await send(path, account.cookie)).status, 200);
    }
    await prisma.userRole.create({ data: { userId: buyer.userId, roleId: adminRole.id } });
    assert.equal((await send("/admin/brands", buyer.cookie)).status, 403);
    await prisma.authSession.update({ where: { id: account.sessionId }, data: { mfaVerifiedAt: null } });
    assert.equal((await send("/admin/brands", account.cookie)).status, 403);
    assert.equal((await api("/refresh", {}, account.cookie)).status, 401);
    await prisma.authSession.update({ where: { id: account.sessionId }, data: { mfaVerifiedAt: new Date() } });
    await prisma.userRole.deleteMany({ where: { userId: account.userId } });
    assert.equal((await send("/admin/brands", account.cookie)).status, 403);
    assert.equal((await api("/refresh", {}, account.cookie)).status, 401);
    await prisma.userRole.create({ data: { userId: account.userId, roleId: adminRole.id } });
    await prisma.user.update({ where: { id: account.userId }, data: { status: "BLOCKED" } });
    assert.equal((await send("/admin/brands", account.cookie)).status, 401);
  });

  scenario("refresh rotates, preserves STAFF MFA and reuse revokes the session", async () => {
    const account = await enroll();
    const before = await prisma.authSession.findUniqueOrThrow({ where: { id: account.sessionId } });
    const res = await api("/refresh", {}, account.cookie);
    await data(res);
    const rotated = cookies(res);
    assert.notEqual(rotated.refresh, account.refresh);
    assert.equal(rotated.sessionId, account.sessionId);
    const after = await prisma.authSession.findUniqueOrThrow({ where: { id: account.sessionId } });
    assert.equal(after.context, "STAFF");
    assert.equal(after.mfaVerifiedAt?.getTime(), before.mfaVerifiedAt?.getTime());
    assert.equal((await api("/refresh", {}, account.cookie)).status, 401);
    assert.equal((await api("/refresh", {}, rotated.cookie)).status, 401);
    assert.equal((await send("/admin/brands", rotated.cookie)).status, 401);
  });

  scenario("customer and staff refresh tokens cannot cross authentication contexts", async () => {
    const buyer = await deps.buyerLogin(), admin = await enroll();
    assert.equal((await api("/refresh", {}, `admin_refresh_token=${buyer.refresh}`)).status, 401);
    assert.equal((await send("/auth/refresh", `refresh_token=${admin.refresh}`, {})).status, 401);
    assert.equal((await send("/auth/refresh", buyer.cookie, {})).status, 200);
    assert.equal((await api("/refresh", {}, admin.cookie)).status, 200);
  });

  scenario("logout revokes current STAFF session and clears only admin cookies", async () => {
    const account = await enroll();
    const res = await api("/logout", {}, account.cookie);
    await data(res);
    assert(res.headers.getSetCookie().every((cookie) => cookie.startsWith("admin_") && cookie.includes("Expires=Thu, 01 Jan 1970")));
    assert.equal((await send("/admin/brands", account.cookie)).status, 401);
    assert.equal((await api("/refresh", {}, account.cookie)).status, 401);
    assert.equal(await prisma.refreshToken.count({ where: { sessionId: account.sessionId, revokedAt: null } }), 0);
  });

  scenario("logout-all revokes all STAFF sessions and preserves the same user's CUSTOMER session", async () => {
    const account = await enroll();
    const challenge = await passwordLogin(account);
    const second = await api("/mfa/recovery", { challengeToken: challenge.challengeToken, recoveryCode: account.recoveryCodes[0] });
    await data(second);
    const secondAuth = cookies(second);
    const { createSession } = await import("../src/modules/auth/session.service.js");
    const customer = await prisma.$transaction((tx) => createSession(tx, account.userId));
    await data(await api("/logout-all", {}, account.cookie));
    assert.equal((await api("/me", undefined, secondAuth.cookie)).status, 401);
    assert.equal((await api("/refresh", {}, secondAuth.cookie)).status, 401);
    assert.equal(await prisma.authSession.count({ where: { userId: account.userId, context: "STAFF", revokedAt: null } }), 0);
    assert.equal((await send("/auth/me", `access_token=${customer.accessToken}`)).status, 200);
  });

  scenario("real admin login cookies support category, attribute, mapping and brand workflows", async () => {
    const account = await enroll(), cookie = account.cookie;
    const category = (await data(await send("/admin/categories", cookie, { name: "Day 8 Category", slug: `day8-${randomUUID()}` }), 201)).category;
    await data(await send(`/admin/categories/${category.id}`, cookie, { name: "Day 8 Updated" }, "PATCH"));
    const attribute = (await data(await send("/admin/attributes", cookie, { name: "Day 8 Size", code: `size_${randomUUID().replaceAll("-", "")}`, type: "SELECT" }), 201)).attribute;
    await data(await send(`/admin/attributes/${attribute.id}`, cookie, { name: "Updated Size" }, "PATCH"));
    const value = (await data(await send(`/admin/attributes/${attribute.id}/values`, cookie, { value: "large", label: "Large" }), 201)).value;
    await data(await send(`/admin/attributes/${attribute.id}/values/${value.id}`, cookie, { label: "L" }, "PATCH"));
    await data(await send(`/admin/categories/${category.id}/attributes`, cookie, { attributeId: attribute.id }), 201);
    await data(await send(`/admin/categories/${category.id}/attributes/${attribute.id}`, cookie, { isRequired: true }, "PATCH"));
    await data(await send(`/admin/categories/${category.id}/attributes`, cookie));
    for (const decision of ["approve", "reject"]) {
      const brand = (await data(await send("/admin/brands", cookie, { name: `Day8 ${randomUUID()}` }), 201)).brand;
      await data(await send(`/admin/brands/${brand.id}`, cookie, { description: "Verified through real login" }, "PATCH"));
      await data(await send(`/admin/brands/${brand.id}/${decision}`, cookie, decision === "approve" ? {} : { reason: "Test review" }, "PATCH"));
    }
  });

  scenario("MFA endpoints share an IP rate limit even for unknown challenges", async () => {
    for (let i = 0; i < 30; i++) {
      assert.equal((await api("/mfa/recovery", { challengeToken: randomBytes(32).toString("base64url"), recoveryCode: randomBytes(16).toString("hex") })).status, 401);
    }
    const res = await api("/mfa/verify", { challengeToken: randomBytes(32).toString("base64url"), otp: "123456" });
    assert.equal(res.status, 429);
    assert(res.headers.get("retry-after"));
  });

  scenario("setup restart invalidates old enrollment and active MFA cannot be replaced", async () => {
    const account = await setup();
    const next = await passwordLogin(account);
    const replacement = await data(await api("/mfa/setup", { challengeToken: next.challengeToken }));
    assert.notEqual(replacement.manualKey, account.enrollment.manualKey);
    assert.equal((await api("/mfa/confirm", { challengeToken: account.enrollment.challengeToken, otp: account.totp.generate() })).status, 401);
    // Create a still-valid setup challenge before activating the pending factor.
    const staleSetup = await passwordLogin(account);
    const { authenticator } = await import("../src/modules/admin-auth/admin-auth.crypto.js");
    await data(await api("/mfa/confirm", { challengeToken: replacement.challengeToken, otp: authenticator(replacement.manualKey).generate() }));
    const before = await prisma.adminMfaCredential.findUniqueOrThrow({ where: { userId: account.userId } });
    assert.equal((await api("/mfa/setup", { challengeToken: staleSetup.challengeToken })).status, 401);
    assert.equal((await prisma.adminMfaCredential.findUniqueOrThrow({ where: { userId: account.userId } })).encryptedSecret, before.encryptedSecret);
  });

  scenario("enrollment rechecks current role and leaves pending MFA inactive on failure", async () => {
    const account = await setup();
    await prisma.userRole.deleteMany({ where: { userId: account.userId } });
    assert.equal((await api("/mfa/confirm", { challengeToken: account.enrollment.challengeToken, otp: account.totp.generate() })).status, 401);
    assert.equal((await prisma.adminMfaCredential.findUniqueOrThrow({ where: { userId: account.userId } })).activatedAt, null);
    assert.equal(await prisma.adminRecoveryCode.count({ where: { userId: account.userId } }), 0);
    assert.equal(await prisma.authSession.count({ where: { userId: account.userId } }), 0);
  });

  scenario("missing MFA key fails closed without affecting buyer authentication", async () => {
    const { env } = await import("../src/config/env.js");
    const original = env.ADMIN_MFA_ENCRYPTION_KEY;
    try {
      delete env.ADMIN_MFA_ENCRYPTION_KEY;
      const res = await api("/login", { email: "admin@example.test", password: "not-a-real-password" });
      assert.equal(res.status, 503);
      assert.equal(res.headers.getSetCookie().length, 0);
      await deps.buyerLogin();
    } finally { env.ADMIN_MFA_ENCRYPTION_KEY = original; }
  });
}
