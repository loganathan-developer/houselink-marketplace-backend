import { prisma } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { seedCategorySamples } from "./category-samples.js";
import { seedDevelopmentBrands } from "./seed-brands.js";

const products = [
  ["Tailored Linen Shirt", "tailored-linen-shirt", "men-topwear-casual-shirts", "h-m", 2499, null, "https://images.unsplash.com/photo-1603252110481-7ba873bf42ab?auto=format&fit=crop&w=900&q=85", ["M", "L", "XL"]],
  ["Essential Cotton T-Shirt", "essential-cotton-tshirt", "men-topwear-tshirts", "roadster", 1299, 899, "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=85", ["S", "M", "L", "XL"]],
  ["Relaxed Wide-Leg Jeans", "relaxed-wide-leg-jeans", "women-western-jeans", "h-m", 2999, 2399, "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=85", ["26", "28", "30", "32"]],
  ["Everyday Ribbed Top", "everyday-ribbed-top", "women-western-tops", "roadster", 1499, null, "https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?auto=format&fit=crop&w=900&q=85", ["S", "M", "L"]],
  ["Kids Graphic Tee", "kids-graphic-tee", "kids-boys-tshirts", "puma", 899, 649, "https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=900&q=85", ["4-5Y", "6-7Y", "8-9Y"]],
  ["Girls Weekend Dress", "girls-weekend-dress", "kids-girls-dresses", "h-m", 1599, null, "https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?auto=format&fit=crop&w=900&q=85", ["4-5Y", "6-7Y", "8-9Y"]],
  ["Air Motion Running Shoes", "air-motion-running-shoes", "footwear-men-sports-shoes", "nike", 6499, 5199, "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85", ["7", "8", "9", "10"]],
  ["Classic Court Sneakers", "classic-court-sneakers", "women-footwear-casual-shoes", "adidas", 4999, null, "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=85", ["4", "5", "6", "7"]],
  ["Velvet Matte Lip Color", "velvet-matte-lip-color", "beauty-makeup-lipstick", "h-m", 999, 749, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?auto=format&fit=crop&w=900&q=85", ["Rose", "Berry", "Nude"]],
  ["Daily Hydration Serum", "daily-hydration-serum", "beauty-skincare-serum", "puma", 1399, null, "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=900&q=85", ["30ml"]],
  ["Structured City Backpack", "structured-city-backpack", "accessories-bags-backpacks", "roadster", 2799, 2199, "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=85", ["One Size"]],
  ["Minimal Leather Belt", "minimal-leather-belt", "accessories-men-belts", "h-m", 1199, null, "https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=900&q=85", ["M", "L", "XL"]],
  ["Relaxed Heavyweight T-Shirt", "relaxed-heavyweight-tshirt", "men-topwear-tshirts", "h-m", 1599, 1199, "https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=900&q=85", ["S", "M", "L", "XL"]],
  ["Core Crew Neck T-Shirt", "core-crew-neck-tshirt", "men-topwear-tshirts", "puma", 1099, null, "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&w=900&q=85", ["S", "M", "L", "XL"]],
  ["Everyday Oversized T-Shirt", "everyday-oversized-tshirt", "men-topwear-tshirts", "roadster", 1399, 999, "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=85", ["S", "M", "L", "XL"]],
  ["Soft Structure Top", "soft-structure-top", "women-western-tops", "h-m", 1899, 1499, "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=900&q=85", ["XS", "S", "M", "L"]],
  ["Minimal Everyday Blouse", "minimal-everyday-blouse", "women-western-tops", "roadster", 2199, null, "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=85", ["XS", "S", "M", "L"]],
  ["Modern Draped Top", "modern-draped-top", "women-western-tops", "h-m", 2399, 1899, "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=900&q=85", ["XS", "S", "M", "L"]],
  ["Junior Stripe T-Shirt", "junior-stripe-tshirt", "kids-boys-tshirts", "h-m", 999, 749, "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=900&q=85", ["4-5Y", "6-7Y", "8-9Y", "10-11Y"]],
  ["Adventure Print T-Shirt", "adventure-print-tshirt", "kids-boys-tshirts", "puma", 1199, null, "https://images.unsplash.com/photo-1519457431-44ccd64a579b?auto=format&fit=crop&w=900&q=85", ["4-5Y", "6-7Y", "8-9Y", "10-11Y"]],
  ["Weekend Colorblock T-Shirt", "weekend-colorblock-tshirt", "kids-boys-tshirts", "roadster", 1099, 799, "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?auto=format&fit=crop&w=900&q=85", ["4-5Y", "6-7Y", "8-9Y", "10-11Y"]],
  ["Satin Finish Lipstick", "satin-finish-lipstick", "beauty-makeup-lipstick", "h-m", 1199, 899, "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&q=85", ["Rosewood", "Coral", "Plum"]],
  ["Longwear Creme Lipstick", "longwear-creme-lipstick", "beauty-makeup-lipstick", "roadster", 1299, null, "https://images.unsplash.com/photo-1631214524020-7e18db9a8f92?auto=format&fit=crop&w=900&q=85", ["Ruby", "Mauve", "Nude"]],
  ["Hydrating Lip Colour", "hydrating-lip-colour", "beauty-makeup-lipstick", "h-m", 899, 699, "https://images.unsplash.com/photo-1457972729786-0411a3b2b626?auto=format&fit=crop&w=900&q=85", ["Blush", "Berry", "Mocha"]],
  ["Everyday Court Shoes", "everyday-court-shoes", "footwear-men-casual-shoes", "adidas", 4599, 3799, "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=85", ["7", "8", "9", "10"]],
  ["Urban Low-Top Sneakers", "urban-low-top-sneakers", "footwear-men-casual-shoes", "nike", 5499, null, "https://images.unsplash.com/photo-1560769629-975ec94e6a86?auto=format&fit=crop&w=900&q=85", ["7", "8", "9", "10"]],
  ["Classic Suede Casual Shoes", "classic-suede-casual-shoes", "footwear-men-casual-shoes", "puma", 4999, 3999, "https://images.unsplash.com/photo-1600269452121-4f2416e55c28?auto=format&fit=crop&w=900&q=85", ["7", "8", "9", "10"]],
  ["Canvas Street Sneakers", "canvas-street-sneakers", "footwear-men-casual-shoes", "roadster", 2999, 2299, "https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=900&q=85", ["7", "8", "9", "10"]],
  ["Minimal Steel Watch", "minimal-steel-watch", "accessories-men-watches", "roadster", 3499, 2799, "https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=900&q=85", ["One Size"]],
  ["Classic Leather Watch", "classic-leather-watch", "accessories-men-watches", "h-m", 4299, null, "https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=900&q=85", ["One Size"]],
  ["Chronograph Statement Watch", "chronograph-statement-watch", "accessories-men-watches", "puma", 5999, 4799, "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=900&q=85", ["One Size"]],
  ["Modern Black Dial Watch", "modern-black-dial-watch", "accessories-men-watches", "roadster", 3899, 3199, "https://images.unsplash.com/photo-1533139502658-0198f920d8e8?auto=format&fit=crop&w=900&q=85", ["One Size"]],
] as const;

export async function seedDevelopmentProducts() {
  if (env.NODE_ENV === "production") throw new Error("Sample products are development data only");
  await seedCategorySamples();
  await seedDevelopmentBrands();
  const now = Date.now();
  for (const [index, item] of products.entries()) {
    const [name, slug, categorySlug, brandSlug, basePrice, salePrice, imageUrl, sizes] = item;
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: categorySlug }, select: { id: true } });
    const brand = await prisma.brand.findUniqueOrThrow({ where: { slug: brandSlug }, select: { id: true } });
    const product = await prisma.product.upsert({
      where: { slug },
      update: {
        name, categoryId: category.id, brandId: brand.id, status: "PUBLISHED",
        description: `${name} designed for dependable everyday wear.`, basePrice, salePrice, imageUrl,
      },
      create: {
        name, slug, categoryId: category.id, brandId: brand.id, status: "PUBLISHED",
        description: `${name} designed for dependable everyday wear.`, basePrice, salePrice, imageUrl,
        publishedAt: new Date(now - index * 3_600_000), createdAt: new Date(now - index * 3_600_000),
      },
    });
    for (const [variantIndex, size] of sizes.entries()) {
      const sku = `FORME-${String(index + 1).padStart(3, "0")}-${String(variantIndex + 1).padStart(2, "0")}`;
      const variant = await prisma.productVariant.upsert({
        where: { sku }, update: {},
        create: { productId: product.id, sku, size, color: variantIndex % 2 ? "Black" : "Natural" },
      });
      await prisma.inventory.upsert({ where: { variantId: variant.id }, update: {}, create: { variantId: variant.id, quantity: 8 + index + variantIndex } });
    }
  }
}

seedDevelopmentProducts()
  .then(() => console.log("Development products seeded"))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
