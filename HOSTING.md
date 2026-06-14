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
There are two ways to do this. If the browser login fails, use the **API Token Method**.

#### Option A: Browser Login (Standard)
```powershell
npx wrangler login
```

#### Option B: API Token Method (More Reliable)
1. Go to **[Cloudflare Dashboard > API Tokens](https://dash.cloudflare.com/profile/api-tokens)**.
2. Click **Create Token** -> Use the **"Edit Cloudflare Workers"** template.
3. Follow the steps and **Copy the Token**.
4. In PowerShell, run:
```powershell
$env:CLOUDFLARE_API_TOKEN = "YOUR_CLOUDFLARE_TOKEN_HERE"
cd "C:\Users\DANIEL\JOB FINDER SAAS WEB APP\my-sniper-worker"
npx wrangler deploy
```

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

## 4. Website Hosting (GitHub Pages)

1.  **Prepare your file:** Rename `index (1).html` to `index.html`. (Done for you).
2.  **Configure Frontend API:** Open `index.html` and find lines 1699–1701. You **MUST** fill these in:
    *   `API_URL`: Your Cloudflare Worker URL.
    *   `SUPABASE_URL`: Your Supabase Project URL.
    *   `SUPABASE_ANON_KEY`: Your Supabase Anon/Public Key.
3.  **Push to GitHub:** 
    ```powershell
    git add index.html
    git commit -m "Configure frontend API"
    git push origin main
    ```
4.  **Enable Hosting:**
    *   Go to your GitHub Repository **Settings** > **Pages**.
    *   Select `main` branch and `/ (root)`. Click **Save**.

---

## 5. Critical Database & Auth Configuration

To make sure the "Sign Up" button works, you must configure Supabase:

### Step 1: Enable Auth Providers
1.  Go to **Supabase Dashboard** > **Authentication** > **Providers**.
2.  Ensure **Email** is enabled.
3.  *(Optional for testing)*: Disable **Confirm Email** if you want users to log in immediately without checking their inbox.

### Step 2: Set Site URL
1.  Go to **Authentication** > **URL Configuration**.
2.  Set **Site URL** to your GitHub Pages URL (e.g., `https://your-user.github.io/your-repo/`).

### Step 3: Configure CORS
1.  Go to **Settings** > **API**.
2.  In **CORS Proxy**, add your GitHub Pages URL to the list of allowed origins.

---

## 6. How to Update the Live Bot Anytime

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
If you edit `index.html`:
1.  `git add index.html`
2.  `git commit -m "Updated website"`
3.  `git push origin main`
*GitHub will automatically update your live site within 60 seconds.*

---

## 7. Verification Checklist
*   ✅ **API Health:** Visit `https://your-worker.workers.dev/debug/env`.
*   ✅ **Scraper Check:** View the **Actions** tab in GitHub to see if the "SnipeJob" runs are green.
*   ✅ **Live Website:** Visit your GitHub Pages URL to ensure the dashboard loads.
---

## 8. Final Updates (June 2026)
*   **Sectors:** Ensure your `scraped_jobs` table has the updated `sector` constraint to support: `web, data, video, design, ai, writing, mobile, cyber, marketing, other`.
*   **Scraper Deps:** The automated scraper now requires `rss-parser`. This is handled in the GitHub Action workflow automatically.
*   **Verification:** To test your KYC flow, ensure your `profiles` table `identity_status` can handle 'unverified', 'pending', 'verified', and 'flagged'.

