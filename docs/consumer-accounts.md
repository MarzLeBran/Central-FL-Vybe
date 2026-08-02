# Consumer accounts — spec (not yet built)

Captured from the reference directory. **Committed to the roadmap, deliberately
not built yet** — see "Why it isn't next" at the bottom.

Lets any visitor register, sign in, and manage a profile: claim a business,
follow businesses, track listing requests. It is the hub the claim flow (L2) and
the deferred content types (L6) both hang off.

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

## Why it isn't next

The funnel does not need it. Businesses get claimed via a tokenised link from the
outreach email (L2) — no account required. Consumer accounts add reach and
stickiness, which matter once there is traffic to be sticky about.

Order stays: **L1 front door → L2 claim + add-business → L3 outreach → then this.**
