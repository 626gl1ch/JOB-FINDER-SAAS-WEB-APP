**Setup steps needed (if not already done):**
1. Create the $90/yr Stripe price (test mode first, then live) → `npx wrangler secret put STRIPE_PRO_ANNUAL_PRICE_ID`.
2. Run `migration_premium_funnel.sql` in Supabase (or the updated full `schema.sql` — not both).
3. Replace `my-sniper-worker/src/index.js`, `npx wrangler deploy`, verify `/debug/env` shows `hasStripeProAnnualPriceId: true`.
4. Replace root `index.html`, push to GitHub Pages.
5. Host the funnel anywhere (doesn't need to share a domain — CORS is already open `*` on the worker).
6. Full test loop in Stripe test mode: both plans, verify `plan_type`/`current_tier`/`signup_source` land correctly in Supabase, and confirm a re-submitted session is rejected as already-claimed.
7. If a custom domain shows up later (e.g. `snipejob.app`): `npx wrangler secret put APP_BASE_URL` — that's the only place it needs to change.



## 3. Hosting & verification (from the hosting/payment verification guide)

**Free hosting**: GitHub Pages (same platform as the main app) — new separate repo (`snipejob-funnel`), upload `snipe_jobs_sales_funnel.html` renamed to `index.html`, enable Pages from the `main` branch root. Cloudflare Pages is a viable $0 alternative with a faster edge CDN if preferred. Keep the funnel in its own repo, separate from the app repo, so a marketing edit can never break the product.

**Custom domain (later, optional)**: buy a real domain (~$3–12/yr, Cloudflare Registrar or Namecheap). **Never use a free TLD** (`.tk/.ml/.ga/.cf/.gq`, e.g. Freenom) — these get flagged by spam filters and would hurt Stripe receipt / password-reset email deliverability once it's the same brand.

**Funnel→app wiring**: a single JS constant, `APP_URL`, points the funnel's buttons at the app with `?go=upgrade&plan=annual|monthly`. An optional 4-line snippet on the app side reads `?go=` and `?plan=` and jumps straight to the upgrade page with the right plan pre-selected — additive, doesn't touch existing checkout logic.

**Full verification checklist before sending real traffic** (condensed — see prior doc for the exhaustive version, now retired):
- Funnel renders correctly on desktop and a real phone; every CTA, all 5 FAQ items, fonts/icons all load with no failed network requests.
- Deep links (`?go=upgrade&plan=annual` / `=monthly`) land on the right pricing option with no console errors.
- Full Stripe **test-mode** loop run twice (once per plan): checkout shows the right price, test card `4242 4242 4242 4242` succeeds, `current_tier`/`plan_type` update correctly in Supabase, webhook returns 200, decline card `4000 0000 0000 0002` fails cleanly, cancellation flips `current_tier` back to `'free'`.
- Security spot-check: no `sk_...` secret key anywhere in client source, webhook rejects requests with no/invalid `stripe-signature` header, all Stripe secrets are `wrangler secret`s not hardcoded.
- **Going live**: complete Stripe account activation, toggle out of test mode, re-create both prices in live mode, rotate to live secret key + live webhook signing secret, do two real self-purchases (and refund yourself if not keeping them), confirm the funnel's countdown deadline is a real date you'll honor.
- **Legal — do not skip before real money moves**: Privacy Policy, Terms of Service, and Refund Policy pages need to exist and be linked (the footer links are currently dead `<a>` tags with no `href`). Termly or GetTerms have free generator tiers for a first draft.
- Ongoing monitoring: free UptimeRobot monitors on the funnel URL, app URL, and `/debug/env`; check Stripe webhook delivery success weekly.

**Quick-reference fields to fill in once live** (carry these into whatever tracker you actually use — a spreadsheet or the project's own notes, not a doc file):
Funnel URL · App URL (`https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/`) · Worker URL (`https://my-sniper-worker.daniellancce1.workers.dev`) · monthly/annual price IDs (test + live) · live webhook endpoint · custom domain · founding-offer deadline.

---

## 4. Strategy & research reference (surviving, still-useful parts of the Blueprint)

The 2,100-line Blueprint document is mostly general 2026 SaaS-funnel research (sourced from Unbounce, Apollo.io, NNG, MECLABS, Stripe docs, etc.) layered with SnipeJob-specific copy that was later found to be partly fabricated or inaccurate (its own Part I, summarized in §5 below, documents the corrections). The reusable strategic substance, stripped of the inaccurate product claims, is kept here:

**3-stage funnel model**: Discovery (TOFU, cold strangers, pain-first hooks) → Nurture (MOFU, trust-building, educational content) → Conversion (BOFU, direct offer + urgency). The Marketing Playbook's content bank (§6 below) is organized along exactly this structure.

**7+1 heuristic principles for landing pages**: Relevance (message-match to the ad that brought them), Clarity (value understood in 5 seconds, no jargon), Trust (above-the-fold signals, real social proof only), Friction (short forms, minimal steps — each removed field is worth 5–10% more conversions), Mobile-first (83% of SaaS traffic is mobile), Show-before-tell (product visual above the fold), Outcome-in-headline (under 8 words / 44 characters), plus the standing addition from the audit: **Honesty** — never state a user count, rating, or named quote that isn't real and provable.

**MECLABS conversion heuristic**: `C = 4M + 3V + 2(I–F) – 2A` (Motivation, Value clarity, Incentive, Friction, Anxiety) — useful mental model when deciding what to add or cut from a page.

**Stripe architecture reference** (Part D of the original Blueprint — still generically correct and matches what's actually implemented): hosted Checkout over embedded for speed of shipping, webhook signature verification is mandatory, Customer Portal for self-serve cancellation/plan changes, feature-gating off a single `current_tier` column, Stripe Tax for compliance once volume justifies it.

**Free hosting comparison** (Part E — still valid): Cloudflare Workers+Pages+D1+R2, GitHub Pages+Workers+Supabase (what's actually in use), or Vercel+Supabase (more dev-friendly, not free at scale). The currently-deployed stack is the GitHub Pages + Cloudflare Workers + Supabase option.

**Conversion benchmarks to grow into** (Part F3 — aspirational targets, not current performance): industry SaaS landing-page conversion in the 3–13% range depending on traffic warmth and CTA discipline; single-CTA pages convert ~13.5% vs ~10.5% for multi-CTA pages industry-wide.

---

## 5. Corrections already applied (Blueprint Part I — why some of the above no longer matches the original Blueprint text)

These are factual fixes made after auditing the real codebase, and they're the reason the live funnel (§1) differs from both the original Blueprint draft and the Marketing Playbook:

1. **Fabricated social proof removed** — no more invented "12,000+ freelancers," "4.9/5 from 800+ reviews," or named testimonials ("James Muriithi," "Sarah K.," "Amina T."). SnipeJob's own PRD §9 already flagged these as placeholder copy. Beyond style, fake counts/ratings risk FTC endorsement-guidance and ad-platform policy violations once real money is involved.
2. **Source count and refresh rate corrected** — "40+ sources every 30 seconds" and "Upwork" as a source were both wrong; corrected to the real 5 sources / 15-minute refresh listed in §1. "First 5 applicants" guarantee language was softened to a non-falsifiable claim.
3. **Trial/guarantee language removed** — no "30-day free trial, no credit card" or "30-day money-back guarantee" claims remain; the live app's button only ever said "7-day free trial" and that's not actually configured in the Stripe Checkout session (`subscription_data[trial_period_days]` isn't set), so the safer "$9/mo, cancel anytime" framing is used until trial mechanics are verified end-to-end.
4. **Visual identity aligned to the shipped app** — replaced the Blueprint's invented orange/purple palette with the app's real existing tokens (see §1) so a visitor doesn't feel a jarring mismatch between ad/landing page and the product they land in next.
5. **Freenom / free-TLD recommendation removed** — replaced with: launch on the free `.pages.dev`/`.github.io`/`.workers.dev` subdomain, only move to a paid domain once running paid traffic.
6. **Confirmed the funnel does not duplicate Stripe Checkout logic** — it deep-links into the app's already-hardened signup → Checkout → webhook flow rather than building a second, parallel payment path that could drift out of sync or reopen the unauthenticated-webhook bug the project had already fixed once.
7. **Top navigation removed from the funnel page only** — applying the "removing top nav can ~2x conversion" stat; the main app retains full navigation since logged-in users need it.

**Still outstanding, not yet built** (flagged consistently across every doc in this set, never resolved):
- Privacy Policy / Terms of Service / Refund Policy pages — currently dead `<a>` links in the footer with no `href`. **Hard blocker for Stripe live-mode activation** and most jurisdictions' consumer-protection requirements.
- Hardcoded master login (`_MASTER_EMAIL` / `_MASTER_PASSWORD`) sitting in plaintext in `index.html`'s client-side source — anyone viewing page source can read it and get full Pro access bypassing Supabase. Fine for testing, not for real traffic. Flagged but intentionally left untouched pending confirmation it isn't an intentional debug shortcut.

---

## 6. Marketing Playbook content bank — usable, but needs a copy pass before reuse

`SnipeJob_Marketing_Playbook.html` is a large, organized library of ready-to-post social copy (Facebook, Instagram, LinkedIn, AI video prompts, monetization strategy), structured along the same Discovery → Nurture → Conversion layers as §4 above. It's genuinely useful as a content bank, but **don't copy-paste from it directly** — it predates the audit in §5 and repeats the now-corrected mistakes:
- Several posts say "Upwork" is a scanned source (it isn't).
- Several posts promise a "30-day free trial" (not real / not configured).
- Several posts only mention the $9/month price with no annual option, and some FOMO posts ("$19 next month," "first 100 only," "48 hours") describe specific offer mechanics that don't match what's actually live on the funnel today.
- Its embedded CSS still uses the old orange/purple palette, not the app's real one.

**If this content bank is worth keeping** (and the post structure/hooks are genuinely well-built — pain-first hooks, "comment trigger" engagement mechanics, before/after formats, FAQ objection-handling), the fastest path is a single find-and-replace pass: swap "Upwork" → the real 5 sources, drop every "30-day free trial" mention, and update price mentions to include the $90/year founding rate alongside $9/month. Until that pass happens, treat every quoted dollar figure, source name, and trial claim in that file as draft copy, not something to post.

---

## 7. Open items / next decisions

- [ ] Privacy Policy / Terms of Service / Refund Policy — blocks Stripe live mode (highest priority outstanding item across every doc).
- [ ] Decide whether to move the master login server-side or leave as an acknowledged debug shortcut.
- [ ] Confirm `STRIPE_PRO_ANNUAL_PRICE_ID` is set in both test and live mode and the migration has actually been run, if not already done.
- [ ] Run the full Stripe test-mode loop (§3) before sending any paid traffic.
- [ ] Decide whether to revise and keep the Marketing Playbook content bank (§6 fix-up) or write a fresh one once real numbers/testimonials exist.
