# Layer 0 — GoHighLevel setup

Manual work in GHL. Do it once per market. Nothing here is code, but the field
**keys** below are a contract: `fetchFromGHL()` in
[`src/lib/directory.ts`](../src/lib/directory.ts) will map them straight onto the
`Listing` type in [`src/types/listing.ts`](../src/types/listing.ts). Rename a key
here and you must rename it there.

Follow the ordering discipline: create the sub-account and the fields, import
listings, get the site looking populated — **then** build workflows. Do not wire
automations before the site is live, or your first prospects land on an empty
directory.

## 1. Sub-account

One GHL sub-account per directory/market. Sending reputation stays isolated, and
each market's contacts stay separate. Ignore GHL's onboarding prompts for email,
phone and calendars for now — none of it is needed to get listings rendering.

## 2. Custom fields

Create these on **Contacts**. The key is what matters; the label is yours.

| Key | Type | Maps to `Listing` |
|---|---|---|
| `business_name` | Text | `businessName` |
| `business_category` | Text / Dropdown | `category` |
| `business_description` | Multi-line | `description` |
| `scraped_address` | Text | `address` |
| `scraped_phone` | Phone | `phone` |
| `listing_slug` | Text | `slug` — URL key, must be unique |
| `google_rating` | Number | `rating` |
| `google_review_count` | Number | `reviewCount` |
| `image_urls` | Multi-line | `imageUrls` (newline- or comma-separated) |
| `hours` | Multi-line | `hours` |
| `social_links` | Multi-line | `socialLinks` (`instagram=https://…` per line) |
| `plan_tier` | Dropdown: `Free` \| `Featured` | `planTier` |
| `claim_status` | Dropdown: `Unclaimed` \| `Pending` \| `Claimed` | `claimStatus` |
| `ai_context` | Multi-line | `aiContext` — knowledge for the Featured agent |
| `agency_client` | Checkbox | `agencyClient` |
| `client_location_id` | Text | `clientLocationId` — their own sub-account |

Layer 2 also needs these; create them now so the claim form has somewhere to write:

| Key | Type | Purpose |
|---|---|---|
| `claim_token` | Text | Unguessable token in the claim URL |
| `tcpa_consent` | Checkbox | The consent that gates outbound AI calling |
| `tcpa_consent_ts` | Date/Text | When they consented |
| `tcpa_consent_ip` | Text | From where |
| `tcpa_consent_version` | Text | Which wording they agreed to |

The four `tcpa_*` fields are the legal record behind Layer 5's courtesy call.
Without them you have no evidence of permission — do not skip them.

## 3. Tags

| Tag | Meaning |
|---|---|
| `business` | **Makes the contact a listing.** Remove it and the listing disappears. |
| `directory_lead` | Came in via the directory, not yet engaged |
| `dir_engaged` | Opened/clicked/replied |
| `dir_claimed` | Claimed their listing — now a hot lead |
| `opt_in_voice` | Consented to AI-assisted calls; the outbound trigger |
| `dir_opt_out` | Suppress everything |

## 4. Private Integration token

Settings → Private Integrations → create one for this sub-account with read and
write on **Contacts** (search, update) and **Custom Fields**. Put it in `.env`:

```
GHL_PIT_TOKEN=...
GHL_LOCATION_ID=...
```

Both are already gitignored. `GHL_LOCATION_ID` is the sub-account id — note that
it ends up publicly visible in image URLs, so treat only the token as secret.

## 5. Importing your first listings

`npm run import` writes both halves at once:

```
npm run import -- prospects.csv --featured "Name A|Name B"
```

- `src/data/mock-listings.json` — the site renders immediately, no GHL needed
- `out/ghl-import.csv` — drop straight into GHL Contacts → Import

**The First Name trap.** GHL requires a first name on every contact, and the
listing title reads from it. If you map the owner's name there, every listing on
your site shows a person's first name instead of the business. The importer
always writes the **business name** into First Name and keeps any owner name in
Last Name. If you import a CSV by hand, check that mapping yourself.

On import, choose "add tag to imported contacts" and pick `business` — every row
becomes a listing in one pass.

## Done when

- A test contact tagged `business` has all the fields above populated.
- 25–50 real businesses are imported, with **at least 3 set to `Featured`** and
  filled out properly. A directory where nothing is featured reads as empty, and
  nobody asks whether those businesses paid.
- Only then: build the outreach workflows (Layer 3) and drop contacts in.
