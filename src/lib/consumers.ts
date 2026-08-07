// ─────────────────────────────────────────────────────────────────────────────
// THE CONSUMER READ ADAPTER — parallel to src/lib/directory.ts, but for
// ordinary site visitors (tag `consumer`) rather than listings (tag
// `business`). Deliberately a separate file/tag/identity — see
// docs/consumer-accounts.md: a consumer contact never carries `business`,
// and this repo does not link a consumer account to a claimed listing even
// if the same email is used for both.
//
// GHL mode mirrors directory.ts's searchAllContacts/getCustomFieldKeyMap
// pattern verbatim (duplicated here rather than exported from directory.ts,
// to avoid touching that file's surface at all).
// ─────────────────────────────────────────────────────────────────────────────

const DATA_SOURCE = import.meta.env.DATA_SOURCE ?? "mock";
const GHL_VERSION = "2021-07-28";

export interface Consumer {
  id: string; // GHL contact id
  email?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
  followedSlugs: string[]; // followed_listings (CSV, same convention as image_urls)
}

// ── Mock mode ──────────────────────────────────────────────────────────────
// Unlike listings (a static JSON import), consumer accounts need correct
// read-your-own-write within one dev-server process — register, then
// immediately log in, then follow something. A module-level Map gives that
// for free; it resets on dev-server restart, which is fine (just re-register
// while iterating locally). `upsertMockConsumer` is called only from
// src/lib/consumer-submissions.ts's mock branch — not meant for page code.
const mockConsumers = new Map<string, Consumer>();

export function upsertMockConsumer(consumer: Consumer): void {
  mockConsumers.set(consumer.id, consumer);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getConsumerById(id?: string): Promise<Consumer | null> {
  if (!id) return null;
  if (DATA_SOURCE !== "ghl") return mockConsumers.get(id) ?? null;
  const contacts = await searchAllConsumerContacts();
  const keyMap = await getCustomFieldKeyMap();
  const match = contacts.find((c) => c.id === id);
  return match ? mapContactToConsumer(match, keyMap) : null;
}

export async function getConsumerByEmail(email?: string): Promise<Consumer | null> {
  if (!email) return null;
  const needle = email.trim().toLowerCase();
  if (DATA_SOURCE !== "ghl") {
    return [...mockConsumers.values()].find((c) => c.email?.toLowerCase() === needle) ?? null;
  }
  const contacts = await searchAllConsumerContacts();
  const keyMap = await getCustomFieldKeyMap();
  const match = contacts.find((c) => (c.email ?? "").toLowerCase() === needle);
  return match ? mapContactToConsumer(match, keyMap) : null;
}

// ── GHL implementation ─────────────────────────────────────────────────────

async function searchAllConsumerContacts(): Promise<any[]> {
  const token = import.meta.env.GHL_PIT_TOKEN;
  const locationId = import.meta.env.GHL_LOCATION_ID;
  const pageLimit = 100;
  const all: any[] = [];
  let searchAfter: [number, string] | undefined;

  while (true) {
    const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId,
        pageLimit,
        filters: [{ field: "tags", operator: "contains", value: "consumer" }],
        ...(searchAfter ? { searchAfter } : {}),
      }),
    });
    if (!res.ok) throw new Error(`GHL fetch failed: ${res.status}`);
    const data = await res.json();
    const contacts = data.contacts ?? [];
    all.push(...contacts);
    if (contacts.length < pageLimit) break;
    const last = contacts[contacts.length - 1];
    searchAfter = [Date.parse(last.dateAdded), last.id];
  }
  return all;
}

let customFieldKeyMapPromise: Promise<Map<string, string>> | null = null;

function getCustomFieldKeyMap(): Promise<Map<string, string>> {
  if (!customFieldKeyMapPromise) {
    customFieldKeyMapPromise = (async () => {
      const token = import.meta.env.GHL_PIT_TOKEN;
      const locationId = import.meta.env.GHL_LOCATION_ID;
      const res = await fetch(
        `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
        { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION } }
      );
      if (!res.ok) throw new Error(`GHL customFields fetch failed: ${res.status}`);
      const data = await res.json();
      const map = new Map<string, string>();
      for (const f of data.customFields ?? []) {
        const key = f.key ?? f.fieldKey;
        map.set(f.id, key?.startsWith("contact.") ? key.slice("contact.".length) : key);
      }
      return map;
    })();
  }
  return customFieldKeyMapPromise;
}

function mapContactToConsumer(c: any, keyMap: Map<string, string>): Consumer {
  const cf = (key: string) => {
    const field = (c.customFields ?? []).find(
      (f: any) => f.key === key || keyMap.get(f.id) === key
    );
    return field?.value;
  };

  return {
    id: c.id,
    email: c.email || undefined,
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    phone: c.phone || undefined,
    avatarUrl: cf("avatar_url") || undefined,
    followedSlugs: parseList(cf("followed_listings")),
  };
}

const parseList = (v: any) =>
  Array.isArray(v) ? v : (v ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
