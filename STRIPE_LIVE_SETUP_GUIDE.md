# SnipeJob — Stripe Live Account Setup Guide

> **This guide is for setting up a brand-new Stripe account from scratch.**
> You are NOT migrating test → live on an existing account — you are starting fresh.
> Estimated time: 45–90 minutes (mostly waiting for Stripe's identity verification).

---

## Pre-flight checklist (do before starting)

- [ ] You have access to the Cloudflare dashboard (to update Worker secrets)
- [ ] You are in the `my-sniper-worker/` folder in your terminal (needed for `wrangler` commands)
- [ ] You are logged into `npx wrangler` — run `npx wrangler whoami` to confirm
- [ ] You have your business/personal ID handy (Stripe will ask for it during activation)
- [ ] Your bank account details are ready for payout setup

---

## Step 1 — Create your Stripe account

1. Go to **https://stripe.com** → click **Start now** (top-right).
2. Enter your email, full name, country, and a strong password.
3. Confirm your email address (Stripe sends a verification link).
4. You land in the Stripe Dashboard in **test mode** (top-left toggle shows orange "Test mode").

> Checkpoint: Dashboard header shows your name and you can see the homepage metrics.

---

## Step 2 — Activate your Stripe account (required for live payments)

1. Find the **"Activate your account"** orange banner → click it.
2. Fill in the activation form:
   - **Business type**: Individual / Sole proprietor or your company type
   - **Business address & phone**: real contact info
   - **Personal details**: legal name, date of birth (ID verification)
   - **Industry**: Software / SaaS / Technology
   - **Bank account**: your payout bank details
3. Submit. Usually instant; up to 2 business days if flagged.
4. Wait for **"Payments enabled"** status.

> Checkpoint: Dashboard shows "Payments enabled" — not "Restricted" or "Pending".

---

## Step 3 — Switch to Live Mode

1. Click the **mode toggle** top-left → switch **Test mode → Live mode**.
2. The header changes from orange to dark/black.

> IMPORTANT: Test and live products/prices are completely separate. Everything created here is live-only.

---

## Step 4 — Create your products and price IDs

Go to **Products** → **+ Add product**.

### Product 1: SnipeJob Pro — Monthly
- Name: `SnipeJob Pro — Monthly`
- Price: `$9.00` / Monthly / USD
- Save → copy the **Price ID** (starts with `price_live_...`)
- Record: `Monthly Price ID: _________________________________`

### Product 2: SnipeJob Pro — Annual (Founding Rate)
- Name: `SnipeJob Pro — Annual (Founding Rate)`
- Price: `$90.00` / Yearly / USD
- Save → copy the **Price ID**
- Record: `Annual Price ID: _________________________________`

> Checkpoint: Both products appear in Products list in live mode with `price_live_...` IDs.

---

## Step 5 — Get your live API keys

**Developers → API keys** (in live mode).

- **Publishable key**: `pk_live_...` (safe for frontend)
- **Secret key**: `sk_live_...` (Worker secrets ONLY — never in HTML)

Click **Reveal** next to the secret key → copy it.

Record:
- `Publishable key: _________________________________`
- `Secret key: _________________________________` ← keep private

---

## Step 6 — Register the webhook endpoint

**Developers → Webhooks → + Add endpoint**

- **Endpoint URL**: `https://my-sniper-worker.daniellancce1.workers.dev/api/payment/webhook`
- **Events to listen to**:
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `customer.subscription.deleted`
  - `customer.subscription.updated`
- Save → open the endpoint → **Signing secret → Reveal** → copy `whsec_...`
- Record: `Webhook signing secret: _________________________________`

> Checkpoint: Webhook shows "Enabled" in the list.

---

## Step 7 — Enable the Customer Portal

**Settings (gear icon) → Billing → Customer portal**

- Toggle ON
- Enable: Cancel subscriptions, Update payment methods, View invoice history
- Save changes
- Copy the **Customer portal link** (`https://billing.stripe.com/p/login/live_...`)
- Record: `Customer portal URL: _________________________________`

---

## Step 8 — Update Cloudflare Worker secrets

From inside `my-sniper-worker/` in your terminal:

```
npx wrangler secret put STRIPE_SECRET_KEY
# paste: sk_live_...

npx wrangler secret put STRIPE_WEBHOOK_SECRET
# paste: whsec_...

npx wrangler secret put STRIPE_PRO_PRICE_ID
# paste: price_live_... (monthly)

npx wrangler secret put STRIPE_PRO_ANNUAL_PRICE_ID
# paste: price_live_... (annual)

npx wrangler deploy
```

> Checkpoint: Visit https://my-sniper-worker.daniellancce1.workers.dev/debug/env — every flag = true.

---

## Step 9 — Update index.html (publishable key + portal URL)

Open `index.html` → search for these constants near the top of the script block:

### 9a — Publishable key
Search for `pk_test_` or `STRIPE_PUBLISHABLE_KEY`

```js
// Replace with:
const STRIPE_PUBLISHABLE_KEY = 'pk_live_YOUR_LIVE_KEY_HERE';
```

### 9b — Customer Portal URL
Search for `STRIPE_CUSTOMER_PORTAL_URL`

```js
// Replace with:
const STRIPE_CUSTOMER_PORTAL_URL = 'https://billing.stripe.com/p/login/live_YOUR_PORTAL_URL';
```

Save → push to GitHub:

```
git add index.html
git commit -m "chore: switch to live Stripe keys"
git push origin main
```

> Checkpoint: App rebuilds in ~60 seconds. View source — confirm `pk_live_` is present, not `pk_test_`.

---

## Step 10 — Update the Sales Funnel

Open `funnel/snipe_jobs_sales_funnel.html`:
- Search for `OFFER_DEADLINE` — update if the date has expired
- The funnel calls the Worker API directly — no other changes needed since the Worker secrets are already updated

> Checkpoint: Open funnel → "Claim founding rate" → Stripe Checkout shows $90/year with NO "TEST MODE" banner.

---

## Step 11 — Test with a real card

1. Funnel → "Get Pro monthly" → use your own real card → complete payment
2. Stripe Dashboard → Payments → confirm $9.00 "Succeeded"
3. Supabase → profiles → find your email → confirm `current_tier = 'paid'`
4. **Immediately refund yourself**: Stripe → Payments → charge → Refund → Full refund
5. Test in-app upgrade: free user → Dashboard → Upgrade → Monthly → real card → confirm Pro → refund

> Checkpoint: Both paths work end-to-end. Webhook deliveries show 200.

---

## Step 12 — Final go-live checklist

- [ ] Stripe account: "Payments enabled"
- [ ] Monthly product created, price_live_... ID recorded and set in Worker
- [ ] Annual product created, price_live_... ID recorded and set in Worker
- [ ] STRIPE_SECRET_KEY = sk_live_... set in Worker secrets
- [ ] STRIPE_WEBHOOK_SECRET = whsec_... (live endpoint secret) set in Worker secrets
- [ ] npx wrangler deploy ran after all secret updates
- [ ] /debug/env shows all true
- [ ] index.html publishable key = pk_live_...
- [ ] STRIPE_CUSTOMER_PORTAL_URL = live portal URL in index.html
- [ ] index.html pushed to GitHub, Pages rebuilt
- [ ] Real card test on funnel path succeeded
- [ ] Real card test on in-app upgrade succeeded
- [ ] Webhook deliveries show 200
- [ ] Test refunds issued
- [ ] Payout schedule confirmed in Stripe → Balances → Payouts

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| "No such price" | Test price ID with live secret key | Use price_live_... IDs in live mode |
| "Could not start checkout" (Annual) | `STRIPE_PRO_ANNUAL_PRICE_ID` secret is missing in Wrangler | Run `npx wrangler secret put STRIPE_PRO_ANNUAL_PRICE_ID` and redeploy |
| 400 "Webhook signature mismatch" | Wrong whsec_ value | Re-copy from live webhook endpoint → re-run wrangler secret put STRIPE_WEBHOOK_SECRET → redeploy |
| Checkout shows "TEST MODE" | pk_test_ still in index.html | Update STRIPE_PUBLISHABLE_KEY to pk_live_... and push |
| "Could not start checkout" | Worker not deployed after secret update | Run npx wrangler deploy inside my-sniper-worker/ |
| User still free after paying | Webhook not delivered | Check Stripe → Webhooks → Recent deliveries; run npx wrangler tail |
| "Manage subscription" broken | Portal not activated or test URL | Activate portal in Stripe → update STRIPE_CUSTOMER_PORTAL_URL in index.html |
| /debug/env shows false | Wrong working directory | Must run wrangler commands from inside my-sniper-worker/ |

---

## Your live Stripe values (fill in as you go)

```
Stripe Account Email:        ________________________________
Stripe Account ID:           acct____________________________

Monthly Price ID:            price_live______________________
Annual Price ID:             price_live______________________

Publishable Key:             pk_live_________________________
Secret Key:                  sk_live_________________________ (KEEP PRIVATE)

Webhook Signing Secret:      whsec___________________________
Webhook Endpoint:            https://my-sniper-worker.daniellancce1.workers.dev/api/payment/webhook

Customer Portal URL:         https://billing.stripe.com/p/login/live_______________

Payout Bank (last 4):        ____
First Payout Expected:       ________________________________
```

---

*SnipeJob V3 | Created: 2026-07-06 | See also: SNIPEJOB_MASTER_DOCUMENTATION.md Section 6 and Section 14*
