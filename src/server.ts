import { createServer } from "node:http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/database.js";

let server: ReturnType<typeof createServer> | undefined;
let stopping = false;

async function shutdown(reason: string, exitCode = 0) {
  if (stopping) {
    if (exitCode) process.exitCode = exitCode;
    return;
  }
  stopping = true;
  process.exitCode = exitCode;
  logger.info({ event: "shutdown", reason }, "Stopping HouseLink API");
  const deadline = setTimeout(() => {
    server?.closeAllConnections();
    process.exit(1);
  }, 10000);
  try {
    if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await prisma.$disconnect();
    logger.info({ event: "shutdown_complete" }, "HouseLink API stopped");
  } catch {
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.exit(process.exitCode ?? exitCode);
  }
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
// Never serialize arbitrary exceptions: driver/provider errors can contain secrets.
process.on("uncaughtException", () => { void shutdown("uncaughtException", 1); });
process.on("unhandledRejection", () => { void shutdown("unhandledRejection", 1); });

try {
  const { default: app } = await import("./app.js");
  await prisma.$connect();
  const buyer = await prisma.role.findUnique({ where: { code: "BUYER" }, select: { id: true } });
  if (!buyer) throw new Error("Required role missing");
  if (!stopping) {
    server = createServer(app);
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    server.setTimeout(30000, (socket) => socket.destroy());
    server.on("error", () => { void shutdown("server_error", 1); });
    server.listen(env.PORT, () => logger.info({ port: env.PORT }, "HouseLink API listening"));
  }
} catch {
  logger.error({ event: "startup_failed" }, "Startup failed; check environment, OTP provider, database, migrations and role seed");
  await shutdown("startup_failed", 1);
}
