// Shared between grow.astro (renders the checkboxes) and api/grow.ts
// (reads them back) — one list, not two copies that can drift apart.
// `key` is the checkbox field name (name="service_website" etc.); `label`
// is what actually gets recorded against the GHL contact.
export const AGENCY_SERVICES: { key: string; label: string; blurb: string }[] = [
  {
    key: "website",
    label: "Custom website",
    blurb: "A real site beyond your directory listing — built around what actually gets you calls.",
  },
  {
    key: "reviews",
    label: "Review management",
    blurb: "Requests go out automatically after a job; you respond from one inbox instead of chasing five platforms.",
  },
  {
    key: "missedcall",
    label: "Missed-call text-back",
    blurb: "Miss a call, the caller gets an instant text back — so a busy day never quietly costs you a customer.",
  },
  {
    key: "voiceai",
    label: "AI voice/chat agent",
    blurb: "Answers routine questions and books jobs by phone or chat, day or night, so you're not the bottleneck.",
  },
];
