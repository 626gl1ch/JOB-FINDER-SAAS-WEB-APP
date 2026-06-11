# 🚀 Hosting & Deployment Guide: SnipeJob SAAS

This guide explains how to take your project live from scratch and how to push updates.

---

## 1. Initial Setup: The "Live" Backend (Cloudflare)

Follow these exact steps in your PowerShell to deploy the Worker.

### Step 1: Navigate to the Worker Folder
```powershell
cd "C:\Users\DANIEL\JOB FINDER SAAS WEB APP\my-sniper-worker"
```

### Step 2: Login to Cloudflare
```powershell
npx wrangler login
```
*A browser window will open. Click **Allow** to give your computer permission to deploy to your account.*

### Step 3: Deploy the Code
```powershell
npx wrangler deploy
```
*This uploads the `src/index.js` file to Cloudflare. Once finished, it will give you a URL (e.g., `https://my-sniper-worker.daniellancce1.workers.dev`).*

### Step 4: Add your Database & AI Secrets
Run these 4 commands one by one. After each command, paste the value from your Supabase/Gemini dashboard when prompted:

1.  **Supabase URL:** `npx wrangler secret put SUPABASE_URL`
2.  **Anon Key:** `npx wrangler secret put SUPABASE_ANON_KEY`
3.  **Service Role Key:** `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
4.  **Gemini API Key:** `npx wrangler secret put GEMINI_API_KEY`

**🔍 Quick Check:** Visit `https://your-worker.workers.dev/debug/env`. If it returns `{"hasSupabaseUrl":true, ...}`, you did it right!

---

## 2. Database Setup (Supabase)

1.  Go to [Supabase Dashboard](https://supabase.com).
2.  Open your project and click on **SQL Editor** (left sidebar).
3.  Open the `schema.sql` file in your project folder, copy all the text.
4.  Paste it into the Supabase SQL Editor and click **Run**.
    *   *This creates your tables, indexes, and security rules.*

**🔍 Quick Check:** Click on **Table Editor** in Supabase. If you see tables like `profiles` and `scraped_jobs`, the SQL ran correctly.

---

## 3. Automated Scraper Setup (GitHub)

1.  Push your code to your GitHub repo.
2.  Go to **Settings** -> **Secrets and variables** -> **Actions**.
3.  Click **New repository secret** and add:
    *   `SUPABASE_URL`: (Your Supabase Project URL)
    *   `SUPABASE_SERVICE_ROLE_KEY`: (Your Service Role Key)
4.  Go to the **Actions** tab in GitHub, select the **SnipeJob** workflow, and click **Run workflow** to test it immediately.

**🔍 Quick Check:** Go to the **Actions** tab. If the latest run has a green checkmark ✅, your scraper is alive and working.

---

## 4. How to Update the Live Bot Anytime

Whenever you make changes to your code, follow these steps:

### Update the API (Backend)
If you edit `my-sniper-worker/src/index.js`:
1.  `cd "C:\Users\DANIEL\JOB FINDER SAAS WEB APP\my-sniper-worker"`
2.  `npx wrangler deploy`

### Update the Scraper
If you edit `scraper.js`:
1.  `git add scraper.js`
2.  `git commit -m "Updated scraper"`
3.  `git push origin main`

### Update the Website (Frontend)
If you edit `index (1).html`:
1.  Upload the new `index (1).html` to your web host (GitHub Pages, Netlify, etc.).

---

## 5. Verification Checklist
*   ✅ **API Health:** Visit `https://your-worker.workers.dev/debug/env`.
*   ✅ **Scraper Check:** View the **Actions** tab in GitHub to see if the "SnipeJob" runs are green.
*   ✅ **Data Check:** Look at the `scraped_jobs` table in Supabase to see the jobs found.
