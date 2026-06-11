# 🚀 Hosting & Deployment Guide: SnipeJob SAAS

This guide explains how to take your project live and how to push updates whenever you change the code.

---

## 1. The Architecture (How it works)
Your project has three main parts:
1.  **Database (Supabase):** Stores jobs and user profiles.
2.  **API/Backend (Cloudflare Worker):** Handles requests from the website.
3.  **Scraper (GitHub Actions):** Automatically finds new jobs every 15 minutes.

---

## 2. Initial Hosting (Going Live)

### A. Database (Supabase)
1.  Create a project at [supabase.com](https://supabase.com).
2.  Go to **SQL Editor** -> **New Query**.
3.  Paste the contents of `schema.sql` and click **Run**.

### B. Backend (Cloudflare Worker)
1.  Open PowerShell in the `my-sniper-worker` folder.
2.  Run `npx wrangler deploy`.
3.  Set your secrets (only do this once):
    ```powershell
    npx wrangler secret put SUPABASE_URL
    npx wrangler secret put SUPABASE_ANON_KEY
    npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
    npx wrangler secret put GEMINI_API_KEY
    ```

### C. Scraper (GitHub Actions)
1.  Go to your GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions**.
2.  Add two secrets:
    *   `SUPABASE_URL`: Your Supabase Project URL.
    *   `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase Service Role Key.
3.  The scraper will now run automatically every 15 minutes.

---

## 3. How to Update the Live Bot

Whenever you make changes to your code, follow these steps to "push" them to the live version:

### Step 1: Update the Backend (API)
If you changed `worker.js` (or `src/index.js` inside the worker folder):
1.  Open PowerShell in the `my-sniper-worker` folder.
2.  Run:
    ```powershell
    npx wrangler deploy
    ```
    *Cloudflare will immediately switch to the new code.*

### Step 2: Update the Scraper
If you changed `scraper.js`:
1.  Commit and push your changes to GitHub:
    ```powershell
    git add scraper.js
    git commit -m "Update scraper logic"
    git push origin main
    ```
    *GitHub Actions will automatically use the new version of the file on the next 15-minute run.*

### Step 3: Update the Frontend
If you changed `index (1).html`:
1.  Since your frontend is just an HTML file, you can host it on **GitHub Pages**, **Vercel**, or **Netlify**.
2.  Simply upload/push the new `index (1).html` to your hosting provider.

---

## 4. Verification (Is it working?)
*   **Check API:** Visit `https://your-worker.workers.dev/debug/env` (should show `true` for all keys).
*   **Check Scraper:** Go to **GitHub Actions** tab -> Select the workflow -> See if the last run was successful.
*   **Check Database:** Go to your Supabase **Table Editor** -> `scraped_jobs` to see if new jobs are appearing.
