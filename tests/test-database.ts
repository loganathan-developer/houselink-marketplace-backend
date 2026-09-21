export function testDatabaseUrl(value: string | undefined, applicationUrl?: string): URL {
  if (!value) throw new Error("TEST_DATABASE_URL is required; configure .env.test. DATABASE_URL is never a fallback.");
  const url = new URL(value);
  const localHosts = ["localhost", "127.0.0.1", "[::1]"];
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !localHosts.includes(url.hostname) ||
      !/^\/[a-z][a-z0-9_]*_test$/.test(url.pathname) ||
      [...url.searchParams.keys()].some((key) => key !== "schema")) {
    throw new Error("Tests require a loopback PostgreSQL database ending in _test, without connection overrides.");
  }
  if (applicationUrl) {
    const app = new URL(applicationUrl);
    if (localHosts.includes(app.hostname) && (app.port || "5432") === (url.port || "5432") && app.pathname === url.pathname) {
      throw new Error("Test and application databases must be different.");
    }
  }
  return url;
}
