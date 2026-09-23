import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../shared/errors/http-error.js";
import { categoryDetail } from "../categories/category.service.js";
import type { AttributeCreate, AttributeListQuery, AttributeUpdate, AttributeValueCreate, AttributeValueUpdate, CategoryAttributeCreate, CategoryAttributeUpdate } from "./attribute.types.js";

const attributeMissing = () => new HttpError(404, "ATTRIBUTE_NOT_FOUND", "Attribute not found.");
const valueMissing = () => new HttpError(404, "ATTRIBUTE_VALUE_NOT_FOUND", "Attribute value not found.");
const mappingMissing = () => new HttpError(404, "CATEGORY_ATTRIBUTE_NOT_FOUND", "Category attribute mapping not found.");
const inactiveEntity = (message: string) => new HttpError(400, "INACTIVE_ATTRIBUTE_CONFIGURATION", message);

function mapConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
    if (target.includes("code")) throw new HttpError(409, "ATTRIBUTE_CODE_EXISTS", "Attribute code already exists.");
    if (target.includes("attributeId") && target.includes("value")) throw new HttpError(409, "ATTRIBUTE_VALUE_EXISTS", "Attribute value already exists.");
    throw new HttpError(409, "CATEGORY_ATTRIBUTE_EXISTS", "Attribute is already mapped to this category.");
  }
  throw error;
}

const attributeInclude = {
  values: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
};

function present<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export async function listAttributes(query: AttributeListQuery) {
  const where = query.isActive === undefined ? {} : { isActive: query.isActive };
  const [attributes, total] = await prisma.$transaction([
    prisma.attribute.findMany({
      where,
      include: attributeInclude,
      orderBy: [{ code: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.attribute.count({ where }),
  ]);
  return { attributes, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function createAttribute(input: AttributeCreate) {
  try {
    return await prisma.attribute.create({ data: {
      name: input.name,
      code: input.code,
      type: input.type,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    }, include: attributeInclude });
  } catch (error) { mapConflict(error); }
}

export async function updateAttribute(attributeId: string, input: AttributeUpdate) {
  try {
    return await prisma.attribute.update({ where: { id: attributeId }, data: present(input), include: attributeInclude });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw attributeMissing();
    mapConflict(error);
  }
}

export async function createAttributeValue(attributeId: string, input: AttributeValueCreate) {
  try {
    if (!await prisma.attribute.findUnique({ where: { id: attributeId }, select: { id: true } })) throw attributeMissing();
    return await prisma.attributeValue.create({ data: {
      attributeId,
      value: input.value,
      label: input.label,
      sortOrder: input.sortOrder,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    } });
  } catch (error) { mapConflict(error); }
}

export async function updateAttributeValue(attributeId: string, valueId: string, input: AttributeValueUpdate) {
  try {
    const value = await prisma.attributeValue.updateMany({ where: { id: valueId, attributeId }, data: present(input) });
    if (value.count !== 1) throw valueMissing();
    return await prisma.attributeValue.findUniqueOrThrow({ where: { id: valueId } });
  } catch (error) { mapConflict(error); }
}

async function activeCategoryOrThrow(categoryId: string) {
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true, isActive: true } });
  if (!category) throw new HttpError(404, "CATEGORY_NOT_FOUND", "Category not found.");
  if (!category.isActive) throw inactiveEntity("Inactive categories cannot receive new attribute mappings.");
  return category;
}

async function activeAttributeOrThrow(attributeId: string) {
  const attribute = await prisma.attribute.findUnique({ where: { id: attributeId }, select: { id: true, isActive: true } });
  if (!attribute) throw attributeMissing();
  if (!attribute.isActive) throw inactiveEntity("Inactive attributes cannot be mapped to categories.");
  return attribute;
}

export async function listCategoryAttributes(categoryId: string, admin = false) {
  if (admin) {
    if (!await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } })) throw new HttpError(404, "CATEGORY_NOT_FOUND", "Category not found.");
  } else {
    await categoryDetail({ id: categoryId });
  }
  const mappings = await prisma.categoryAttribute.findMany({
    where: {
      categoryId,
      ...(admin ? {} : { isActive: true, attribute: { isActive: true }, category: { isActive: true } }),
    },
    include: {
      attribute: {
        include: {
          values: {
            where: admin ? {} : { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { attributeId: "asc" }],
  });
  return {
    categoryId,
    attributes: mappings.map(({ attribute, ...mapping }) => ({
      id: attribute.id,
      name: attribute.name,
      code: attribute.code,
      type: attribute.type,
      isRequired: mapping.isRequired,
      isFilterable: mapping.isFilterable,
      isVariantOption: mapping.isVariantOption,
      sortOrder: mapping.sortOrder,
      ...(admin ? { isActive: mapping.isActive, attributeIsActive: attribute.isActive } : {}),
      values: attribute.values.map(({ id, value, label, sortOrder, isActive }) => ({
        id, value, label, sortOrder, ...(admin ? { isActive } : {}),
      })),
    })),
  };
}

export async function createCategoryAttribute(categoryId: string, input: CategoryAttributeCreate) {
  await activeCategoryOrThrow(categoryId);
  await activeAttributeOrThrow(input.attributeId);
  const data = {
    isRequired: input.isRequired,
    isFilterable: input.isFilterable,
    isVariantOption: input.isVariantOption,
    sortOrder: input.sortOrder,
    isActive: input.isActive ?? true,
  };
  try {
    const existing = await prisma.categoryAttribute.findUnique({ where: { categoryId_attributeId: { categoryId, attributeId: input.attributeId } } });
    if (existing) {
      if (existing.isActive) throw new HttpError(409, "CATEGORY_ATTRIBUTE_EXISTS", "Attribute is already mapped to this category.");
      return prisma.categoryAttribute.update({ where: { categoryId_attributeId: { categoryId, attributeId: input.attributeId } }, data: { ...data, isActive: true } });
    }
    return await prisma.categoryAttribute.create({ data: { categoryId, attributeId: input.attributeId, ...data } });
  } catch (error) { mapConflict(error); }
}

export async function updateCategoryAttribute(categoryId: string, attributeId: string, input: CategoryAttributeUpdate) {
  if (input.isActive === true) {
    await activeCategoryOrThrow(categoryId);
    await activeAttributeOrThrow(attributeId);
  }
  const result = await prisma.categoryAttribute.updateMany({ where: { categoryId, attributeId }, data: present(input) });
  if (result.count !== 1) throw mappingMissing();
  return prisma.categoryAttribute.findUniqueOrThrow({ where: { categoryId_attributeId: { categoryId, attributeId } } });
}

export async function deactivateCategoryAttribute(categoryId: string, attributeId: string) {
  const result = await prisma.categoryAttribute.updateMany({ where: { categoryId, attributeId }, data: { isActive: false } });
  if (result.count !== 1) throw mappingMissing();
}
