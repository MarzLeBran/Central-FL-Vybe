// URL helpers. Kept out of directory.ts so the data contract there stays untouched.

/** "Home Services" -> "home-services". Stable, no listing counts baked in. */
export function categorySlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** First letter of each word, max 2 — the fallback mark when a listing has no image. */
export function initials(businessName: string): string {
  return businessName
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
