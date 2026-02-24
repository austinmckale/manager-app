export type ServiceTagOption = {
  slug: string;
  label: string;
  aliases: string[];
};

export const SERVICE_TAG_OPTIONS: ServiceTagOption[] = [
  {
    slug: "general-remodeling",
    label: "General Remodeling",
    aliases: ["general", "remodel", "remodeling", "renovation", "home improvement"],
  },
  {
    slug: "kitchen-remodeling",
    label: "Kitchen Remodeling",
    aliases: ["kitchen", "kitchen remodel", "kitchen remodeling"],
  },
  {
    slug: "bathroom-remodeling",
    label: "Bathroom Remodeling",
    aliases: ["bath", "bathroom", "bathroom remodel", "bathroom remodeling"],
  },
  {
    slug: "drywall",
    label: "Drywall",
    aliases: ["drywall", "sheetrock", "texture"],
  },
  {
    slug: "flooring",
    label: "Flooring",
    aliases: ["floor", "flooring", "tile", "vinyl", "hardwood"],
  },
  {
    slug: "roofing",
    label: "Roofing",
    aliases: ["roof", "roofing", "shingle"],
  },
  {
    slug: "water-damage",
    label: "Water Damage",
    aliases: ["water", "water damage", "flood", "leak", "mitigation"],
  },
  {
    slug: "fire-damage",
    label: "Fire Damage",
    aliases: ["fire", "fire damage", "smoke"],
  },
  {
    slug: "insurance-restoration",
    label: "Insurance Restoration",
    aliases: ["insurance", "insurance claim", "restoration"],
  },
  {
    slug: "basement-finishing",
    label: "Basement Finishing",
    aliases: ["basement", "basement finish", "basement finishing"],
  },
  {
    slug: "paver-installation",
    label: "Paver Installation",
    aliases: ["paver", "pavers", "patio", "walkway", "hardscape"],
  },
];

const SERVICE_TAG_SET = new Set(SERVICE_TAG_OPTIONS.map((option) => option.slug));

export function isServiceTag(value: string) {
  return SERVICE_TAG_SET.has(value);
}

export function normalizeServiceTags(tags: string[]) {
  const deduped = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized) continue;
    if (isServiceTag(normalized)) {
      deduped.add(normalized);
    }
  }
  return [...deduped];
}

export function inferServiceTagFromText(text: string | null | undefined) {
  if (!text) return null;
  const normalized = text.toLowerCase();
  for (const option of SERVICE_TAG_OPTIONS) {
    if (option.aliases.some((alias) => normalized.includes(alias))) {
      return option.slug;
    }
  }
  return null;
}

