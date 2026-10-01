import { prisma } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import {
  CATEGORY_LOCK,
  MAX_CATEGORY_DEPTH,
} from "../src/modules/categories/category.service.js";

// Stable IDs preserve seeded rows even when an administrator later renames their slug.
const baseSamples: [string, string, number | null][] = [
  ["Men", "men", null],
  ["Topwear", "men-topwear", 0],
  ["T-Shirts", "men-topwear-tshirts", 1],
  ["Shirts", "men-topwear-shirts", 1],
  ["Women", "women", null],
  ["Western Wear", "women-western-wear", 4],
  ["Tops", "women-western-tops", 5],
  ["Dresses", "women-western-dresses", 5],
  ["Kids", "kids", null],
  ["Boys Clothing", "kids-boys-clothing", 8],
  ["T-Shirts", "kids-boys-tshirts", 9],
  ["Home", "home", null],
  ["Bath", "home-bath", 11],
  ["Bath Towels", "home-bath-towels", 12],
  ["Beauty", "beauty", null],
  ["Makeup", "beauty-makeup", 14],
  ["Lipstick", "beauty-makeup-lipstick", 15],
];

type CategoryBranch = {
  name: string;
  slug: string;
  children?: CategoryBranch[];
};

const branch = (
  name: string,
  slug: string,
  children?: CategoryBranch[],
): CategoryBranch => ({ name, slug, children });

const leaves = (parentSlug: string, names: string[]): CategoryBranch[] =>
  names.map((name) =>
    branch(
      name,
      `${parentSlug}-${name
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")}`,
    ),
  );

const taxonomy: CategoryBranch[] = [
  branch("Men", "men", [
    branch("Topwear", "men-topwear", [
      branch("T-Shirts", "men-topwear-tshirts"),
      branch("Shirts", "men-topwear-shirts"),
      ...leaves("men-topwear", ["Casual Shirts", "Formal Shirts", "Sweatshirts", "Sweaters", "Jackets", "Blazers & Coats", "Suits", "Rain Jackets"]),
    ]),
    branch("Indian & Festive Wear", "men-indian-festive-wear", leaves("men-indian-festive-wear", ["Kurtas & Kurta Sets", "Sherwanis", "Nehru Jackets", "Dhotis"])),
    branch("Bottomwear", "men-bottomwear", leaves("men-bottomwear", ["Jeans", "Casual Trousers", "Formal Trousers", "Shorts", "Track Pants & Joggers"])),
    branch("Innerwear & Sleepwear", "men-innerwear-sleepwear", leaves("men-innerwear-sleepwear", ["Briefs & Trunks", "Boxers", "Vests", "Sleepwear & Loungewear", "Thermals"])),
    branch("Footwear", "men-footwear", leaves("men-footwear", ["Casual Shoes", "Sports Shoes", "Formal Shoes", "Sneakers", "Sandals & Floaters", "Flip Flops", "Socks"])),
    branch("Sports & Active Wear", "men-sports-active-wear", leaves("men-sports-active-wear", ["Sports Shoes", "Sports Sandals", "Active T-Shirts", "Track Pants & Shorts", "Tracksuits", "Jackets & Sweatshirts", "Sports Accessories", "Swimwear"])),
    branch("Fashion Accessories", "men-fashion-accessories", leaves("men-fashion-accessories", ["Wallets", "Belts", "Perfumes & Body Mists", "Trimmers", "Deodorants", "Ties, Cufflinks & Pocket Squares", "Accessory Gift Sets", "Caps & Hats", "Mufflers, Scarves & Gloves", "Rings & Wristwear", "Bags & Backpacks", "Luggages & Trolleys"])),
  ]),
  branch("Women", "women", [
    branch("Indian & Fusion Wear", "women-indian-fusion-wear", leaves("women-indian-fusion-wear", ["Kurtas & Suits", "Kurtis, Tunics & Tops", "Sarees", "Ethnic Wear", "Leggings, Salwars & Churidars", "Skirts & Palazzos", "Dress Materials", "Lehenga Cholis", "Dupattas & Shawls", "Jackets"])),
    branch("Western Wear", "women-western-wear", [
      branch("Tops", "women-western-tops"),
      branch("Dresses", "women-western-dresses"),
      ...leaves("women-western", ["T-Shirts", "Jeans", "Trousers & Capris", "Shorts & Skirts", "Co-ords", "Playsuits", "Jumpsuits", "Shrugs", "Sweaters & Sweatshirts", "Jackets & Coats", "Blazers & Waistcoats"]),
    ]),
    branch("Footwear", "women-footwear", leaves("women-footwear", ["Flats", "Casual Shoes", "Heels", "Boots", "Sports Shoes & Floaters"])),
    branch("Sports & Active Wear", "women-sports-active-wear", leaves("women-sports-active-wear", ["Clothing", "Footwear", "Sports Accessories", "Sports Equipment"])),
    branch("Lingerie & Sleepwear", "women-lingerie-sleepwear", leaves("women-lingerie-sleepwear", ["Bra", "Briefs", "Shapewear", "Sleepwear & Loungewear", "Swimwear", "Camisoles & Thermals"])),
    branch("Beauty & Personal Care", "women-beauty-personal-care", leaves("women-beauty-personal-care", ["Makeup", "Skincare", "Premium Beauty", "Lipsticks", "Fragrances"])),
    branch("Jewellery", "women-jewellery", leaves("women-jewellery", ["Fashion Jewellery", "Fine Jewellery", "Earrings"])),
    branch("Bags", "women-bags", leaves("women-bags", ["Backpacks", "Handbags, Bags & Wallets", "Luggages & Trolleys"])),
  ]),
  branch("Kids", "kids", [
    branch("Boys Clothing", "kids-boys-clothing", [
      branch("T-Shirts", "kids-boys-tshirts"),
      ...leaves("kids-boys", ["Shirts", "Shorts", "Jeans", "Trousers", "Clothing Sets", "Ethnic Wear", "Track Pants & Pyjamas", "Jacket, Sweater & Sweatshirts", "Party Wear", "Innerwear & Thermals", "Nightwear & Loungewear", "Value Packs"]),
    ]),
    branch("Girls Clothing", "kids-girls-clothing", leaves("kids-girls", ["Dresses", "Tops", "T-Shirts", "Clothing Sets", "Lehenga Choli", "Kurta Sets", "Party Wear", "Dungarees & Jumpsuits", "Skirts & Shorts", "Tights & Leggings", "Jeans, Trousers & Capris", "Jacket, Sweater & Sweatshirts", "Innerwear & Thermals", "Nightwear & Loungewear", "Value Packs"])),
    branch("Footwear", "kids-footwear", leaves("kids-footwear", ["Casual Shoes", "Flip Flops", "Sports Shoes", "Flats", "Sandals", "Heels", "School Shoes", "Socks"])),
    branch("Infants", "kids-infants", leaves("kids-infants", ["Bodysuits", "Rompers & Sleepsuits", "Clothing Sets", "T-Shirts & Tops", "Dresses", "Bottom Wear", "Winter Wear", "Innerwear & Sleepwear", "Infant Care"])),
    branch("Toys & Games", "kids-toys-games", leaves("kids-toys-games", ["Learning & Development", "Activity Toys", "Soft Toys", "Action Figures & Play Sets"])),
    branch("Kids Accessories", "kids-accessories", leaves("kids-accessories", ["Bags & Backpacks", "Watches", "Jewellery & Hair Accessories", "Sunglasses", "Caps & Hats"])),
  ]),
  branch("Beauty", "beauty", [
    branch("Makeup", "beauty-makeup", leaves("beauty-makeup", ["Lipstick", "Lip Gloss", "Lip Liner", "Mascara", "Eyeliner", "Kajal", "Eyeshadow", "Foundation", "Primer", "Concealer", "Compact", "Nail Polish"])),
    branch("Skincare, Bath & Body", "beauty-skincare-bath-and-body", leaves("beauty-skincare", ["Face Moisturiser", "Cleanser", "Masks & Peel", "Sunscreen", "Serum", "Face Wash", "Eye Cream", "Lip Balm", "Body Lotion", "Body Wash", "Body Scrub", "Hand Cream"])),
    branch("Haircare", "beauty-haircare", leaves("beauty-haircare", ["Shampoo", "Conditioner", "Hair Cream", "Hair Oil", "Hair Gel", "Hair Color", "Hair Serum", "Hair Accessory"])),
    branch("Fragrances", "beauty-fragrances", leaves("beauty-fragrances", ["Perfume", "Deodorant", "Body Mist"])),
    branch("Appliances", "beauty-appliances", leaves("beauty-appliances", ["Hair Straightener", "Hair Dryer", "Epilator"])),
    branch("Men's Grooming", "beauty-men-s-grooming", leaves("beauty-mens-grooming", ["Trimmers", "Beard Oil", "Hair Wax"])),
  ]),
  branch("Footwear", "footwear", [
    branch("Men Footwear", "footwear-men-footwear", leaves("footwear-men", ["Casual Shoes", "Sports Shoes", "Flip Flops & Sandals", "Formal Shoes", "Loafers"])),
    branch("Women Footwear", "footwear-women-footwear", leaves("footwear-women", ["Heels & Sandals", "Flats", "Boots", "Flip Flops & Slippers", "Bellies & Ballerinas"])),
    branch("Kids Footwear", "footwear-kids-footwear", leaves("footwear-kids", ["Boys Shoes", "Girls Shoes", "Casual Shoes", "Flip Flops & Slippers", "Sandals"])),
  ]),
  branch("Accessories", "accessories", [
    branch("Men Accessories", "accessories-men-accessories", leaves("accessories-men", ["Watches", "Wallets", "Jewellery", "Sunglasses & Spectacle Frames", "Belts"])),
    branch("Women Accessories", "accessories-women-accessories", leaves("accessories-women", ["Watches", "Hair Accessories", "Belts", "Sunglasses & Spectacle Frames", "Scarves, Stoles & Gloves"])),
    branch("Bags", "accessories-bags", leaves("accessories-bags", ["Backpacks", "Handbags", "Sling Bags", "Wallets", "Clutches", "Waist Bags", "Crossbody Bags", "Duffel & Trolley Bags", "Laptop & Messenger Bags"])),
    ...leaves("accessories", ["Jewellery", "Watches", "Sunglasses"]),
  ]),
];

const samples = [...baseSamples];
const sampleIndexBySlug = new Map(
  samples.map(([, slug], index) => [slug, index]),
);

function appendBranch(item: CategoryBranch, parentSlug: string | null) {
  let index = sampleIndexBySlug.get(item.slug);
  if (index === undefined) {
    const parentIndex = parentSlug
      ? (sampleIndexBySlug.get(parentSlug) ?? null)
      : null;
    index = samples.push([item.name, item.slug, parentIndex]) - 1;
    sampleIndexBySlug.set(item.slug, index);
  }
  for (const child of item.children ?? []) appendBranch(child, item.slug);
}

for (const root of taxonomy) appendBranch(root, null);

const tshirtAttributes = [
  {
    name: "Brand",
    code: "brand",
    sortOrder: 1,
    isRequired: true,
    isVariantOption: false,
    values: [
      ["houselink", "HouseLink"],
      ["urban_stitch", "Urban Stitch"],
      ["dailywear", "Dailywear"],
    ],
  },
  {
    name: "Size",
    code: "size",
    sortOrder: 2,
    isRequired: true,
    isVariantOption: true,
    values: [
      ["s", "S"],
      ["m", "M"],
      ["l", "L"],
      ["xl", "XL"],
    ],
  },
  {
    name: "Color",
    code: "color",
    sortOrder: 3,
    isRequired: true,
    isVariantOption: true,
    values: [
      ["black", "Black"],
      ["white", "White"],
      ["blue", "Blue"],
      ["red", "Red"],
    ],
  },
  {
    name: "Fabric",
    code: "fabric",
    sortOrder: 4,
    isRequired: false,
    isVariantOption: false,
    values: [
      ["cotton", "Cotton"],
      ["polyester", "Polyester"],
      ["linen", "Linen"],
    ],
  },
  {
    name: "Fit",
    code: "fit",
    sortOrder: 5,
    isRequired: false,
    isVariantOption: false,
    values: [
      ["slim", "Slim"],
      ["regular", "Regular"],
      ["oversized", "Oversized"],
    ],
  },
  {
    name: "Pattern",
    code: "pattern",
    sortOrder: 6,
    isRequired: false,
    isVariantOption: false,
    values: [
      ["solid", "Solid"],
      ["printed", "Printed"],
      ["striped", "Striped"],
      ["checked", "Checked"],
    ],
  },
  {
    name: "Sleeve Length",
    code: "sleeve_length",
    sortOrder: 7,
    isRequired: false,
    isVariantOption: false,
    values: [
      ["half_sleeve", "Half Sleeve"],
      ["full_sleeve", "Full Sleeve"],
      ["sleeveless", "Sleeveless"],
    ],
  },
] as const;

const domainAttributes = [
  { name: "Material", code: "material", values: [["cotton", "Cotton"], ["leather", "Leather"], ["synthetic", "Synthetic"], ["metal", "Metal"]] },
  { name: "Occasion", code: "occasion", values: [["casual", "Casual"], ["formal", "Formal"], ["party", "Party"], ["sports", "Sports"], ["festive", "Festive"]] },
  { name: "Gender", code: "gender", values: [["men", "Men"], ["women", "Women"], ["boys", "Boys"], ["girls", "Girls"], ["unisex", "Unisex"]] },
  { name: "Age Group", code: "age_group", values: [["infant", "Infant"], ["2_5_years", "2-5 Years"], ["6_9_years", "6-9 Years"], ["10_14_years", "10-14 Years"]] },
  { name: "Shoe Size", code: "shoe_size", values: [["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"], ["8", "8"], ["9", "9"], ["10", "10"], ["11", "11"]] },
  { name: "Heel Type", code: "heel_type", values: [["flat", "Flat"], ["block", "Block"], ["kitten", "Kitten"], ["platform", "Platform"], ["stiletto", "Stiletto"]] },
  { name: "Sole Material", code: "sole_material", values: [["rubber", "Rubber"], ["eva", "EVA"], ["pu", "PU"], ["leather", "Leather"]] },
  { name: "Beauty Type", code: "beauty_type", values: [["makeup", "Makeup"], ["skincare", "Skincare"], ["haircare", "Haircare"], ["fragrance", "Fragrance"], ["appliance", "Appliance"]] },
  { name: "Skin Type", code: "skin_type", values: [["normal", "Normal"], ["dry", "Dry"], ["oily", "Oily"], ["combination", "Combination"], ["sensitive", "Sensitive"]] },
  { name: "Hair Type", code: "hair_type", values: [["straight", "Straight"], ["wavy", "Wavy"], ["curly", "Curly"], ["coily", "Coily"], ["all", "All Hair Types"]] },
  { name: "Finish", code: "finish", values: [["matte", "Matte"], ["glossy", "Glossy"], ["natural", "Natural"], ["satin", "Satin"], ["shimmer", "Shimmer"]] },
  { name: "Shade/Color", code: "shade_color", values: [["light", "Light"], ["medium", "Medium"], ["deep", "Deep"], ["multicolor", "Multicolor"]] },
  { name: "Fragrance Type", code: "fragrance_type", values: [["floral", "Floral"], ["fresh", "Fresh"], ["woody", "Woody"], ["oriental", "Oriental"], ["citrus", "Citrus"]] },
] as const;

const profileCodes = {
  apparel: ["size", "color", "fabric", "fit", "pattern", "sleeve_length", "material", "occasion", "gender"],
  kids: ["size", "color", "fabric", "age_group", "gender", "pattern"],
  footwear: ["shoe_size", "color", "material", "occasion", "gender", "heel_type", "sole_material"],
  beauty: ["beauty_type", "skin_type", "hair_type", "finish", "shade_color", "fragrance_type"],
  accessories: ["color", "material", "gender", "occasion"],
} as const;

export async function seedCategorySamples() {
  if (env.NODE_ENV === "production")
    throw new Error("Sample categories are development data only");
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CATEGORY_LOCK})`;
      const canonicalGrooming = await tx.category.findUnique({
        where: { slug: "beauty-men-s-grooming" },
        select: { id: true },
      });
      const duplicateGrooming = await tx.category.findUnique({
        where: { slug: "beauty-mens-grooming" },
        select: { id: true },
      });
      if (canonicalGrooming && duplicateGrooming) {
        await tx.category.updateMany({
          where: { parentId: duplicateGrooming.id },
          data: { parentId: canonicalGrooming.id },
        });
        await tx.categoryAttribute.deleteMany({
          where: { categoryId: duplicateGrooming.id },
        });
        await tx.category.delete({ where: { id: duplicateGrooming.id } });
      }
      const ids: (string | null)[] = [];
      for (const [index, [name, slug, parentIndex]] of samples.entries()) {
        const id = `d5000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`;
        const existingBySlug = await tx.category.findUnique({
          where: { slug },
          select: { id: true },
        });
        if (existingBySlug) {
          ids[index] = existingBySlug.id;
          continue;
        }
        const parentId =
          parentIndex === null ? null : (ids[parentIndex] ?? null);
        if (
          parentIndex !== null && parentId === null
        ) {
          ids[index] = null;
          continue;
        }
        let ancestor = parentId,
          depth = 1;
        while (ancestor !== null) {
          if (++depth > MAX_CATEGORY_DEPTH)
            throw new Error("Sample parent exceeds safe hierarchy depth");
          ancestor = (
            await tx.category.findUniqueOrThrow({
              where: { id: ancestor },
              select: { parentId: true },
            })
          ).parentId;
        }
        const idIsAvailable = !(await tx.category.findUnique({
          where: { id },
          select: { id: true },
        }));
        const created = await tx.category.create({
          data: {
            ...(idIsAvailable ? { id } : {}),
            name,
            slug,
            parentId,
            sortOrder: index,
            isActive: true,
          },
          select: { id: true },
        });
        ids[index] = created.id;
      }
      const tshirts =
        (await tx.category.findUnique({
          where: { id: "d5000000-0000-4000-8000-000000000003" },
          select: { id: true },
        })) ??
        (await tx.category.findFirst({
          where: {
            slug: "men-topwear-tshirts",
            parent: { slug: "men-topwear", parent: { slug: "men" } },
          },
          select: { id: true },
        }));
      if (!tshirts)
        throw new Error(
          "Cannot seed T-Shirt attributes: expected Men > Topwear > T-Shirts category is missing",
        );
      for (const item of tshirtAttributes) {
        const attribute = await tx.attribute.upsert({
          where: { code: item.code },
          update: {},
          create: {
            name: item.name,
            code: item.code,
            type: "SELECT",
            isActive: true,
          },
        });
        for (const [index, [value, label]] of item.values.entries()) {
          await tx.attributeValue.upsert({
            where: { attributeId_value: { attributeId: attribute.id, value } },
            update: {},
            create: {
              attributeId: attribute.id,
              value,
              label,
              sortOrder: index + 1,
              isActive: true,
            },
          });
        }
        await tx.categoryAttribute.upsert({
          where: {
            categoryId_attributeId: {
              categoryId: tshirts.id,
              attributeId: attribute.id,
            },
          },
          update: {},
          create: {
            categoryId: tshirts.id,
            attributeId: attribute.id,
            isRequired: item.isRequired,
            isFilterable: true,
            isVariantOption: item.isVariantOption,
            sortOrder: item.sortOrder,
            isActive: true,
          },
        });
      }

      for (const item of domainAttributes) {
        const attribute = await tx.attribute.upsert({
          where: { code: item.code },
          update: {},
          create: {
            name: item.name,
            code: item.code,
            type: "SELECT",
            isActive: true,
          },
        });
        await tx.attributeValue.createMany({
          data: item.values.map(([value, label], index) => ({
            attributeId: attribute.id,
            value,
            label,
            sortOrder: index + 1,
            isActive: true,
          })),
          skipDuplicates: true,
        });
      }

      const attributes = await tx.attribute.findMany({
        where: { code: { in: [...new Set(Object.values(profileCodes).flat())] } },
        select: { id: true, code: true },
      });
      const attributeIdByCode = new Map(
        attributes.map((attribute) => [attribute.code, attribute.id]),
      );
      const leafCategories = await tx.category.findMany({
        where: {
          isActive: true,
          children: { none: {} },
          OR: [
            { parent: { slug: { in: ["men", "women", "kids", "beauty", "footwear", "accessories"] } } },
            { parent: { parent: { slug: { in: ["men", "women", "kids", "beauty", "footwear", "accessories"] } } } },
          ],
        },
        select: {
          id: true,
          name: true,
          parent: { select: { slug: true, parent: { select: { slug: true } } } },
        },
      });
      const apparelCategoryIds: string[] = [];

      for (const category of leafCategories) {
        if (!category.parent) continue;
        const rootSlug = category.parent.parent?.slug ?? category.parent.slug;
        const sectionSlug = category.parent.slug;
        let codes: readonly string[];
        if (rootSlug === "beauty") codes = profileCodes.beauty;
        else if (rootSlug === "footwear") codes = profileCodes.footwear;
        else if (rootSlug === "accessories") codes = profileCodes.accessories;
        else if (rootSlug === "kids") {
          codes = sectionSlug === "kids-footwear"
            ? [...profileCodes.footwear, "age_group"]
            : profileCodes.kids;
        } else if (sectionSlug.includes("footwear")) codes = profileCodes.footwear;
        else if (
          sectionSlug.includes("accessories") ||
          sectionSlug.includes("jewellery") ||
          sectionSlug.includes("bags")
        ) codes = profileCodes.accessories;
        else if (sectionSlug.includes("beauty")) codes = profileCodes.beauty;
        else {
          codes = profileCodes.apparel;
          apparelCategoryIds.push(category.id);
        }

        if (/belt|ring|glove|sock/i.test(category.name)) {
          codes = [...codes, "size"];
        }
        await tx.categoryAttribute.createMany({
          data: [...new Set(codes)].flatMap((code, index) => {
            const attributeId = attributeIdByCode.get(code);
            return attributeId
              ? [{
                  categoryId: category.id,
                  attributeId,
                  isRequired: false,
                  isFilterable: true,
                  isVariantOption: ["size", "color", "shoe_size", "shade_color"].includes(code),
                  sortOrder: index + (codes === profileCodes.apparel ? 2 : 1),
                  isActive: true,
                }]
              : [];
          }),
          skipDuplicates: true,
        });
      }
      for (const [code, sortOrder] of [["material", 8], ["occasion", 9], ["gender", 10]] as const) {
        const attributeId = attributeIdByCode.get(code);
        if (attributeId) {
          await tx.categoryAttribute.updateMany({
            where: { categoryId: { in: apparelCategoryIds }, attributeId },
            data: { sortOrder },
          });
        }
      }
    },
    { timeout: 60000 },
  );
}
