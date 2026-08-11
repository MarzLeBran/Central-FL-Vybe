// Single source of truth for the TCPA consent checkbox.
//
// The claim page, the add-business page, and the write path in submissions.ts
// all import from here, so the version string recorded against a contact always
// matches the exact wording that person actually saw and agreed to.
//
// Wording transcribed verbatim from the reference directory's registration form
// (see docs/consumer-accounts.md). Bump TCPA_CONSENT_VERSION any time the text
// changes below — that string is what tcpa_consent_version proves in a dispute,
// so a silent wording edit with no version bump defeats the point of recording it.

export const TCPA_CONSENT_VERSION = "2026-08-v2";

export const TCPA_CONSENT_TEXT =
  "I consent to receive AI-assisted calls and SMS text messages, including " +
  "marketing and informational messages, from this business. Consent is not " +
  "a condition of purchase. Message frequency varies. Message and data rates " +
  "may apply. Text DELETE to unsubscribe from text messages at any time.";
