import { randomUUID } from "node:crypto";
import { prisma } from "../../config/database.js";
import { Prisma, type Category } from "../../generated/prisma/client.js";
import { HttpError } from "../../shared/errors/http-error.js";
import type { CategoryCreate, CategoryUpdate, CategoryQuery, CategoryNode, Breadcrumb } from "./category.types.js";

export const CATEGORY_LOCK = 712345678901n;
export const MAX_CATEGORY_DEPTH = 64;
const missing = () => new HttpError(404, "CATEGORY_NOT_FOUND", "Category not found.");
const invalidHierarchy = (message: string) => new HttpError(400, "INVALID_CATEGORY_HIERARCHY", message);

// One root-based traversal excludes inactive branches before any filters or pagination.
const visible = Prisma.sql`WITH RECURSIVE visible AS (
  SELECT "id", 1 AS depth FROM "Category" WHERE "parentId" IS NULL AND "isActive" = true
  UNION ALL
  SELECT c."id", v.depth + 1 FROM "Category" c JOIN visible v ON c."parentId" = v."id"
  WHERE c."isActive" = true AND v.depth < ${MAX_CATEGORY_DEPTH}
)`;

export async function listCategories(query: CategoryQuery, admin = false) {
  const conditions: Prisma.Sql[] = [];
  if (query.rootOnly) conditions.push(Prisma.sql`c."parentId" IS NULL`);
  if (query.parentId) conditions.push(Prisma.sql`c."parentId" = ${query.parentId}::uuid`);
  if (admin && query.isActive !== undefined) conditions.push(Prisma.sql`c."isActive" = ${query.isActive}`);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const prefix = admin ? Prisma.empty : visible;
  const join = admin ? Prisma.empty : Prisma.sql`JOIN visible v ON v."id" = c."id"`;
  const [categories, count] = await prisma.$transaction([
    prisma.$queryRaw<Category[]>`${prefix} SELECT c.* FROM "Category" c ${join} ${where}
      ORDER BY c."sortOrder" ASC, c."id" ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    prisma.$queryRaw<{ total: number }[]>`${prefix} SELECT count(*)::int AS total FROM "Category" c ${join} ${where}`,
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
  if (!rows.length || (!admin && (rows.some(row => !row.isActive) || rows.at(-1)!.parentId !== null))) throw missing();
  const { depth: _depth, ...category } = rows[0]!;
  const breadcrumbs: Breadcrumb[] = [...rows].reverse().map(({ id, name, slug }) => ({ id, name, slug }));
  return { ...category, breadcrumbs };
}

function validateHierarchy(rows: { id: string; parentId: string | null }[]) {
  const parents = new Map(rows.map(row => [row.id, row.parentId]));
  const depths = new Map<string, number>();
  for (const row of rows) {
    const path: string[] = [], seen = new Set<string>();
    let current: string | null = row.id;
    while (current !== null && !depths.has(current)) {
      if (seen.has(current)) throw invalidHierarchy("A category cannot be its own ancestor.");
      if (!parents.has(current)) throw invalidHierarchy("Parent category does not exist.");
      seen.add(current);
      path.push(current);
      current = parents.get(current)!;
    }
    let depth = current === null ? 0 : depths.get(current)!;
    for (const id of path.reverse()) {
      if (++depth > MAX_CATEGORY_DEPTH) throw invalidHierarchy(`Category hierarchy cannot exceed ${MAX_CATEGORY_DEPTH} levels.`);
      depths.set(id, depth);
    }
  }
}

export async function saveCategory(input: CategoryCreate | CategoryUpdate, id?: string) {
  try {
    return await prisma.$transaction(async tx => {
      // All category writers take this lock before reading hierarchy or changing parents.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CATEGORY_LOCK})`;
      const existing = id ? await tx.category.findUnique({ where: { id } }) : null;
      if (id && !existing) throw missing();
      const categoryId = id ?? randomUUID();
      const parentId = input.parentId === undefined ? existing?.parentId ?? null : input.parentId;
      if (!id || input.parentId !== undefined) {
        const rows = await tx.category.findMany({ select: { id: true, parentId: true } });
        validateHierarchy([...rows.filter(row => row.id !== categoryId), { id: categoryId, parentId }]);
      }
      const data = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        parentId,
      };
      if (id) return tx.category.update({ where: { id }, data });
      const create = input as CategoryCreate;
      return tx.category.create({ data: { ...data, id: categoryId, name: create.name, slug: create.slug } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "CATEGORY_SLUG_EXISTS", "Category slug already exists.");
    }
    throw error;
  }
}
