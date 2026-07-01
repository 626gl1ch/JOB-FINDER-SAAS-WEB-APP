# SnipeJob — Master Documentation & Setup Guide

**This is the one file to keep.** It replaces every other `.txt`/`.md` guide floating around the two project folders (deployment steps, CORS fixes, payment directions, bug logs, audit reports, grace-period setup, funnel hosting guide, PRD). Everything useful from those files has been folded in here, de-duplicated, and — where two documents disagreed — reconciled against what the actual code in your latest zips does.

**Last consolidated:** July 2026
**Covers:** SnipeJob SaaS app + Cloudflare Worker API + Supabase database + Sales Funnel + Stripe (test & live) + Resend expiry emails + affiliate network + GitHub Actions scraper

> Once you've confirmed this file has everything you need, you can safely delete: `FINAL_DEPLOYMENT_STEPS.txt`, `HOSTING.md`, `MANUAL_STEPS_TO_FIX_CORS_AND_DEPLOY.txt`, `PAYMENT_SETUP_DIRECTIONS.txt`, `SnipeJob_Fix_And_Launch_Guide.txt`, `developer_notes.txt`, `MASTER_README.txt`, `SETUP_GUIDE__master_deployment.txt`, `SETUP_GUIDE__stripe_live.txt`, `SETUP_GUIDE__bug_fix_log.txt`, `BUG_FIX_AUDIT_REPORT.txt`, `GRACE_PERIOD_EMAIL_SYSTEM_SETUP.txt`, `SALES_FUNNEL_INTEGRATION_STEPS.txt`, `SnipeJob_Funnel_Hosting_Payment_Verification_Guide.txt`. Keep `SnipeJob_PRD.md` if you want the full sales/acquisition write-up — its useful facts are summarized in Section 1 here too.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture & Tech Stack](#2-architecture--tech-stack)
3. [Repository / File Map](#3-repository--file-map)
4. [Environment Variables & Secrets Reference](#4-environment-variables--secrets-reference)
5. [Full Setup From Zero — Step by Step](#5-full-setup-from-zero--step-by-step)
6. [Switching Stripe: Test → Live](#6-switching-stripe-test--live)
7. [End-to-End Test Checklist](#7-end-to-end-test-checklist)
8. [Known Issues & Things Flagged, Not Yet Fixed](#8-known-issues--things-flagged-not-yet-fixed)
9. [Troubleshooting / Common Errors](#9-troubleshooting--common-errors)
10. [Maintenance Reference (Quick SQL & CLI)](#10-maintenance-reference-quick-sql--cli)
11. [Change Log](#11-change-log)
12. [Roadmap](#12-roadmap)
13. [Quick Reference — Fill In Your Live URLs](#13-quick-reference--fill-in-your-live-urls)

---

## 1. Product Overview

**SnipeJob** — *"Land Freelance Work First."* An AI-powered job-discovery SaaS for freelancers, with a built-in affiliate income engine.

**Free vs Pro ($9/mo or $90/yr founding annual rate):**

| Feature | Free | Pro |
|---|---|---|
| Job feed (5 sources) | ✅ | ✅ |
| Sectors visible | Choose 3 | All 16 |
| Job pinning & dashboard | ✅ | ✅ |
| AI profile autofill at signup | ✅ | ✅ |
| AI job match scoring | Keyword-based | Full Gemini fit analysis |
| One-click AI proposal writer (AI Apply) | ❌ | ✅ |
| AI resume scoring | ✅ | ✅ + full AI rewrite |
| AI mock interview prep | 3 generic questions | 5 tailored + AI scoring |
| Sector trend insights | ✅ | ✅ |
| Side Task affiliate earnings | ✅ (monthly payout) | ✅ (instant payout) |
| Dashboard ads | Shown | None |

**Core features:** multi-source live job aggregation (Reddit, We Work Remotely, Remotive, Himalayas, Freelancer.com) via a scraper cron; Gemini-powered profile autofill, job matching, AI Apply, resume scoring/rewrite, interview prep, sector trend intelligence; a "Side Task" affiliate offer wall (30% cut to user, 70% kept); AI-assisted ID verification (KYC) gating withdrawals; a lightweight project/contract tracker.

**Monetization (3 streams):** Stripe subscriptions, affiliate revenue share (CPALead), display ads on free tier.

**Honest gaps to know about (from the original PRD, still true unless you've since changed them):**
- No live user base / revenue history yet — marketing testimonials are placeholder copy.
- "Job alerts" are a polling cron (every ~15 min), not real push/email/SMS — align marketing copy with this.
- Affiliate network integration code is complete but a real network (CPALead) must be connected with your own credentials.
- AI full-resume-rewrite has a working backend endpoint but may still need a frontend trigger — verify against your current `index.html`.

---

## 2. Architecture & Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend (SaaS app) | Single-file `index.html`, static, hosted on GitHub Pages | No build pipeline |
| Frontend (Sales Funnel) | Single-file `snipe_jobs_sales_funnel.html`, static | Standalone marketing/checkout-entry page, hosted separately |
| Edge API | Cloudflare Worker (`my-sniper-worker`, `src/index.js`) | One Worker serves both frontends |
| Database & Auth | Supabase (Postgres + RLS + Auth) | Project ID: `mdmpcxtjwnovbhidwwhj` |
| AI | Google Gemini 1.5 Flash | Used across 6+ features |
| Scraper / Cron (job aggregation) | GitHub Actions, `scraper.js`, runs on a schedule | Purges listings older than 48h |
| Scheduled billing checks | Supabase `pg_cron` + `pg_net` | Calls the Worker daily to check subscription expiry |
| Payments | Stripe Checkout + Billing | Monthly + annual plans |
| Transactional email | Resend | Expiry warning emails |
| Affiliate network | CPALead (or similar postback-capable network) | Feeds "Side Task" offers |

**Key identifiers:**
- Supabase project: `mdmpcxtjwnovbhidwwhj` → `https://mdmpcxtjwnovbhidwwhj.supabase.co`
- Cloudflare Worker: `my-sniper-worker` → `https://my-sniper-worker.daniellancce1.workers.dev`
- GitHub repo (SaaS app / GitHub Pages): `626gl1ch/JOB-FINDER-SAAS-WEB-APP` → `https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/`

### How the two sites connect

```
Sales Funnel (snipe_jobs_sales_funnel.html)
 ├─ Visitor clicks "Claim founding rate" ($90/yr) or "Get Pro monthly" ($9/mo)
 ├─ POST /api/payment/create-checkout-public   (no login needed)
 ├─ Worker creates a Stripe Checkout session, returns URL
 ├─ Browser → Stripe → visitor pays
 └─ Stripe redirects to:
     https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/index.html?premium_signup=1&session_id=cs_live_...

SnipeJob SaaS — premium_signup page
 ├─ Detects ?premium_signup=1&session_id=...
 ├─ GET /api/payment/verify-session   (validates payment with Stripe directly)
 ├─ Shows "create your account" form
 ├─ Buyer submits → Supabase creates auth account
 ├─ POST /api/payment/claim-premium   (links payment to the new account)
 └─ Buyer lands on dashboard, Pro unlocked

In-app upgrade (existing logged-in free users)
 ├─ Dashboard → "Upgrade to Pro" → upgrade page → plan toggle (Monthly/Annual)
 ├─ POST /api/payment/create-checkout   (requires auth token, sends { plan })
 └─ Stripe Checkout → returns with ?payment=success → auto-upgrades

Stripe Webhook → Worker (POST /api/payment/webhook, every Stripe event)
 ├─ checkout.session.completed  → upgrades in-app users (has client_reference_id)
 ├─ invoice.payment_succeeded   → renews subscription (extends expiry date)
 └─ customer.subscription.deleted → downgrades to free

Supabase pg_cron (daily, 08:00 UTC)
 ├─ Finds "paid" users with subscription_expiry ≤ 3 days away
 ├─ POST /api/internal/send-expiry-email   (Worker → Resend)
 ├─ Sets expiry_warning_sent = TRUE (no spam)
 └─ Downgrades any user whose subscription_expiry has already passed
```

---

## 3. Repository / File Map

**Root of SnipeJob SaaS repo:**
```
index.html                → the single-page SaaS app (frontend)
scraper.js                → job aggregation script, run by GitHub Actions
schema.sql                → full Supabase schema (run once; safe to re-run — uses IF NOT EXISTS / DO $$ guards)
migration_grace_period.sql → optional incremental migration (see §8 — verify against schema.sql first)
.github/workflows/        → GitHub Actions workflow(s) that run scraper.js on a schedule
my-sniper-worker/
  src/index.js            → Cloudflare Worker — the entire backend API (~25 routes)
  wrangler.jsonc           → Worker config (cron triggers, bindings)
  package.json / package-lock.json
```

**Sales Funnel (separate repo/host recommended):**
```
snipe_jobs_sales_funnel.html   → standalone marketing + checkout-entry page
```

### API routes actually implemented in `my-sniper-worker/src/index.js` (verified against source)

| Route | Method | Purpose |
|---|---|---|
| `/api/jobs` | GET | Job feed |
| `/api/jobs/ranked` | GET | AI-ranked job feed |
| `/api/pinned` | GET | User's pinned jobs |
| `/api/pin` | POST/PATCH/DELETE | Pin/unpin/update a job |
| `/api/profile` | GET/PATCH | Read/update profile (Settings tab uses PATCH) |
| `/api/profile/autofill` | POST | AI resume/bio autofill |
| `/api/resume/score` | POST | AI resume scoring |
| `/api/ai-resume` | POST | Full AI resume rewrite |
| `/api/ai-apply` | POST | One-click AI proposal writer |
| `/api/interview/start` | POST | Start mock interview session |
| `/api/interview/answer` | POST | Submit interview answer for AI scoring |
| `/api/trends` | GET | Sector skill/cert trend insights |
| `/api/offers` | GET | Side Task affiliate offer feed |
| `/api/postback` | POST | Affiliate network postback (credits user wallet) |
| `/api/earnings` | GET | User's affiliate earnings history |
| `/api/withdraw` | POST | Wallet withdrawal request |
| `/api/verify-id` | POST | AI KYC identity verification |
| `/api/payment/create-checkout` | POST | In-app upgrade checkout (authenticated) |
| `/api/payment/create-checkout-public` | POST | Funnel checkout (no auth) |
| `/api/payment/verify-session` | GET | Verify a Stripe session before account creation |
| `/api/payment/claim-premium` | POST | Attach a verified payment to a new account |
| `/api/payment/status` | GET | Current subscription status |
| `/api/payment/webhook` | POST | Stripe webhook receiver |
| `/api/internal/send-expiry-email` | POST | Called by pg_cron only (protected by `WORKER_INTERNAL_SECRET`) |
| `/debug/env` | GET | Health check — shows which secrets are set (booleans only) |

### Database tables actually defined in the current `schema.sql`

`profiles`, `scraped_jobs`, `user_pinned_jobs`, `affiliate_logs`, `withdrawal_requests`, `claimed_stripe_sessions`

Functions/triggers: `handle_new_user()` (+ trigger `on_auth_user_created`), `process_affiliate_credit()`, `process_withdrawal()`, `check_subscription_expiry()` (+ `cron.schedule`).

⚠️ See §8 — the Worker's code calls three tables (`interview_sessions`, `interview_answers`, `sector_trends`) that are **not** currently defined in `schema.sql`. Verify these exist in your live Supabase project before relying on Interview Prep or Sector Trends in production.

---

## 4. Environment Variables & Secrets Reference

All of these are Cloudflare Worker secrets, set via `npx wrangler secret put <NAME>` from inside `my-sniper-worker/`.

| Secret | Where to get it | Required? |
|---|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API | ✅ |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | ✅ |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey | ✅ |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys (`sk_test_...` / `sk_live_...`) | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → your endpoint → Signing secret | ✅ |
| `STRIPE_PRO_PRICE_ID` | Stripe → Product catalog → Monthly price | ✅ |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | Stripe → Product catalog → Annual price | ✅ |
| `RESEND_API_KEY` | resend.com → API Keys | ✅ (for expiry emails) |
| `WORKER_INTERNAL_SECRET` | Any strong random string you generate — must match `app.worker_internal_secret` set in Supabase (§5, Step 1D) | ✅ |
| `OFFER_FEED_URL` | Your affiliate network's feed URL (e.g. CPALead) | For Side Task |
| `OFFER_FEED_API_KEY` | Your affiliate network's API key | For Side Task |
| `APP_BASE_URL` | Only if you move off the default GitHub Pages URL, e.g. `https://snipejob.app` | Optional |

Frontend (`index.html`) constants to verify near the top of its `<script>` block — **line numbers drift between versions, search for the variable name instead**:
```js
const API_URL           = 'https://my-sniper-worker.daniellancce1.workers.dev/api';
const SUPABASE_URL      = 'https://mdmpcxtjwnovbhidwwhj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_...';
```

Sales funnel config block (near the bottom of `snipe_jobs_sales_funnel.html`):
```js
var APP_URL        = 'https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/';
var WORKER_API_URL = 'https://my-sniper-worker.daniellancce1.workers.dev/api';
```

GitHub Actions repository secrets (Settings → Secrets and variables → Actions), needed for the scraper cron:
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

---

## 5. Full Setup From Zero — Step by Step

Do these in order. Each step has a verification check — don't skip it.

### Part A — Supabase: database, extensions, cron

1. **Run the schema.** Supabase Dashboard → SQL Editor → New Query → paste the entire contents of `schema.sql` → Run.
   - ✅ Verify: Table Editor shows `profiles`, `scraped_jobs`, `user_pinned_jobs`, `affiliate_logs`, `withdrawal_requests`, `claimed_stripe_sessions`.
   - ⚠️ Also manually verify `interview_sessions`, `interview_answers`, `sector_trends` exist — see §8. If they don't, you'll need to add them (check `updates.sql` from earlier project history, or recreate from the Worker's queries in `src/index.js`).
2. **Enable extensions.** Database → Extensions → enable `pg_net` and `pg_cron`.
3. **Set app settings the cron job reads.** In SQL Editor (replace `YOUR_SECRET` with a strong random string — this exact value also becomes your `WORKER_INTERNAL_SECRET`):
   ```sql
   ALTER DATABASE postgres SET app.worker_url = 'https://my-sniper-worker.daniellancce1.workers.dev';
   ALTER DATABASE postgres SET app.worker_internal_secret = 'YOUR_SECRET';
   ```
4. **Schedule the expiry check** (skip if `schema.sql` already ran the `cron.schedule` block for you — check first):
   ```sql
   SELECT cron.schedule(
     'snipejob-subscription-expiry-check',
     '0 8 * * *',
     'SELECT public.check_subscription_expiry();'
   );
   ```
   - ✅ Verify: `SELECT * FROM cron.job;` shows one row running at `'0 8 * * *'`.
5. **Configure Auth.**
   - Authentication → Providers → Email → **ON**.
   - Authentication → URL Configuration → Site URL = `https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/` (trailing slash matters). Add the same to Redirect URLs.
   - (Only if you use social login) For each OAuth provider (Google/Facebook/LinkedIn/etc.): create OAuth credentials in that platform's developer console, use the callback URL Supabase shows on its Providers page as the redirect URI, then paste the resulting Client ID + Secret into Supabase and toggle it on. If you don't need a provider, remove its button from `index.html` rather than leaving it half-configured.
   - Settings → API → CORS → add your GitHub Pages URL to allowed origins.

### Part B — Cloudflare Worker: deploy the backend

1. `cd my-sniper-worker`
2. Log in: `npx wrangler login` (or, if browser login fails, use an API token: Cloudflare Dashboard → My Profile → API Tokens → create with the "Edit Cloudflare Workers" template, then `$env:CLOUDFLARE_API_TOKEN = "..."` before deploying).
3. Set every secret from the table in §4:
   ```
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_ANON_KEY
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler secret put STRIPE_PRO_PRICE_ID
   npx wrangler secret put STRIPE_PRO_ANNUAL_PRICE_ID
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put WORKER_INTERNAL_SECRET
   npx wrangler secret put OFFER_FEED_URL
   npx wrangler secret put OFFER_FEED_API_KEY
   ```
   (You can also set these via Cloudflare Dashboard → Workers & Pages → my-sniper-worker → Settings → Variables and Secrets → "+ Add variable" → toggle Encrypt, if you'd rather use the UI than PowerShell.)
4. Deploy: `npx wrangler deploy`
5. ✅ Verify: visit `https://my-sniper-worker.daniellancce1.workers.dev/debug/env` — every flag should read `true`.

### Part C — SnipeJob SaaS: deploy to GitHub Pages

1. In your local repo, confirm `index.html` has the correct `API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (see §4).
2. `git add index.html && git commit -m "deploy" && git push origin main`
3. Repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)` → Save.
4. Wait ~60 seconds, visit `https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/`.
5. ✅ Verify: home page loads with no console errors; sign up with a new email completes the profile wizard and reaches the dashboard; Settings tab shows *your* real name/email (not placeholder dummy data); Upgrade page shows the Monthly/Annual toggle.

### Part D — GitHub Actions: automated job scraper

1. Push `scraper.js` and its workflow file (under `.github/workflows/`) to the repo.
2. Repo → Settings → Secrets and variables → Actions → add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Actions tab → select the scraper workflow → "Run workflow" to trigger it manually the first time.
4. ✅ Verify: the run finishes with a green checkmark; `scraped_jobs` table in Supabase gets new rows.

### Part E — Sales Funnel: deploy

The funnel is a standalone static file — it can live anywhere, on a different host than the app. It calls the same Worker directly (no backend changes needed).

1. Host it: GitHub Pages (new, separate repo, rename the file to `index.html` on upload), Netlify Drop, Vercel, or Cloudflare Pages — pick one.
2. Confirm the config block (`APP_URL`, `WORKER_API_URL`) matches your live URLs (see §4). This is the only place the funnel ever needs editing.
3. ✅ Verify: open the funnel, click "Claim founding rate" → redirected to Stripe Checkout showing $90/year; click "Get Pro monthly" → shows $9/month.
4. **Custom domain later (optional):** buy a real domain (avoid free TLDs like `.tk/.ml/.ga` — they get flagged by spam filters and can hurt your transactional email deliverability too), then follow your host's custom-domain instructions. SSL is automatic on GitHub Pages and Cloudflare Pages.

### Part F — Stripe: register the webhook

1. Stripe Dashboard → Developers → Webhooks → Add endpoint:
   `https://my-sniper-worker.daniellancce1.workers.dev/api/payment/webhook`
2. Select events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.deleted`, `customer.subscription.updated` (optional but useful).
3. Save → open the endpoint → Signing secret → Reveal → `npx wrangler secret put STRIPE_WEBHOOK_SECRET` → paste it → `npx wrangler deploy`.
4. ✅ Verify: Stripe → your endpoint → "Send test event" → `checkout.session.completed` → response should be `200`.

### Part G — Resend: expiry warning emails

1. Create an account at resend.com.
2. Domains → Add Domain → add DNS records (SPF/DKIM/tracking CNAME) at your registrar. Can take up to ~30 min to verify. (Use the sandbox sender to test before you own a domain, if needed.)
3. API Keys → Create API Key → `npx wrangler secret put RESEND_API_KEY` → paste it → `npx wrangler deploy`.
4. In `my-sniper-worker/src/index.js`, find the `from:` field inside the send-expiry-email logic and set it to your verified domain, e.g. `"SnipeJob <noreply@yourdomain.com>"`.
5. (Optional but recommended) Point Supabase's own auth emails through Resend too: Authentication → Email Templates → Settings → SMTP Provider:
   ```
   Host: smtp.resend.com
   Port: 465
   Username: resend
   Password: <your Resend API key>
   Sender: noreply@yourdomain.com
   ```
6. ✅ Verify: see §7's expiry-email test.

### Part H — Affiliate network (Side Task offers)

1. Apply to a postback-capable network — CPALead (cpalead.com) or OfferToro (offertoro.com).
2. Once approved, get their API Feed URL and API key → set as `OFFER_FEED_URL` / `OFFER_FEED_API_KEY` (§4) → redeploy.
3. In that network's dashboard, set the Global/Server-to-Server Postback URL to:
   ```
   https://my-sniper-worker.daniellancce1.workers.dev/api/postback?subid={subid}&payout={payout}&country={country}&click_ip={ip}&provider=NETWORK_NAME&secret=YOUR_POSTBACK_SECRET
   ```
   Replace `YOUR_POSTBACK_SECRET` with a value you've generated and configured server-side, and `NETWORK_NAME` accordingly. Check the network's docs for their exact macro names.
4. ✅ Verify: Dashboard → Side Task tab shows real offers (not "No affiliate network connected yet"); send a test postback from the network's dashboard and confirm a new row appears in `affiliate_logs`; calling the postback URL yourself **without** `&secret=` should return "Unauthorized."

---

## 6. Switching Stripe: Test → Live

Do this only after everything passes in test mode (§7).

1. **Activate your live Stripe account** — Dashboard → orange "Activate account" banner → business details, bank account, ID verification. Wait for "Payments enabled."
2. **Create live products/prices** (test and live have completely separate catalogs):
   - Monthly: $9.00/month recurring → copy price ID → this is live `STRIPE_PRO_PRICE_ID`.
   - Annual: $90.00/year recurring → copy price ID → this is live `STRIPE_PRO_ANNUAL_PRICE_ID`.
3. **Get live API keys** — Developers → API keys → reveal live secret key (`sk_live_...`). Never commit this or paste it into HTML — Worker secrets only.
4. **Register a live webhook** — same endpoint URL as test, but a *new* live-mode webhook with its own signing secret. Select the same 4 events as §5 Part F.
5. **Update Worker secrets** (all via `npx wrangler secret put ...` then `npx wrangler deploy`):
   `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET` (live), `STRIPE_PRO_PRICE_ID` (live), `STRIPE_PRO_ANNUAL_PRICE_ID` (live).
6. ✅ Verify `/debug/env` shows all `true`.
7. **Test with your own real card** (cheapest: $9 monthly). Complete a real payment on both the funnel and the in-app upgrade flow, confirm the Supabase profile updates correctly, then **refund yourself** from Stripe Dashboard → Payments.
8. **Verify webhook deliveries** show `200` for `checkout.session.completed` and `invoice.payment_succeeded`.
9. **Verify session reuse is blocked** — reusing a `session_id` to create a second account should fail with "already been used to activate a different account."
10. **(Optional) Enable the Stripe Customer Portal** — Settings → Billing → Customer portal → enable, allow cancel/update payment method/view invoices. Update the "Manage subscription →" link in `index.html` (search for `billing.stripe.com`) to your real portal URL.
11. **Check payout schedule** — Balances → Payouts. First payout is usually held 7 days; confirm your bank account is correct before going live.

**Common test→live mistakes:** using a test price ID with a live secret key ("No such price"); pasting the test webhook's signing secret for the live endpoint (400 "signature mismatch"); forgetting to redeploy after changing a secret (secrets only apply at next deploy).

**Switching back to test mode** anytime: re-run the same `wrangler secret put` commands with the `sk_test_...` / test webhook / test price IDs, then redeploy. Test cards: `4242 4242 4242 4242` (succeeds), `4000 0000 0000 9995` (fails).

---

## 7. End-to-End Test Checklist

Run this fully before sending real traffic — and again after any Worker/schema change.

**Signup & onboarding**
- [ ] Sign up with a new email — no "Database error saving new user."
- [ ] Paste a bio / upload résumé → "Scan with AI" autofills fields.
- [ ] Pick 3 sectors, finish signup, land on dashboard.

**Job feed**
- [ ] Dashboard shows a real job count, not stuck on "Scanning live sources…"
- [ ] Sector filters and "Sort: Best match" work; pinning a job works.

**Career prep**
- [ ] Resume scoring returns a 0–100 with tips.
- [ ] Sector Trends shows content (first load per sector may take a few seconds while Gemini generates it).
- [ ] Interview Prep starts a session and accepts an answer submission.

**Side Task / money**
- [ ] Side Task tab shows real offers or a clean "not connected yet" message — never a raw error.
- [ ] Recent earnings reflect a real test postback.
- [ ] Withdraw modal enforces the $2 minimum and validates against balance; a withdrawal larger than balance is rejected cleanly (not silently, not negative).
- [ ] KYC upload accepts an image and submits without a console error.

**Settings tab (previously had hardcoded dummy data — confirm the fix is deployed)**
- [ ] Shows *your* real name/email/country/skill.
- [ ] "Save changes" persists and shows a success confirmation.
- [ ] Plan card shows correct tier + expiry date; Pro users see "Manage subscription →" instead of "Upgrade."

**Funnel → Stripe → SaaS flow**
- [ ] Funnel → "Claim founding rate" → Stripe shows $90/yr; "Get Pro monthly" → $9/mo.
- [ ] Complete payment → lands on `index.html?premium_signup=1&session_id=...` → "Confirming your payment…" → account-creation form with email pre-filled → success → dashboard with Pro unlocked.
- [ ] Supabase profile row: `current_tier='paid'`, `plan_type` matches plan chosen, `signup_source='sales_funnel'`, `subscription_expiry` correct.

**In-app upgrade flow**
- [ ] Free user → Upgrade page → Monthly/Annual toggle updates price → Stripe Checkout → returns with Pro unlocked.

**Webhook**
- [ ] Last delivery in Stripe shows `200`.

**Expiry email (manual test, no waiting for the real cron)**
- [ ] `UPDATE public.profiles SET subscription_expiry = NOW() + INTERVAL '2 days', expiry_warning_sent = FALSE WHERE email = 'you@example.com';`
- [ ] `SELECT public.check_subscription_expiry();`
- [ ] Warning email arrives; `expiry_warning_sent` flips to `TRUE`.

**Session reuse prevention**
- [ ] Reusing a completed `session_id` on a second signup attempt fails with the expected error.

**Security spot-checks (terminal, not browser)**
- [ ] `curl -X POST .../api/payment/webhook` with a fake body and no `stripe-signature` header → rejected, not silently granting Pro.
- [ ] `curl -X POST ".../api/postback?subid=YOUR_OWN_ID&payout=999&country=XX"` without `&secret=` → "Unauthorized."
- [ ] View source on `index.html` — no `sk_...` (Stripe secret key) anywhere, only a publishable key if any.

**Monetization**
- [ ] Free tier shows the ad banner; disappears immediately after upgrading.
- [ ] AI Apply is visible on every job card; free users are redirected to Upgrade, Pro users get a generated proposal.

---

## 8. Known Issues & Things Flagged, Not Yet Fixed

Carried forward from the audit passes — these were deliberately **not** changed because they're bigger decisions or content only you should sign off on.

1. **Hardcoded master login** (`_MASTER_EMAIL` / `_MASTER_PASSWORD`) sits in plaintext in `index.html`'s client-side source — anyone viewing page source can read it and get full Pro access, bypassing Supabase entirely. Fine for your own testing; a real exposure once you're driving real signups/paid traffic. Move it server-side (a Worker-only admin check) when ready.
2. **Missing legal pages** — Privacy Policy / Terms of Service / Refund Policy are linked in the footer but don't resolve to real content. Required before Stripe's live-mode review and before charging real cards in most jurisdictions. Free quick-start options: Termly or GetTerms.
3. **Schema/code mismatch** — the Worker's `src/index.js` queries `interview_sessions`, `interview_answers`, and `sector_trends`, but the current `schema.sql` does not define these three tables. Confirm they exist in your live Supabase project (they may have been added via a migration that isn't in this delivery); if not, Interview Prep and Sector Trends will silently fail. Recreate them from the Worker's query shapes if missing.
4. **`OFFER_DEADLINE` hardcoded in the funnel** — the countdown timer's deadline is a fixed date in the funnel's `<script>` block. It's a real, visible promise to visitors — search for `OFFER_DEADLINE` and update or extend it before it quietly expires, or before it misleads a visitor.
5. **Two overlapping expiry-email designs exist across old docs** — an earlier design used a `payment_failed_at` column + immediate webhook-triggered grace period; the version actually implemented in the current `schema.sql`/`src/index.js` uses `expiry_warning_sent` + a daily `pg_cron` check (documented in §5 Part A/G and §7). Go with the `expiry_warning_sent` version — it's what's actually in your code. If you find `payment_failed_at` references anywhere, they're leftover from the earlier design and can be ignored or cleaned up.
6. **Two responsive/CORS layout passes exist in history** — already applied, no action needed, just noting this history isn't repeated as a to-do here.

---

## 9. Troubleshooting / Common Errors

**"Could not start checkout" on the funnel**
→ Worker not deployed (`npx wrangler deploy`), missing price ID secrets (`npx wrangler secret list`), or a test/live key mismatch (test price ID + live secret key, or vice versa).

**"We couldn't confirm that payment" on premium signup**
→ Wrong/incomplete session ID, or a test session (`cs_test_...`) being checked against a live secret key (`sk_live_...`) or vice versa.

**Webhook shows 400 "Webhook signature mismatch"**
→ `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint's signing secret. Re-copy from Stripe → Webhooks → your endpoint → Signing secret → Reveal, then `wrangler secret put` + redeploy.

**Webhook shows 500**
→ Worker crashed. Run `npx wrangler tail`, retrigger the event, read the live error.

**User still shows 'free' after paying**
→ Webhook can take a few seconds; check Stripe → Webhooks → Events tab for delivery errors; `claim-premium` should also upgrade immediately on the funnel path.

**Settings tab shows old hardcoded name/email, or upgrade toggle missing**
→ You're serving an old `index.html` build — redeploy the current one.

**Expiry emails not sending**
→ Confirm `pg_cron` and `pg_net` are enabled in Supabase Extensions; confirm `RESEND_API_KEY` is set (`wrangler secret list`); manually run `SELECT public.check_subscription_expiry();` to test directly.

**Invoice renewal not extending expiry**
→ Check `stripe_customer_id` is populated on that profile (`SELECT stripe_customer_id FROM profiles WHERE email='...'`). If NULL, the initial checkout never saved it — have the user sign out/in to re-trigger a status check, or re-run `claim-premium`.

**`net::ERR_NAME_NOT_RESOLVED` on `/api/...` right after a fresh signup**
→ DNS-level failure, not a 404 — the Worker doesn't actually exist yet under your Cloudflare account, or its `workers.dev` route is disabled. Confirm with `curl -I https://my-sniper-worker.daniellancce1.workers.dev/debug/env`. If it can't resolve at all, check Cloudflare Dashboard → Workers & Pages that `my-sniper-worker` is listed and its route is enabled.

**Social login fails: "Unsupported provider"**
→ Not a code bug — the provider just isn't turned on in Supabase yet. See §5 Part A step 5 for the OAuth setup steps. Also confirm Site URL + Redirect URLs match your GitHub Pages URL exactly, including the trailing slash.

**"debug/env shows false for one key"**
→ You ran `wrangler secret put` from the wrong folder — must be run from inside `my-sniper-worker/`.

**"Routes still say Not Found" after deploying**
→ Confirm `wrangler.jsonc` has `"main": "src/index.js"` and that `wrangler deploy` was run from inside `my-sniper-worker/`, not the repo root.

**"Database error saving new user" during signup**
→ Re-run the full `schema.sql` in Supabase SQL Editor — this re-applies the `handle_new_user()` trigger.

**AI features return 502 / temporarily unavailable**
→ `GEMINI_API_KEY` missing/wrong, or Gemini quota hit. Check Cloudflare real-time logs (`npx wrangler tail`) while reproducing.

**Trends panel / Earnings empty**
→ First load per sector triggers Gemini generation — wait and refresh. If still empty, check `wrangler tail` for errors, and double-check the `sector_trends`/`affiliate_logs` RLS policies exist (see §8, item 3).

**Console noise from `contentscript.js` / MetaMask / "MaxListenersExceededWarning"**
→ A browser extension injecting itself into every page you visit — unrelated to SnipeJob. Confirm by testing in an Incognito window with extensions disabled.

---

## 10. Maintenance Reference (Quick SQL & CLI)

**Who's on which plan:**
```sql
SELECT * FROM public.profiles WHERE current_tier = 'paid';
-- check: plan_type, subscription_expiry, stripe_customer_id
```

**Manually upgrade a user** (e.g. a manual/crypto payment):
```sql
UPDATE public.profiles
SET current_tier = 'paid', plan_type = 'monthly', subscription_expiry = NOW() + INTERVAL '1 month'
WHERE email = 'user@email.com';
```

**Manually downgrade a user:**
```sql
UPDATE public.profiles
SET current_tier = 'free', plan_type = NULL, subscription_expiry = NULL
WHERE email = 'user@email.com';
```

**Pending withdrawals:**
```sql
SELECT * FROM public.withdrawal_requests WHERE status = 'pending' ORDER BY handled_at DESC;
```

**Cron job history:**
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

**Live Worker logs:**
```
npx wrangler tail
```

**List all secrets (names only, not values):**
```
npx wrangler secret list
```

**Update the API (backend) after editing `src/index.js`:**
```
cd my-sniper-worker
npx wrangler deploy
```

**Update the frontend after editing `index.html` or `scraper.js`:**
```
git add <file>
git commit -m "message"
git push origin main
```
GitHub Pages rebuilds automatically within ~60 seconds.

**Free monitoring (recommended, $0/month):**
UptimeRobot — add monitors for the funnel URL, the app URL, and `/debug/env`, so you get an alert the moment any of the three goes down. Also check Stripe → Webhooks weekly for any non-200 response rate creeping up.

---

## 11. Change Log

Condensed history of what's been found and fixed across all prior audit/fix passes. Kept for reference — no action needed unless you're trying to understand *why* something behaves the way it does.

**SnipeJob SaaS (`index.html` + `src/index.js` + `schema.sql`)**
- Settings tab had fully hardcoded dummy data (name/email/country/phone) with a dead "Save changes" button — replaced with live profile data + a working save handler.
- "Upgrade to Pro" in Settings incorrectly linked to signup instead of the upgrade page.
- `stripe-form`/`crypto-form` elements were referenced by JS but didn't exist in the HTML, crashing the payment method toggle — added the missing elements.
- In-app upgrade page had no Monthly/Annual selector even though the backend and funnel both already supported both plans — added the toggle and wired plan selection through to checkout.
- "Start 7-day free trial" button was misleading (no trial existed anywhere) — copy corrected.
- Stripe webhook incorrectly read invoice objects using checkout-session field names, silently breaking every subscription renewal — split into separate, correctly-typed handlers.
- Pro users were still limited to 3 sectors in Settings — fixed to respect tier.
- Pro users' Settings plan card always said "Free plan" — now reflects real tier/expiry.
- No subscription-expiry warning/downgrade system existed at all — added `expiry_warning_sent` tracking, `check_subscription_expiry()` pg_cron function, and the `/api/internal/send-expiry-email` endpoint.
- `stripe_subscription_id` / `expiry_warning_sent` columns were missing from `schema.sql` despite being referenced elsewhere — added.
- `signup_source` for funnel purchases wasn't reliably distinguishing funnel vs. in-app checkouts — now read from session metadata.
- AI Apply was completely broken for every user (including paying Pro users) due to a `select=` query referencing a non-existent `payload_resume` column — fixed.
- Withdrawals had a check-then-write race condition that could push a wallet balance negative — fixed by switching to an atomic `process_withdrawal` RPC + a DB-level `CHECK (wallet_balance >= 0)` constraint.
- `interview_sessions`, `interview_answers`, `sector_trends`, and the `affiliate_logs` SELECT policy previously only existed in a separate `updates.sql` — folded into `schema.sql` in one audit pass (see §8 item 3 — verify this actually landed in your current copy).
- Two dead functions (`selectPayment()`, `processUpgrade()`) referencing nonexistent page elements — removed as unused.
- `scraper.js` had a typo'd subreddit name (`videoteditingjobs` → `videoeditingjobs`) silently contributing zero jobs from that source — fixed.
- In-app upgrade's post-payment redirect was built from the request's `Origin` header, missing the GitHub Pages sub-path — would have 404'd real paying customers. Now built from a single `APP_BASE_URL` constant.
- An earlier, unauthenticated webhook (`{user_id, status}` trusted with no verification) could have let anyone grant themselves Pro for free — replaced with Stripe signature verification.
- Affiliate postback endpoint previously had no shared-secret check — closed a self-payout exploit path.

**Sales Funnel** — no functional bugs found across any audit pass; checkout wiring, error toasts, countdown timer, and FAQ accordion all confirmed clean.

---

## 12. Roadmap

Ideas for what's next, not commitments:

- Real push notifications (email/browser) to close the gap between marketing copy and the current 15-minute polling delivery.
- Finish wiring the AI full-resume-rewrite UI (backend already complete).
- Persist the project/contract tracker to the database (currently session-only).
- Automate crypto subscription payments (e.g. NOWPayments) alongside Stripe.
- Employer-side "post a job here" flow — would turn SnipeJob into a two-sided marketplace.
- Expand job sources (LinkedIn, Indeed Remote, Wellfound, niche Discord/Slack boards).
- Native mobile client on top of the existing REST API.

---

## 13. Quick Reference — Fill In Your Live URLs

```
Funnel live URL:              ____________________________________________
App live URL:                 https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/
Worker live URL:               https://my-sniper-worker.daniellancce1.workers.dev
Supabase project URL:          https://mdmpcxtjwnovbhidwwhj.supabase.co
Monthly price ID (test):      ____________________________________________
Monthly price ID (live):      ____________________________________________
Annual price ID (test):       ____________________________________________
Annual price ID (live):       ____________________________________________
Webhook endpoint (live):      ____________________________________________
Resend domain:                ____________________________________________
Affiliate network in use:     ____________________________________________
Custom domain (if any):       ____________________________________________
Founding-rate offer deadline set (must match OFFER_DEADLINE in the funnel):
                               ____________________________________________
```

---

*End of master documentation.*
