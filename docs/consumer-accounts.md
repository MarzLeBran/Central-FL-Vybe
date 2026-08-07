# Consumer accounts

Captured from the reference directory, then built out for real (see "Status:
built" below). Lets any visitor register, sign in, follow businesses, and
manage a small profile — separate from the business-owner side (`/manage`).

## Status: built

Register/login (magic-link, no password), follow/unfollow a listing (heart
button on `ListingCard.astro` and the detail page), a profile page
(`/account` — avatar upload, list of followed listings, sign out), and a
share button (no login required) are all live. Files: `src/lib/consumers.ts`
(read), `src/lib/consumer-submissions.ts` (write), `src/pages/account/*`,
`src/pages/api/account/*`, `src/components/FollowButtons.astro`. A consumer
is a GHL contact tagged `consumer` — see `docs/ghl-layer-0.md`'s tags table —
deliberately never linked to a claimed listing's contact even when the same
email is used for both (see "Deliberately not built" below).

**Not built**, from the original reference-inspired spec further down this
doc: the richer profile tabs (Owned Business, Listing Requests, Applied Jobs,
Events Activity — all depend on features that don't exist yet either, per
the doc's own note under "4. Profile"). What shipped is "About" (name/avatar)
+ "Following" only.

## Narrower slice built first: owner self-serve listing editing

`/manage/*` (`src/lib/auth.ts`) is the separate "a claimed, paid-tier owner
edits their own listing" system — magic-link, no password, no users table,
the GHL contact is the source of truth, sessions are signed cookies. It
predates and remains fully independent of the consumer-accounts system above
— see "Deliberately not built" for why they're not linked.

Magic-link delivery uses GHL's own Conversations API
(`POST /conversations/messages`, reusing `GHL_PIT_TOKEN` — no new vendor) in
`sendMagicLinkEmail()` (`src/lib/auth.ts`). **The exact request body shape was
unverified at build time — smoke-test against a live sandbox contact before
trusting this with real owners.** If it doesn't pan out, swap in Resend
(`RESEND_API_KEY`, documented in `.env.example`) as a raw-fetch call, same
convention already used for GHL/Stripe elsewhere in this repo.

An internal admin editor also exists at `/manage/admin`, behind a separate
shared `ADMIN_PASSWORD` — lets you edit any listing (claimed or not, any tier)
on a client's behalf, reusing the same edit UI (`ListingEditForm.astro`) and
write path.

## Screens

### 1. Create account
Logo, then: **First Name**, **Last Name**, **Email**, **Phone (optional)**,
consent checkbox, reCAPTCHA, submit.

The consent box is **unchecked by default** and is the legal record behind every
outbound AI call. Store the wording verbatim in `tcpa_consent_version` so you can
prove later what a given person actually agreed to. Current reference wording:

> I consent to receive marketing and informational text messages and automated or
> prerecorded voice calls (including AI-assisted calls) from this business.
> Consent is not a condition of purchase. Message frequency varies. Message and
> data rates may apply. Text STOP to unsubscribe from text messages at any time.

reCAPTCHA is not optional — an open registration form on a directory is a spam
magnet.

### 2. Welcome email
Sent immediately on registration. Greets by first name, lists three next steps
(complete profile / explore listings / add a listing), links to the site.

**Do not copy the reference's version of this email — see the security note.**

### 3. Sign in
Email, password, "Forgot Password", link to Create account.

### 4. Profile
Cover photo + avatar, **Edit Profile** and **Change Password**, and tabs:

| Tab | Shows | Depends on |
|---|---|---|
| About | full name, phone, location, email, status | — |
| Owned Business | listings this user has claimed | L2 claim flow |
| Listing Requests | add-business submissions and their state | L2 add-business |
| Followed Business | businesses they follow | follow feature (new) |
| Applied Jobs | job applications | L6 jobs |
| Events Activity | event RSVPs | L6 events |

Four of the six tabs are empty until other layers exist. Build the shell with
About + Owned Business, and add tabs as their features land.

## Security note — do not replicate this

The reference's welcome email **contains the user's password in plaintext**:

```
Email: marztrunk@gmail.com
Password: BED3UhQMEPK&
```

That is a genuine defect, not a design choice to copy. It means the password was
either generated server-side and mailed, or is stored recoverably — and either
way it now sits permanently in an inbox, in mail server logs, and in any forward
of that message. People reuse passwords, so the blast radius is not limited to
this directory.

**Recommended instead: passwordless magic-link auth.**

- No password to store, leak, reset, or email.
- Sidesteps "Change Password" and "Forgot Password" as features entirely.
- The GHL contact stays the single source of truth — the token is signed with a
  server secret, not backed by a user table.
- Already the approach Path-B assumed for the owner dashboard.

If you do want passwords, they must be hashed (argon2/bcrypt), never emailed, and
set by the user via a one-time link — never generated for them.

## Architecture impact

Two things make this bigger than it looks:

1. **It breaks static-only.** Auth needs server routes for callback, session
   cookies, and logout. The site is currently pure SSG with no adapter, so this
   requires adding `@astrojs/vercel` and switching output mode — the same change
   L2's form endpoints need. Do it once, for L2.
2. **"No separate database" still has to hold** (golden rule 1). A consumer is a
   GHL contact, distinguished from a listing by not carrying the `business` tag.
   Sessions are signed cookies, not rows. If a design starts needing a users
   table, stop and re-check the rule.

Reference terminology worth keeping: a person is a **consumer contact**; linking
one to a listing is what a claim does. An admin can also link them manually.

## Why it wasn't next (historical — built anyway, per the owner's request)

The funnel doesn't strictly need it: businesses get claimed via a tokenised
link from the outreach email (L2), no account required. Consumer accounts
were originally planned as an "after L3 outreach" layer, added for reach and
stickiness once there was traffic to be sticky about. The owner asked for it
ahead of that sequence — see "Status: built" above.

## Deliberately not built: linking a consumer account to a claimed listing

A consumer contact (`consumer` tag) and a listing's contact (`business` tag)
are completely separate identities, even if the same person registers with
the same email they later use to claim a business via `/claim`. `/claim` has
zero session/auth awareness — it's still the same anonymous public form it
always was. If that integration is ever wanted (e.g. "claiming from inside a
logged-in session auto-fills the claim form," or "an owner's `/manage` and
`/account` merge into one identity"), it needs its own design pass — don't
assume it falls out of what's here for free.
