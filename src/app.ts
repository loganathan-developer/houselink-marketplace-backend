import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { corsMiddleware, csrfProtection } from "./middleware/security.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { notFound } from "./middleware/not-found.middleware.js";
import { requestLogger } from "./middleware/request-logger.middleware.js";
import authRoutes from "./modules/auth/auth.routes.js";
import adminAuthRoutes from "./modules/admin-auth/admin-auth.routes.js";
import userRoutes from "./modules/users/user.routes.js";
import categoryRoutes from "./modules/categories/category.routes.js";
import categoryAdminRoutes from "./modules/categories/category.admin.routes.js";
import attributeAdminRoutes from "./modules/attributes/attribute.admin.routes.js";
import categoryAttributeAdminRoutes from "./modules/attributes/category-attribute.admin.routes.js";
import brandRoutes from "./modules/brands/brand.routes.js";
import brandAdminRoutes from "./modules/brands/brand.admin.routes.js";
import mediaRoutes from "./modules/media/media.routes.js";
import { localStorage } from "./modules/media/local-storage.adapter.js";
import { env } from "./config/env.js";
import { prisma } from "./config/database.js";
import { HttpError } from "./shared/errors/http-error.js";

const app = express();
app.set("trust proxy", env.TRUST_PROXY.length ? env.TRUST_PROXY : false);

app.use(requestLogger);
app.disable("x-powered-by");
app.use(helmet());
app.use(corsMiddleware);
app.use(csrfProtection);
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());
const staticOptions = {
  dotfiles: "deny" as const,
  fallthrough: false,
  index: false,
  maxAge: "1d",
  setHeaders: (res: express.Response) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
};
app.use("/uploads/categories", express.static(localStorage.directory("categories"), staticOptions));
app.use("/uploads/brands", express.static(localStorage.directory("brands"), staticOptions));
app.use("/api/auth", authRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/admin/media", mediaRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin/attributes", attributeAdminRoutes);
app.use("/api/admin/brands", brandAdminRoutes);
app.use("/api/admin/categories/:categoryId/attributes", categoryAttributeAdminRoutes);
app.use("/api/admin/categories", categoryAdminRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/categories", categoryRoutes);

app.get("/api/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    success: true,
    message: "HouseLink API is running"
  });
});

app.get("/api/ready", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const buyer = await prisma.role.findUnique({ where: { code: "BUYER" }, select: { id: true } });
    if (!buyer) throw new Error("Required role missing");
  } catch {
    throw new HttpError(503, "NOT_READY", "Service is not ready");
  }
  res.json({ success: true });
});

app.use(notFound);
app.use(errorHandler);

export default app;
