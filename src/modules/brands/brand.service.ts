import { prisma } from "../../config/database.js";
import { Prisma, type Brand } from "../../generated/prisma/client.js";
import { HttpError } from "../../shared/errors/http-error.js";
import { normalizeBrandName, slugFromName } from "./brand.schema.js";
import type { BrandCreate, BrandQuery, BrandUpdate } from "./brand.types.js";

const missing = () => new HttpError(404, "BRAND_NOT_FOUND", "Brand not found.");
const conflict = (code = "BRAND_CONFLICT", message = "Brand conflict.") => new HttpError(409, code, message);
const compact = <T extends Record<string, unknown>>(input: T) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
const publicSelect = { id: true, name: true, slug: true, description: true, logoUrl: true } as const;

function mapWriteError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
      if (target.includes("slug")) throw conflict("BRAND_SLUG_EXISTS", "Brand slug already exists.");
      throw conflict("BRAND_NAME_EXISTS", "Brand name already exists.");
    }
    if (error.code === "P2025") throw missing();
  }
  throw error;
}

function whereFor(query: BrandQuery, admin: boolean): Prisma.BrandWhereInput {
  const where: Prisma.BrandWhereInput = admin ? {} : { status: "APPROVED", isActive: true };
  if (query.q) where.name = { contains: query.q, mode: "insensitive" };
  if (admin && query.status) where.status = query.status;
  if (admin && query.isActive !== undefined) where.isActive = query.isActive;
  return where;
}

export async function listBrands(query: BrandQuery, admin = false) {
  const where = whereFor(query, admin);
  const findArgs = {
    where,
    orderBy: [{ name: "asc" as const }, { id: "asc" as const }],
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    ...(admin ? {} : { select: publicSelect }),
  };
  const [brands, total] = await prisma.$transaction([
    prisma.brand.findMany(findArgs),
    prisma.brand.count({ where }),
  ], { isolationLevel: "RepeatableRead" });
  return { brands, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function brandDetail(key: { id: string } | { slug: string }, admin = false) {
  const where = "id" in key ? { id: key.id } : { slug: key.slug };
  const brand = await prisma.brand.findFirst({ where: { ...where, ...(admin ? {} : { status: "APPROVED" as const, isActive: true }) }, ...(admin ? {} : { select: publicSelect }) });
  if (!brand) throw missing();
  return brand;
}

export async function createBrand(input: BrandCreate) {
  const normalizedName = normalizeBrandName(input.name);
  const slug = input.slug ?? slugFromName(input.name);
  if (!slug) throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", [{ path: "body.slug", message: "Generated slug is empty" }]);
  const status = input.status ?? "PENDING";
  try {
    const data = compact({
      name: input.name,
      normalizedName,
      slug,
      description: input.description,
      logoUrl: input.logoUrl,
      status,
      isActive: input.isActive ?? true,
      approvedAt: status === "APPROVED" ? new Date() : undefined,
    }) as Prisma.BrandCreateInput;
    return await prisma.brand.create({ data });
  } catch (error) { mapWriteError(error); }
}

export async function updateBrand(id: string, input: BrandUpdate) {
  const data: Prisma.BrandUpdateInput = compact({
    name: input.name,
    normalizedName: input.name === undefined ? undefined : normalizeBrandName(input.name),
    slug: input.slug,
    description: input.description,
    logoUrl: input.logoUrl,
    isActive: input.isActive,
  });
  try {
    return await prisma.brand.update({ where: { id }, data });
  } catch (error) { mapWriteError(error); }
}

export async function approveBrand(id: string) {
  const now = new Date();
  const result = await prisma.brand.updateManyAndReturn({
    where: { id, status: "PENDING" },
    data: { status: "APPROVED", approvedAt: now, rejectedAt: null, rejectionReason: null },
  });
  if (result[0]) return result[0];
  if (await prisma.brand.findUnique({ where: { id }, select: { id: true } })) throw conflict("BRAND_REVIEW_CONFLICT", "Brand has already received a review decision.");
  throw missing();
}

export async function rejectBrand(id: string, reason: string) {
  const now = new Date();
  const result = await prisma.brand.updateManyAndReturn({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", rejectedAt: now, rejectionReason: reason, approvedAt: null },
  });
  if (result[0]) return result[0];
  if (await prisma.brand.findUnique({ where: { id }, select: { id: true } })) throw conflict("BRAND_REVIEW_CONFLICT", "Brand has already received a review decision.");
  throw missing();
}
