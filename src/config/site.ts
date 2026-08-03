// ─────────────────────────────────────────────────────────────────────────────
// PER-MARKET CONFIG — the only file you change to spin up a new city.
//
// One codebase, one deploy per market (AGENTS.md § Architecture). To launch
// "Space Coast" alongside this one: fork the deploy, change the values below,
// point DATA_SOURCE/GHL env vars at that market's sub-account, attach its domain.
//
// Nothing else in the app hardcodes a place name.
// ─────────────────────────────────────────────────────────────────────────────

export const site = {
  /**
   * Nameplate, as it reads in the masthead.
   * "VYBE" is spelled with a Y on purpose — it is the brand, not a typo.
   * Do not "correct" it anywhere in this codebase or in copy.
   */
  name: "Central FL Vybe",

  /** The market, spelled out. Used in copy and page titles. */
  market: "Central Florida",

  /** Towns covered — shown in the dateline strip under the masthead.
   *  First one is also used in the home page's "Run a business in ___?" CTA. */
  towns: ["Orlando", "Kissimmee", "St. Cloud", "Sanford", "Melbourne"],

  /**
   * COUNTIES — the second browse axis, alongside category.
   *
   * One directory covers all seven Central Florida counties including the Space
   * Coast, rather than splitting into separate market deploys. A visitor can
   * filter by county, by category, or by both (`/county/orange/restaurants`).
   *
   * `cities` drives automatic county assignment at import time — the importer
   * matches a listing's address against these names, longest first. Add a city
   * here and the next import files it correctly; nothing else changes.
   *
   * Watch the border towns: Poinciana straddles Osceola/Polk and Davenport sits
   * just inside Polk. Whichever list a city appears in wins, so if a scrape
   * starts filing them wrongly, move the name rather than adding it twice.
   */
  counties: [
    {
      name: "Orange",
      seat: "Orlando",
      blurb: "Orlando, Winter Park and the theme-park corridor.",
      cities: [
        "Orlando", "Winter Park", "Apopka", "Ocoee", "Winter Garden", "Maitland",
        "Windermere", "Belle Isle", "Edgewood", "Eatonville", "Bay Lake", "Doctor Phillips",
      ],
    },
    {
      name: "Osceola",
      seat: "Kissimmee",
      blurb: "Kissimmee, St. Cloud and the lakes to the south.",
      cities: [
        "Kissimmee", "St. Cloud", "Saint Cloud", "Celebration", "Harmony",
        "Narcoossee", "Poinciana", "Buenaventura Lakes",
      ],
    },
    {
      name: "Seminole",
      seat: "Sanford",
      blurb: "Sanford, Lake Mary and the north side.",
      cities: [
        "Sanford", "Altamonte Springs", "Lake Mary", "Longwood", "Oviedo",
        "Winter Springs", "Casselberry", "Heathrow",
      ],
    },
    {
      name: "Lake",
      seat: "Tavares",
      blurb: "Clermont, Mount Dora and the rolling hills to the west.",
      cities: [
        "Clermont", "Leesburg", "Eustis", "Tavares", "Mount Dora", "Groveland",
        "Minneola", "Lady Lake", "Umatilla", "Fruitland Park", "Astatula",
        "Mascotte", "Howey-in-the-Hills",
      ],
    },
    {
      name: "Brevard",
      seat: "Titusville",
      blurb: "The Space Coast — Melbourne, Titusville and the beaches.",
      cities: [
        "Melbourne", "West Melbourne", "Palm Bay", "Titusville", "Cocoa Beach", "Cocoa",
        "Rockledge", "Merritt Island", "Viera", "Satellite Beach", "Cape Canaveral",
        "Indialantic", "Indian Harbour Beach", "Suntree",
      ],
    },
    {
      name: "Volusia",
      seat: "DeLand",
      blurb: "Daytona Beach, DeLand and the north-east coast.",
      cities: [
        "Daytona Beach", "South Daytona", "Deltona", "DeLand", "Ormond Beach",
        "Port Orange", "New Smyrna Beach", "Edgewater", "DeBary", "Orange City",
        "Holly Hill", "Ponce Inlet", "Lake Helen", "Pierson",
      ],
    },
    {
      name: "Polk",
      seat: "Bartow",
      blurb: "Lakeland, Winter Haven and the citrus belt.",
      cities: [
        "Lakeland", "Winter Haven", "Bartow", "Haines City", "Auburndale",
        "Davenport", "Lake Wales", "Mulberry", "Polk City", "Dundee",
        "Frostproof", "Lake Alfred", "Eagle Lake",
      ],
    },
  ],

  /** The official tagline, as it appears locked up in the logo. */
  tagline: "Where Central Florida Does Business",

  /**
   * Canonical origin, no trailing slash. Feeds canonical/og tags and the
   * JSON-LD @id on every listing. Not registered yet — confirm the exact
   * domain before launch, since changing it later moves every canonical URL.
   */
  origin: "https://cflvybe.com",

  /** Shown in the footer. */
  established: 2026,

  /** Support address for claim questions. */
  contactEmail: "hello@cflvybe.com",

  /**
   * Brand assets in `public/`. All were generated from the originals kept in
   * `brand/` (see docs/brand-assets.md) — 21 MB of source PNGs down to ~1 MB
   * of web-ready files. Leave `logo` empty and the header falls back to type.
   * The two lockups are true vector SVGs with a transparent background — no
   * white plate behind them, so they sit cleanly on the dark theme too.
   */
  logo: "/logo.svg",
  logoAlt: "Central FL Vybe",
  logoTagline: "/logo-tagline.svg",

  /** Home page hero. Two widths; the browser picks via srcset. */
  hero: {
    src: "/hero-2000.webp",
    srcSmall: "/hero-1200.webp",
    alt: "Aerial view of downtown Orlando and the Central Florida lakes at sunset",
  },

  /** 1200x630 social card. */
  ogImage: "/og-image.jpg",

  /** Shown on a listing tile that has no photos of its own. */
  fallbackImage: "/logo-tagline.svg",

  /**
   * DIRECTORY PLANS — what a business can buy on the directory itself.
   * This is NOT the GHL agency retainer; that is sold separately and never
   * appears on /pricing.
   *
   * `id` matches PlanTier in src/types/listing.ts and the GHL `plan_tier`
   * field. Names are marketing and can change freely without touching data.
   */
  plans: [
    {
      id: "free",
      name: "Day Pass",
      badge: "On the house",
      price: "Free",
      period: "always",
      blurb: "Get found in Central Florida — a real page with your map, hours and links.",
      cta: { label: "Add your business", href: "/add-business" },
      hue: "lagoon",
      highlight: false,
    },
    {
      id: "featured",
      name: "Spotlight",
      badge: "Best value",
      price: "$250",
      period: "per year",
      blurb: "Stand out from the crowd and turn views into real customers.",
      // Upgrading presupposes an already-claimed listing — checkout (Layer 4)
      // lives on the listing's own page (business/[slug].astro), not here.
      // Send visitors to find/claim their listing first rather than skip
      // straight to a plan with no listing in scope.
      cta: { label: "Find your listing", href: "/listings" },
      hue: "sun",
      highlight: true,
    },
    {
      id: "premium",
      name: "All Access",
      badge: "All in",
      price: "$699",
      period: "per year",
      blurb: "Own the room — premium placement, maximum visibility, your own AI agent.",
      cta: { label: "Find your listing", href: "/listings" },
      hue: "coral",
      highlight: false,
    },
  ],

  /**
   * The feature matrix behind /pricing. One row per line; the three booleans
   * are free / featured / premium in that order. Keep this the single source of
   * truth — the listing page should read from it rather than hardcoding which
   * tier shows what.
   *
   * Deliberately absent: "Google map on listing". The reference directory gates
   * it behind its mid tier, but the Maps Embed API is free with unlimited
   * requests, so gating it would withhold something that costs us nothing. Every
   * listing gets a map; the Day Pass blurb says so. See docs/google-apis.md.
   */
  planFeatures: [
    { label: "Profile & cover image", free: true, featured: true, premium: true },
    { label: "Address", free: true, featured: true, premium: true },
    { label: "Phone", free: true, featured: true, premium: true },
    { label: "Email address", free: true, featured: true, premium: true },
    { label: "Website", free: true, featured: true, premium: true },
    { label: "Business hours", free: true, featured: true, premium: true },
    { label: "Social media links", free: true, featured: true, premium: true },
    { label: "AEO business description", free: true, featured: true, premium: true },
    { label: "Site reviews", free: true, featured: true, premium: true },
    { label: "Google reviews", free: false, featured: true, premium: true },
    { label: "Custom blog", free: false, featured: true, premium: true },
    { label: "Add events", free: false, featured: true, premium: true },
    { label: "Share news stories", free: false, featured: true, premium: true },
    { label: "Feature your team", free: false, featured: true, premium: true },
    { label: "Post jobs", free: false, featured: true, premium: true },
    { label: "Additional images", free: false, featured: true, premium: true },
    { label: "Extra links", free: false, featured: true, premium: true },
    { label: "Embed custom code", free: false, featured: true, premium: true },
    { label: "YouTube video", free: false, featured: true, premium: true },
    { label: "Special offers", free: false, featured: true, premium: true },
    { label: "Online visibility report ($99 value)", free: false, featured: true, premium: true },
    { label: "AI review response ($299 value)", free: false, featured: false, premium: true },
    { label: "60-sec promotional video ($299 value)", free: false, featured: false, premium: true },
    { label: "AI agent for your listing ($599 value)", free: false, featured: false, premium: true },
  ],

  /**
   * Header navigation groups. Each lists the raw `category` values from the
   * data that belong under it — the same names the CSV import writes.
   *
   * Grouping is presentation only; categories stay flat in the data contract.
   * Any category NOT named here still appears, under a "More" group, so a new
   * category from an import can never silently vanish from the nav. Groups with
   * no matching listings are hidden.
   */
  categoryGroups: [
    {
      name: "Dining",
      categories: [
        "Restaurants", "Bakeries", "Café & Brunch", "Mexican Restaurant", "Pizza", "Sushi",
      ],
    },
    {
      name: "Services",
      categories: [
        "Home Services", "Electrical", "Landscaping & Lawn Care", "Plumbing", "Roofing",
        "Real Estate Agents", "Health & Wellness", "Auto Repair", "Auto Services",
        "Auto Detailing", "Accountants / CPAs", "DJs & Entertainment", "Financial Advisors",
      ],
    },
    {
      name: "Retail",
      categories: [
        "Nail Salons", "Hair Salons", "Barbershops", "Barbershop", "Health & Beauty",
        "Bookstores", "Party Rentals", "Car Wash & Detailing", "Clothing Boutiques",
        "Dance Studios", "Music Schools", "Florists",
      ],
    },
  ],

  /**
   * "Explore" dropdown — editorial sections, not categories. Each becomes a
   * link only once `enabled` is true, so nothing here can 404 before the page
   * behind it exists (all four are Layer 7). The whole dropdown hides while
   * none are enabled.
   */
  exploreLinks: [
    { label: "Local Spotlight", href: "/spotlight", enabled: false },
    { label: "Local Events", href: "/events", enabled: false },
    { label: "News Stories", href: "/news", enabled: false },
    { label: "Who's Hiring", href: "/jobs", enabled: false },
  ],

  /**
   * The directory's own channels. Fill a url in and it renders in the footer
   * and the home page channel strip; leave it empty and it is skipped entirely,
   * so you can ship before every account exists.
   */
  channels: [
    { name: "YouTube", handle: "@cflvybe", url: "" },
    { name: "Instagram", handle: "@cflvybe", url: "" },
    { name: "TikTok", handle: "@cflvybe", url: "" },
    { name: "Facebook", handle: "Central FL Vybe", url: "" },
  ],
} as const;
