// Category colour-coding — the signature of the design system.
//
// Every category owns a hue, and that hue follows it everywhere: card marks,
// the home index, category pages, listing accents.
//
// A plain hash of the name collides badly at these counts (9 hues, 6 categories
// -> two pairs shared a colour), which defeats the whole point. So we hash to a
// starting slot and then probe forward for a free one, assigning over the whole
// sorted category set at once. Distinct categories therefore get distinct hues
// until there are more than nine of them.
//
// Trade-off worth knowing: because assignment is set-wide, importing a new
// category can shift the hue of one that collided with it. Colours are stable
// between builds of the same data, not across a data import. Distinctness is
// worth more here than permanence.
//
// Hue class names are authored in styles/global.css (`.hue-citrus` etc.), so
// building the class name dynamically is safe — these are real CSS rules, not
// Tailwind utilities a scanner has to find.

import { getListingsByCategory } from "./directory";

// Ordered so the three brand hues from the logo (coral, sun, lagoon) get used
// first when a directory has only a handful of categories.
export const HUES = [
  "coral",
  "sun",
  "lagoon",
  "flamingo",
  "mango",
  "surf",
  "lime",
  "orchid",
  "deep",
] as const;

export type Hue = (typeof HUES)[number];

/** FNV-1a — stable across builds and machines. */
function hash(key: string): number {
  let h = 0x811c9dc5;
  const k = key.trim().toLowerCase();
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Assign every category a hue, probing past collisions. Exported for tests. */
export function assignHues(categories: string[]): Map<string, Hue> {
  const assigned = new Map<string, Hue>();
  const taken = new Set<Hue>();

  for (const category of [...categories].sort()) {
    const start = hash(category) % HUES.length;
    let hue = HUES[start]!;

    if (taken.size < HUES.length) {
      for (let i = 0; i < HUES.length; i++) {
        const candidate = HUES[(start + i) % HUES.length]!;
        if (!taken.has(candidate)) {
          hue = candidate;
          break;
        }
      }
    }

    taken.add(hue);
    assigned.set(category, hue);
  }

  return assigned;
}

let cache: Map<string, Hue> | null = null;

/** The live map for this build. Computed once, from the real category set. */
export async function categoryHues(): Promise<Map<string, Hue>> {
  if (!cache) {
    const byCategory = await getListingsByCategory();
    cache = assignHues(Object.keys(byCategory));
  }
  return cache;
}

/** The class that sets --h / --h-ink / --h-deep for everything inside it. */
export async function hueClass(category: string): Promise<string> {
  const hues = await categoryHues();
  return `hue-${hues.get(category) ?? HUES[hash(category) % HUES.length]!}`;
}
