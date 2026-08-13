# GHL AI workflow-builder prompts

Six standalone prompts, one per workflow, for pasting into GoHighLevel's AI
workflow builder **one at a time, as separate requests**. Pasting them all at
once (or as one combined prompt) tends to make the AI merge everything into a
single automation — these are written to stand alone so that can't happen.

Each covers one of the automations the app in this repo actually depends on —
see `docs/ghl-layer-0.md` for the full spec these are drawn from (custom
field/tag names, what each workflow's trigger corresponds to in the code).

Two placeholders need filling in before publishing, both in Workflow 3 and
Workflow 5 below — this file is written generically enough to reuse as-is for
a future market's sub-account, not just Central FL Vybe:

- `[YOUR-MARKET-DOMAIN]` / `[PASTE_YOUR_REVIEWS_WEBHOOK_SECRET_HERE]` (Workflow 3)
- `[YOUR MARKET'S VYBE NAME]` (Workflow 5)
- `[PASTE_YOUR_VERCEL_DEPLOY_HOOK_URL_HERE]` (Workflow 1) — every market needs
  its own regardless, since each gets its own Vercel project.

After each one, ask GHL's AI to confirm the workflow name and trigger type
before moving to the next — catches it drifting off-spec early rather than
after all six are built.

---

## 1. Directory Live Sync

```
Build one GoHighLevel workflow called "Directory Live Sync."

Purpose: my website is a static build — it only updates when this workflow tells it to rebuild.

Triggers (any one of these three should fire the same action):
  1. Contact Tag Added — business
  2. Contact Tag Removed — business
  3. Contact Tag Added — plan_featured OR plan_premium (either tag firing is enough)

Filter: exclude any contact tagged dir_opt_out.

Action: Webhook — POST to [PASTE_YOUR_VERCEL_DEPLOY_HOOK_URL_HERE]. No payload needed, no auth headers, just hit the URL.

Publish this workflow when done and confirm the triggers show as "any of the following" (OR), not requiring all three at once.
```

## 2. New Self-Signup Notification

```
Build one GoHighLevel workflow called "New Self-Signup Notification."

Purpose: tell me the moment someone signs up through my website (free or paid) so I can follow up personally.

Trigger: Contact Tag Added — business, AND custom field claim_status = Pending (both conditions must be true, not either/or).

Filter: exclude any contact tagged dir_opt_out.

Action: Internal Notification (or create a Task assigned to me) containing the contact's business_name custom field and plan_tier custom field, so I know at a glance whether it's a free listing or a paying customer to prioritize.

Important: this must NOT fire when claim_status = Unclaimed — only Pending. Unclaimed means I added that listing myself and already know about it.

Publish this workflow when done.
```

## 3. Google Reviews Auto-Backfill

```
Build one GoHighLevel workflow called "Google Reviews Auto-Backfill."

Purpose: new paid listings get their Google star rating pulled in automatically instead of waiting on a manual refresh.

Triggers (either should fire the same action):
  1. Contact Tag Added — business
  2. Contact Updated — filtered to contacts already tagged business

Filter: exclude any contact tagged dir_opt_out.

Action: Webhook — POST to https://[YOUR-MARKET-DOMAIN]/api/webhooks/reviews?secret=[PASTE_YOUR_REVIEWS_WEBHOOK_SECRET_HERE]. No payload needed.

Note: this is safe to fire repeatedly for the same contact — the endpoint on my end only actually does anything the first time a listing gets a rating, every later fire is a harmless no-op. Don't add any logic to prevent repeat firing, it's already handled on my side.

Publish this workflow when done.
```

## 4. Agency Client Auto-Upgrade to Premium

```
Build one GoHighLevel workflow called "Agency Client Auto-Upgrade to Premium."

Purpose: the moment a business becomes a monthly retainer client, their directory listing should automatically become Premium tier — no manual step from me.

Trigger: Contact Updated, filtered specifically to custom field agency_client = true (a checkbox field) — only when that field changes to checked, not on any other update to the contact.

Filter: exclude any contact tagged dir_opt_out.

Actions, in this exact order:
  1. Update Custom Field: plan_tier = Premium
  2. Update Custom Field: claim_status = Claimed
  3. Add Tag: business
  4. Add Tag: plan_premium
  5. Remove Tag: plan_featured

Publish this workflow when done.
```

## 5. New Unclaimed Listing Outreach

```
Build one GoHighLevel workflow called "New Unclaimed Listing Outreach."

Purpose: when I manually import a business I want to invite to claim their free listing, this workflow reaches out to them automatically over about a week, then stops.

Trigger: Contact Tag Added — directory_lead

Filter: exclude any contact tagged dir_opt_out.

Actions, as a sequence with wait steps in between:
  1. Day 0: send an SMS and/or email inviting them to claim their free business listing. Write warm, casual, brand-voice copy — the brand is "[YOUR MARKET'S VYBE NAME]" (e.g. "South FL Vybe") — "Vybe" is always spelled with a Y, never "Vibe." Mention the listing is already live and free forever. Include a clear call to action to claim it.
  2. Wait 3 days.
  3. Condition check: if the contact is NOT tagged dir_claimed AND NOT tagged dir_engaged, send a follow-up message with a different angle — mention what claiming unlocks (control over photos, hours, description).
  4. Wait 4 more days.
  5. Condition check: if the contact is still NOT tagged dir_claimed, send one final follow-up message, then end the sequence. No further automated contact after this.

Exit condition: immediately stop this workflow for any contact who gets tagged dir_claimed or dir_opt_out at any point, even mid-sequence.

Publish this workflow when done.
```

## 6. Outreach Engagement Tracking

```
Build one GoHighLevel workflow called "Outreach Engagement Tracking."

Purpose: know who's actually paying attention to my outreach messages, separate from who's ignoring them.

Trigger (any one of these should fire the same action), filtered to contacts tagged directory_lead:
  1. Email Opened
  2. Email Link Clicked
  3. SMS Reply Received

Filter: exclude any contact tagged dir_opt_out.

Action: Add Tag — dir_engaged

Publish this workflow when done.
```

---

## After GHL's AI builds these — what to check before trusting any of it

1. **Cross-check every field/tag name it used against `docs/ghl-layer-0.md` §2–3, character for character.** AI workflow builders sometimes paraphrase or invent a slightly different key name — if it created `agencyClient` instead of `agency_client`, the app's code will never see it.
2. **Fill in the placeholders yourself** before publishing Workflows 1, 3, and 5 — the AI can't know your Vercel Deploy Hook URL, `REVIEWS_WEBHOOK_SECRET`, domain, or market brand name.
3. **Check "AND" vs "OR" on every filter** — GHL's builder sometimes defaults to OR everywhere even when the prompt said AND. Workflow 2 and Workflow 4 both depend on AND being correct.
4. **Publish every workflow individually** and verify its publish status — an unpublished workflow does nothing at all, silently. This bit us once already with Directory Live Sync's "Contact Tag Added" trigger.
5. **Read the AI-drafted outreach copy in Workflow 5** before it reaches a real person — tone, the "Vybe not Vibe" spelling, and that it doesn't overpromise are all worth a human pass.
6. **Test with one dummy contact per workflow** before trusting any of them live — manually add/remove the relevant tag or flip `agency_client`, and confirm the right thing actually happens (site rebuilds, notification arrives, tags land correctly) rather than assuming it worked.
