import { prisma } from "../../config/database.js";
import { categoryDetail } from "../categories/category.service.js";

export async function listCategoryAttributes(categoryId: string) {
  await categoryDetail({ id: categoryId });
  const mappings = await prisma.categoryAttribute.findMany({
    where: {
      categoryId,
      isActive: true,
      attribute: { isActive: true },
      category: { isActive: true },
    },
    include: {
      attribute: {
        include: {
          values: {
            where: { isActive: true },
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
      values: attribute.values.map(({ id, value, label, sortOrder, isActive }) => ({
        id, value, label, sortOrder,
      })),
    })),
  };
}
