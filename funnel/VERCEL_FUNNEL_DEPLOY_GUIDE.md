# SnipeJob Sales Funnel — Vercel Deployment Guide

> **What this deploys:** `funnel/snipe_jobs_sales_funnel.html` — the standalone sales page that sends visitors to Stripe Checkout. This is a **static HTML file** with no build step needed.

---

## Prerequisites

| Item | Notes |
|---|---|
| Vercel account | Free tier works — sign up at https://vercel.com |
| GitHub connected to Vercel | Done during first-time Vercel setup |
| Funnel pushed to GitHub | Follow Task 1 in master doc — push the `funnel/` folder to the main repo OR to `https://github.com/626gl1ch/JOB-FINDER-SALES-FUNNEL.git` |
| Worker deployed | `WORKER_API_URL` in the funnel must point at the live worker |

---

## Option A — Deploy from the Main Repo (Recommended)

The funnel lives in the `funnel/` subfolder of the main repo. You can deploy just that subfolder as its own Vercel project.

### Step 1 — Import the project

1. Go to https://vercel.com/dashboard
2. Click **"Add New… → Project"**
3. Find and select **`JOB-FINDER-SAAS-WEB-APP`**
4. Click **Import**

### Step 2 — Configure the project

On the "Configure Project" screen:

| Setting | Value |
|---|---|
| **Project Name** | `snipejob-funnel` (or anything you like) |
| **Framework Preset** | **Other** (no framework — it's plain HTML) |
| **Root Directory** | Click **Edit** → type `funnel` → click **Continue** |
| **Build Command** | *(leave blank)* |
| **Output Directory** | *(leave blank)* |
| **Install Command** | *(leave blank)* |

> [!IMPORTANT]
> The **Root Directory** must be set to `funnel`. This tells Vercel to serve the contents of `funnel/` as the root of the site.

### Step 3 — Deploy

Click **Deploy**. Vercel will:
1. Pull the `funnel/` folder
2. Serve `snipe_jobs_sales_funnel.html` as a static site
3. Give you a URL like: `https://snipejob-funnel.vercel.app`

> [!NOTE]
> Because it's a single HTML file, Vercel will serve `snipe_jobs_sales_funnel.html` at the root path `https://snipejob-funnel.vercel.app/snipe_jobs_sales_funnel.html`. Add a `vercel.json` (Step 4) to make it serve at `/` cleanly.

### Step 4 — Add vercel.json for clean routing

Create `funnel/vercel.json` with this content:

```json
{
  "cleanUrls": true,
  "rewrites": [
    { "source": "/", "destination": "/snipe_jobs_sales_funnel.html" }
  ]
}
```

After adding this file:
- Push it to GitHub
- Vercel auto-redeploys
- `https://snipejob-funnel.vercel.app/` now shows the funnel directly ✅

---

## Option B — Deploy from the Funnel's Own Repo

If you want the funnel completely separate (its own repo: `https://github.com/626gl1ch/JOB-FINDER-SALES-FUNNEL.git`):

1. Go to https://vercel.com/dashboard → **Add New → Project**
2. Import **`JOB-FINDER-SALES-FUNNEL`**
3. Set **Root Directory** to `.` (the repo root, since the HTML file is at the root of that repo)
4. **Framework Preset** → Other
5. All other settings → leave blank
6. Deploy
7. Add `vercel.json` at the root:
   ```json
   {
     "cleanUrls": true,
     "rewrites": [
       { "source": "/", "destination": "/snipe_jobs_sales_funnel.html" }
     ]
   }
   ```

---

## Step 5 — Verify it works

After deployment:

1. Open your Vercel URL (e.g., `https://snipejob-funnel.vercel.app`)
2. Confirm the page loads (hero, countdown timer, pricing card visible)
3. Click **"Claim founding rate"** → should redirect to Stripe Checkout showing $90/year
4. Click **"Get Pro monthly"** → should redirect to Stripe Checkout showing $9/month
5. If Stripe redirects work → funnel is live ✅

> [!WARNING]
> If you see a checkout error "Could not start checkout", the most likely cause is that **Stripe live mode products are not set up yet**. Follow `STRIPE_LIVE_SETUP_GUIDE.md` first, then set the `STRIPE_PRO_PRICE_ID` and `STRIPE_PRO_ANNUAL_PRICE_ID` secrets on the worker.

---

## Step 6 — Add a custom domain (optional but recommended)

1. In Vercel → your funnel project → **Settings → Domains**
2. Click **Add Domain** → enter e.g. `snipejob.com` or `app.snipejob.com`
3. Follow Vercel's DNS instructions (add a CNAME or A record at your domain registrar)
4. SSL certificate is automatic — issued within minutes

> [!NOTE]
> Free TLDs (`.tk`, `.ml`, `.ga`) can harm email deliverability and look untrustworthy to potential customers. Use a paid domain (`.com`, `.io`, `.co`) — they start from ~$10/year.

---

## Step 7 — Auto-redeploy on push (already set up)

Once connected, every `git push` to the `main` branch automatically triggers a Vercel redeploy. No manual action needed after the initial setup.

---

## How to Update the Funnel After Going Live

| What changed | What to do |
|---|---|
| Price, headline, copy | Edit `funnel/snipe_jobs_sales_funnel.html`, `git push` — Vercel redeploys |
| `OFFER_DEADLINE` date | Edit the `OFFER_DEADLINE` line in the funnel JS, `git push` |
| `WORKER_API_URL` | Edit the config block in the funnel JS, `git push` |
| Worker API changes | Only need `npx wrangler deploy` from `my-sniper-worker/` — funnel doesn't change |

---

## Config Block Reference

The funnel's configuration is at the top of the `<script>` section:

```javascript
var APP_URL = 'https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/';
var WORKER_API_URL = 'https://my-sniper-worker.daniellancce1.workers.dev/api';
var OFFER_DEADLINE = new Date('2026-08-31T23:59:59');
```

These are the **only 3 lines you ever need to change** when updating the funnel's integration config.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not start checkout" error | Stripe live mode not configured. Follow `STRIPE_LIVE_SETUP_GUIDE.md`. |
| Funnel shows 404 | `vercel.json` not in the funnel directory, or wrong Root Directory in Vercel settings. |
| Countdown shows `--` | JavaScript blocked or page not fully loaded. Hard-refresh with Ctrl+Shift+R. |
| Old version showing after push | Clear Vercel deployment cache: Vercel dashboard → Deployments → Redeploy. |
| CORS error in console | Worker `CORS` config issue — check `Access-Control-Allow-Origin` in the worker. |
