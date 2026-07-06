# SnipeJob — Audit Pass Changelog (2026-07-03)

This pass opened the actual code (not just the docs) and cross-checked it
against `SNIPEJOB_MASTER_DOCUMENTATION.md`'s claims. Three things the docs
said were fixed were still broken in this copy of the code. Fixed here.

## 1. AI Apply — was completely broken, now fixed
**File:** `my-sniper-worker/src/index.js`, `/api/ai-apply` route.

The profile query selected a column called `payload_resume`, which does not
exist anywhere in `schema.sql`. PostgREST errors on selecting a nonexistent
column, so **every** AI Apply click — free or paying Pro — was failing
silently behind a generic 502. The master doc's change log claimed this was
already fixed (it fixed an *identical* bug in `/api/ai-resume` at some
point, just not here). Now selects the same real profile fields
`/api/ai-resume` already uses (`full_name, exp_level, primary_skill, bio,
education`) and feeds them into the Gemini prompt so proposals are
actually personalized instead of generic.

**Action needed from you:** none — this is a pure code fix, redeploy and
it works.

## 2. Withdrawal race condition — was still exploitable, now atomic
**Files:** `my-sniper-worker/src/index.js` (`/api/withdraw` route),
`schema.sql` (new CHECK constraint).

The withdraw route was doing a manual "read balance → subtract in
JavaScript → PATCH the new number" — a classic check-then-write race. Two
withdrawal requests fired close together could both read the same balance,
both pass the `>= amount` check, and both deduct, pushing `wallet_balance`
negative. The master doc's change log claimed this was fixed by switching
to an atomic `process_withdrawal` RPC + a DB-level CHECK constraint —
neither was actually wired up in this copy (`schema.sql` defines
`process_withdrawal()`, `updates.sql` separately defines a different
`process_withdrawal_v2()`, and the Worker called neither — it's a plain
JS read/write).

Fixed by:
- Routing `/api/withdraw` through `rpc/process_withdrawal_v2` — the
  balance check and the deduction now happen in a single atomic SQL
  `UPDATE ... WHERE wallet_balance >= amount`, so a second concurrent
  call physically cannot succeed once the balance is gone.
- Adding an actual `CHECK (wallet_balance >= 0)` constraint on
  `profiles.wallet_balance` in `schema.sql`, as a second line of defense
  even if some future code path bypasses the RPC.

**Action needed from you:** run the updated `schema.sql` in Supabase SQL
Editor (safe to re-run — it's guarded with `IF NOT EXISTS` checks) *and*
make sure `updates.sql` has been run too, since that's where
`process_withdrawal_v2()` itself is defined. If you're not sure whether
`updates.sql` ran already, just run it again — every statement in it is
also idempotent.

## 3. Hardcoded master credentials — now local-only
**File:** `index.html`

`_MASTER_EMAIL` / `_MASTER_PASSWORD` were live on the deployed site in
plaintext, readable via view-source. Worth noting for your own peace of
mind: this was never a *backend* access bypass — `src/index.js` has zero
knowledge of `'master_session_token'`, so it could never call any real API
route with elevated privilege; it only faked a local Pro dashboard render
using mock data inside your own browser. Still bad practice to ship real
credentials in cleartext client JS on a live site, so it's now gated
behind `IS_LOCAL_DEV` (`window.location.hostname` is `localhost` or
`127.0.0.1`). Works exactly as before on your dev machine; completely
inert once deployed to GitHub Pages / your custom domain.

**Action needed from you:** none for now — this is safe to ship as-is.
When you're ready for a "real" admin/test account, the cleaner long-term
fix is a dedicated Supabase user with a `role = 'admin'` column checked
server-side, rather than any client-side credential at all.

## 4. Dead Cloudflare cron trigger — removed
**File:** `my-sniper-worker/wrangler.jsonc`

Had a `triggers.crons` block pointing at a `scheduled()` export that
doesn't exist in `src/index.js` (only `fetch` is exported) — it fired
daily and did nothing but log an error in the Cloudflare dashboard. The
real expiry-check mechanism is Supabase's own `pg_cron` job calling
`POST /api/internal/send-expiry-email`, which is correctly wired up and
untouched. Removed the dead trigger block; left a comment explaining why,
in case you want a real Worker-native cron for something else later.

**Action needed from you:** `npx wrangler deploy` picks this up
automatically — no separate step.

## 5. Pinned Jobs tab — was 100% fake, now wired to real data
**File:** `index.html`

The "Pinned" dashboard tab was hardcoded static HTML showing three fake
jobs ("TechStartup Inc", "DataCo Analytics", "FinTech Solutions") that
never changed no matter what a user actually pinned or unpinned. The
backend route `GET /api/pinned` already existed and worked correctly —
the frontend just never called it. Added `loadPinnedJobs()` /
`renderPinnedJobs()` / `unpinJob()`, wired the tab switch to load real
data, and connected the trash-can button to a working unpin action (it
previously had no `onclick` at all).

**Action needed from you:** none — pure code fix.

## 6. Master-mode API stubs — path mismatches fixed
**File:** `index.html`

The local-only master/demo session had stub responses keyed to
`/pins`, `/affiliate`, `/tasks` — but the app's real calls are
`/pinned`, `/earnings`, `/offers`. Those stubs were silently falling
through to `null` instead of returning empty lists, so testing in
master mode showed broken-looking tabs. Corrected the prefixes to match
reality.

**Action needed from you:** none.

## 7. Hardcoded Stripe TEST-mode "Manage subscription" link — now one constant
**File:** `index.html`

Two separate places (`Settings` tab and the in-app upgrade success flow)
hardcoded the exact same Stripe **test**-mode Customer Portal login URL
(`.../test_28o14m2FV4kzdsc4gg`). Since you're setting up a brand-new
Stripe account and going straight to live mode, every real paying user
who clicked "Manage subscription" would have hit a dead/wrong-mode link.
Pulled both into a single `STRIPE_CUSTOMER_PORTAL_URL` constant near the
top of the file, right next to `API_URL` — same spot the master doc
already tells you to check.

**Action needed from you:** once your live Stripe account has the
Customer Portal enabled (Settings → Billing → Customer portal → enable),
copy the live portal login link and paste it into that one constant
before you go live.

## 8. "14 sectors" copy typo — corrected to 16
**File:** `index.html`

Two places in the Settings/upgrade copy said "All 14 sectors" — your
actual schema (`schema.sql`'s `sector` CHECK constraint) and your own
PRD/master doc both define 16. Corrected both to "16 sectors" so the
in-app copy matches reality and your marketing materials.

**Action needed from you:** none.

---

## Also verified as correct (no changes needed)
- Funnel's `APP_URL` / `WORKER_API_URL` constants point at real live URLs.
- `OFFER_DEADLINE` (2026-07-20) hasn't expired yet.
- Scraper's subreddit typo fix (`videoeditingjobs`) is in place.
- CORS is open (`*`) on the Worker as documented.
- `/api/internal/send-expiry-email` correctly checks `WORKER_INTERNAL_SECRET`.
- Stripe webhook signature verification is present on `/api/payment/webhook`.
- Affiliate postback endpoint requires a shared secret.
- Route count: 25 unique API routes (the PRD's "22 routes" undercounts
  slightly — update that figure before using the PRD as a sale listing).
- GitHub Actions scraper cron genuinely runs every 15 minutes
  (`*/15 * * * *`), matching what your marketing copy should say.

## Still outstanding (unchanged from before — bigger decisions, not code bugs)
- [ ] Privacy Policy / Terms of Service / Refund Policy — still dead links, still blocks Stripe live mode.
- [ ] Confirm `updates.sql` has actually been run against your live Supabase project (see item 2 above — this also gates Interview Prep, Sector Trends, and the Earnings tab).
- [ ] `STRIPE_PRO_ANNUAL_PRICE_ID` — confirm it's set in whichever Stripe mode you're deploying to.
- [ ] AI full-resume-rewrite has no frontend trigger yet (confirmed by searching `index.html` — zero references to `/api/ai-resume`). Backend route works; just needs a button + result view.
