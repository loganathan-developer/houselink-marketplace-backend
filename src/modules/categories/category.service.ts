import { randomUUID } from "node:crypto";
import { prisma } from "../../config/database.js";
import { Prisma, type Category } from "../../generated/prisma/client.js";
import { HttpError } from "../../shared/errors/http-error.js";
import type { Breadcrumb, CategoryCreate, CategoryNode, CategoryQuery, CategoryUpdate } from "./category.types.js";

export const CATEGORY_LOCK = 712345678901n;
export const MAX_CATEGORY_DEPTH = 64;
const missing = () => new HttpError(404, "CATEGORY_NOT_FOUND", "Category not found.");
const compact = <T extends Record<string, unknown>>(input: T) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

const visible = Prisma.sql`WITH RECURSIVE visible AS (
  SELECT "id", 1 AS depth FROM "Category" WHERE "parentId" IS NULL AND "isActive" = true
  UNION ALL
  SELECT c."id", v.depth + 1 FROM "Category" c JOIN visible v ON c."parentId" = v."id"
  WHERE c."isActive" = true AND v.depth < ${MAX_CATEGORY_DEPTH}
)`;

export async function listCategories(query: CategoryQuery, admin = false) {
  const conditions: Prisma.Sql[] = [];
  if ("isActive" in query && query.isActive !== undefined) conditions.push(Prisma.sql`c."isActive" = ${query.isActive}`);
  if (query.rootOnly) conditions.push(Prisma.sql`c."parentId" IS NULL`);
  if (query.parentId) conditions.push(Prisma.sql`c."parentId" = ${query.parentId}::uuid`);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const source = admin ? Prisma.sql`SELECT c.* FROM "Category" c ${where}` : Prisma.sql`${visible} SELECT c.* FROM "Category" c JOIN visible v ON v."id" = c."id" ${where}`;
  const countSource = admin ? Prisma.sql`SELECT count(*)::int AS total FROM "Category" c ${where}` : Prisma.sql`${visible} SELECT count(*)::int AS total FROM "Category" c JOIN visible v ON v."id" = c."id" ${where}`;
  const [categories, count] = await prisma.$transaction([
    prisma.$queryRaw<Category[]>`${source} ORDER BY c."sortOrder" ASC, c."id" ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    prisma.$queryRaw<{ total: number }[]>`${countSource}`,
  ], { isolationLevel: "RepeatableRead" });
  const total = count[0]!.total;
  return { categories, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function categoryTree(): Promise<CategoryNode[]> {
  const categories = await prisma.$queryRaw<Category[]>`${visible} SELECT c.* FROM "Category" c
    JOIN visible v ON v."id" = c."id" ORDER BY c."sortOrder", c."id"`;
  const nodes = new Map(categories.map(category => [category.id, { ...category, children: [] } as CategoryNode]));
  const roots: CategoryNode[] = [];
  for (const category of categories) {
    const node = nodes.get(category.id)!;
    if (category.parentId === null) roots.push(node);
    else nodes.get(category.parentId)?.children.push(node);
  }
  return roots;
}

export async function categoryDetail(key: { id: string } | { slug: string }, admin = false) {
  const where = "id" in key ? Prisma.sql`"id" = ${key.id}::uuid` : Prisma.sql`"slug" = ${key.slug}`;
  const rows = await prisma.$queryRaw<(Category & { depth: number })[]>`WITH RECURSIVE ancestors AS (
    SELECT c.*, 1 AS depth FROM "Category" c WHERE ${where}
    UNION ALL
    SELECT c.*, a.depth + 1 FROM "Category" c JOIN ancestors a ON c."id" = a."parentId"
    WHERE a.depth < ${MAX_CATEGORY_DEPTH}
  ) SELECT * FROM ancestors ORDER BY depth`;
  if (!rows.length || (!admin && rows.some(row => !row.isActive)) || rows.at(-1)!.parentId !== null) throw missing();
  const { depth: _depth, ...category } = rows[0]!;
  const breadcrumbs: Breadcrumb[] = [...rows].reverse().map(({ id, name, slug }) => ({ id, name, slug }));
  return { ...category, breadcrumbs };
}

async function validateHierarchy(tx: Prisma.TransactionClient, id: string, parentId: string | null | undefined) {
  if (parentId === undefined) return;
  if (parentId === id) throw new HttpError(400, "INVALID_PARENT", "A category cannot be its own parent.");
  let current = parentId, depth = 0;
  while (current !== null) {
    if (++depth > MAX_CATEGORY_DEPTH) throw new HttpError(400, "CATEGORY_DEPTH_EXCEEDED", "Category hierarchy is too deep.");
    if (current === id) throw new HttpError(400, "CATEGORY_CYCLE", "Category parent cannot be a descendant.");
    current = (await tx.category.findUniqueOrThrow({ where: { id: current }, select: { parentId: true } })).parentId;
  }
}

export async function saveCategory(input: CategoryCreate | CategoryUpdate, id = randomUUID()) {
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CATEGORY_LOCK})`;
      const existing = await tx.category.findUnique({ where: { id } });
      if (!existing && !("name" in input && "slug" in input)) throw missing();
      if (input.parentId) await tx.category.findUniqueOrThrow({ where: { id: input.parentId } });
      await validateHierarchy(tx, id, input.parentId);
      return existing
        ? tx.category.update({ where: { id }, data: compact(input) as Prisma.CategoryUncheckedUpdateInput })
        : tx.category.create({ data: compact({ id, ...(input as CategoryCreate) }) as Prisma.CategoryUncheckedCreateInput });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new HttpError(409, "CATEGORY_SLUG_EXISTS", "Category slug already exists.");
      if (error.code === "P2025") throw missing();
    }
    throw error;
  }
}
