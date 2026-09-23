import { prisma } from "../../config/database.js";
import { Prisma, type Category } from "../../generated/prisma/client.js";
import { HttpError } from "../../shared/errors/http-error.js";
import type { CategoryQuery, CategoryNode, Breadcrumb } from "./category.types.js";

export const CATEGORY_LOCK = 712345678901n;
export const MAX_CATEGORY_DEPTH = 64;
const missing = () => new HttpError(404, "CATEGORY_NOT_FOUND", "Category not found.");

// One root-based traversal excludes inactive branches before any filters or pagination.
const visible = Prisma.sql`WITH RECURSIVE visible AS (
  SELECT "id", 1 AS depth FROM "Category" WHERE "parentId" IS NULL AND "isActive" = true
  UNION ALL
  SELECT c."id", v.depth + 1 FROM "Category" c JOIN visible v ON c."parentId" = v."id"
  WHERE c."isActive" = true AND v.depth < ${MAX_CATEGORY_DEPTH}
)`;

export async function listCategories(query: CategoryQuery) {
  const conditions: Prisma.Sql[] = [];
  if (query.rootOnly) conditions.push(Prisma.sql`c."parentId" IS NULL`);
  if (query.parentId) conditions.push(Prisma.sql`c."parentId" = ${query.parentId}::uuid`);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const [categories, count] = await prisma.$transaction([
    prisma.$queryRaw<Category[]>`${visible} SELECT c.* FROM "Category" c JOIN visible v ON v."id" = c."id" ${where}
      ORDER BY c."sortOrder" ASC, c."id" ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    prisma.$queryRaw<{ total: number }[]>`${visible} SELECT count(*)::int AS total FROM "Category" c JOIN visible v ON v."id" = c."id" ${where}`,
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

export async function categoryDetail(key: { id: string } | { slug: string }) {
  const where = "id" in key ? Prisma.sql`"id" = ${key.id}::uuid` : Prisma.sql`"slug" = ${key.slug}`;
  const rows = await prisma.$queryRaw<(Category & { depth: number })[]>`WITH RECURSIVE ancestors AS (
    SELECT c.*, 1 AS depth FROM "Category" c WHERE ${where}
    UNION ALL
    SELECT c.*, a.depth + 1 FROM "Category" c JOIN ancestors a ON c."id" = a."parentId"
    WHERE a.depth < ${MAX_CATEGORY_DEPTH}
  ) SELECT * FROM ancestors ORDER BY depth`;
  if (!rows.length || rows.some(row => !row.isActive) || rows.at(-1)!.parentId !== null) throw missing();
  const { depth: _depth, ...category } = rows[0]!;
  const breadcrumbs: Breadcrumb[] = [...rows].reverse().map(({ id, name, slug }) => ({ id, name, slug }));
  return { ...category, breadcrumbs };
}
