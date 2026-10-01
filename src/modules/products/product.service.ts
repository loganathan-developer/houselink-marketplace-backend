import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { ProductListQuery } from "./product.schema.js";
import { HttpError } from "../../shared/errors/http-error.js";

const include = {
  brand: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true, slug: true } },
  variants: {
    where: { isActive: true },
    orderBy: [{ size: "asc" }, { color: "asc" }],
    select: { id: true, sku: true, size: true, color: true, price: true, inventory: { select: { quantity: true } } },
  },
} satisfies Prisma.ProductInclude;

export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: { slug, status: "PUBLISHED", publishedAt: { lte: new Date() } },
    include,
  });
  if (!product) throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found.");
  const basePrice = Number(product.basePrice);
  const rawSale = product.salePrice === null ? null : Number(product.salePrice);
  const salePrice = rawSale !== null && rawSale < basePrice ? rawSale : null;
  const variants = product.variants.map((variant) => ({
    ...variant, price: variant.price === null ? null : Number(variant.price),
    stock: Math.max(0, variant.inventory?.quantity ?? 0),
  }));
  return {
    ...product, basePrice, salePrice, variants,
    discount: salePrice !== null && basePrice > 0 ? Math.round((basePrice - salePrice) / basePrice * 100) : 0,
    images: product.imageUrl ? [product.imageUrl] : [],
    colors: [...new Set(variants.map((variant) => variant.color).filter((value) => value !== null))],
    sizes: [...new Set(variants.map((variant) => variant.size).filter((value) => value !== null))],
    stock: variants.reduce((total, variant) => total + variant.stock, 0),
    attributes: [],
    details: [{ label: "Brand", value: product.brand.name }, { label: "Category", value: product.category.name }],
  };
}

export async function listProducts(query: ProductListQuery) {
  const categoryScope = query.category
    ? { slug: query.category }
    : query.department
      ? { OR: [{ slug: query.department }, { parent: { slug: query.department } }, { parent: { parent: { slug: query.department } } }] }
      : undefined;
  const rows = await prisma.product.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { lte: new Date() },
      ...(categoryScope ? { category: categoryScope } : {}),
      ...(query.collection === "sale" ? { salePrice: { not: null } } : {}),
    },
    include,
    orderBy: query.collection === "new-arrivals"
      ? [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }]
      : [{ createdAt: "desc" }, { id: "asc" }],
  });
  const eligible = query.collection === "sale"
    ? rows.filter((product) => product.salePrice && product.salePrice.lessThan(product.basePrice))
    : rows;
  const start = (query.page - 1) * query.limit;
  const products = eligible.slice(start, start + query.limit).map((product) => ({
    ...product,
    basePrice: Number(product.basePrice),
    salePrice: product.salePrice ? Number(product.salePrice) : null,
    variants: product.variants.map((variant) => ({ ...variant, price: variant.price ? Number(variant.price) : null })),
  }));
  return { products, pagination: { page: query.page, limit: query.limit, total: eligible.length, totalPages: Math.ceil(eligible.length / query.limit) } };
}
