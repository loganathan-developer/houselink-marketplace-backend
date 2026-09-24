import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../shared/errors/http-error.js";
import { categoryDetail } from "../categories/category.service.js";
import type { AttributeCreate, AttributeListQuery, AttributeUpdate, AttributeValueCreate, AttributeValueUpdate, CategoryAttributeCreate, CategoryAttributeUpdate } from "./attribute.types.js";

const missingAttribute = () => new HttpError(404, "ATTRIBUTE_NOT_FOUND", "Attribute not found.");
const missingValue = () => new HttpError(404, "ATTRIBUTE_VALUE_NOT_FOUND", "Attribute value not found.");
const missingMapping = () => new HttpError(404, "CATEGORY_ATTRIBUTE_NOT_FOUND", "Category attribute mapping not found.");
const compact = <T extends Record<string, unknown>>(input: T) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

export async function listAttributes(query: AttributeListQuery) {
  const where = query.isActive === undefined ? {} : { isActive: query.isActive };
  const [attributes, total] = await prisma.$transaction([
    prisma.attribute.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit, include: { values: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } }),
    prisma.attribute.count({ where }),
  ]);
  return { attributes, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function createAttribute(input: AttributeCreate) {
  try { return await prisma.attribute.create({ data: compact(input) as Prisma.AttributeUncheckedCreateInput }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "ATTRIBUTE_CODE_EXISTS", "Attribute code already exists.");
    throw error;
  }
}

export async function updateAttribute(id: string, input: AttributeUpdate) {
  try { return await prisma.attribute.update({ where: { id }, data: compact(input) as Prisma.AttributeUncheckedUpdateInput }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new HttpError(409, "ATTRIBUTE_CODE_EXISTS", "Attribute code already exists.");
      if (error.code === "P2025") throw missingAttribute();
    }
    throw error;
  }
}

export async function createAttributeValue(attributeId: string, input: AttributeValueCreate) {
  try {
    await prisma.attribute.findUniqueOrThrow({ where: { id: attributeId } });
    return await prisma.attributeValue.create({ data: compact({ ...input, attributeId }) as Prisma.AttributeValueUncheckedCreateInput });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new HttpError(409, "ATTRIBUTE_VALUE_EXISTS", "Attribute value already exists.");
      if (error.code === "P2025") throw missingAttribute();
    }
    throw error;
  }
}

export async function updateAttributeValue(attributeId: string, valueId: string, input: AttributeValueUpdate) {
  try { return await prisma.attributeValue.update({ where: { id: valueId, attributeId }, data: compact(input) as Prisma.AttributeValueUncheckedUpdateInput }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new HttpError(409, "ATTRIBUTE_VALUE_EXISTS", "Attribute value already exists.");
      if (error.code === "P2025") throw missingValue();
    }
    throw error;
  }
}

export async function listCategoryAttributes(categoryId: string, admin = false) {
  await categoryDetail({ id: categoryId }, admin);
  const mappings = await prisma.categoryAttribute.findMany({
    where: admin ? { categoryId } : { categoryId, isActive: true, attribute: { isActive: true }, category: { isActive: true } },
    include: { attribute: { include: { values: { where: admin ? {} : { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } } },
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
      values: attribute.values.map(({ id, value, label, sortOrder }) => ({ id, value, label, sortOrder })),
    })),
  };
}

export async function createCategoryAttribute(categoryId: string, input: CategoryAttributeCreate) {
  const [category, attribute] = await Promise.all([prisma.category.findUnique({ where: { id: categoryId } }), prisma.attribute.findUnique({ where: { id: input.attributeId } })]);
  if (!category?.isActive) throw new HttpError(400, "INACTIVE_CATEGORY", "Only active categories can be mapped.");
  if (!attribute?.isActive) throw new HttpError(400, "INACTIVE_ATTRIBUTE", "Only active attributes can be mapped.");
  try { return await prisma.categoryAttribute.create({ data: compact({ ...input, categoryId }) as Prisma.CategoryAttributeUncheckedCreateInput }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "CATEGORY_ATTRIBUTE_EXISTS", "Category attribute mapping already exists.");
    throw error;
  }
}

export async function updateCategoryAttribute(categoryId: string, attributeId: string, input: CategoryAttributeUpdate) {
  try {
    if (input.isActive) {
      const mapping = await prisma.categoryAttribute.findUniqueOrThrow({ where: { categoryId_attributeId: { categoryId, attributeId } }, include: { category: true, attribute: true } });
      if (!mapping.category.isActive) throw new HttpError(400, "INACTIVE_CATEGORY", "Inactive category mappings cannot be made public.");
      if (!mapping.attribute.isActive) throw new HttpError(400, "INACTIVE_ATTRIBUTE", "Inactive attribute mappings cannot be made public.");
    }
    return await prisma.categoryAttribute.update({ where: { categoryId_attributeId: { categoryId, attributeId } }, data: compact(input) as Prisma.CategoryAttributeUncheckedUpdateInput });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw missingMapping();
    throw error;
  }
}

export async function deactivateCategoryAttribute(categoryId: string, attributeId: string) {
  try { await prisma.categoryAttribute.update({ where: { categoryId_attributeId: { categoryId, attributeId } }, data: { isActive: false } }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw missingMapping();
    throw error;
  }
}
