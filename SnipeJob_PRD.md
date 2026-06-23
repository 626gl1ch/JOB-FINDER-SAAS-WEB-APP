# SnipeJob — Product Requirements Document
### AI-Powered Freelance Job Discovery & Monetization Platform
**Prepared for: Acquisition / SaaS Marketplace Listing**

---

## 1. Executive Summary

SnipeJob is a production-grade, AI-powered SaaS platform that helps freelancers discover and win remote work faster than the competition — while giving them a second income stream through affiliate "Side Tasks." It is built entirely on modern, low-cost serverless infrastructure (Cloudflare Workers, Supabase, Google Gemini, GitHub Actions), which means **it can run at meaningful scale on free or near-free infrastructure tiers** — an unusually high-margin foundation for a buyer to inherit.

This is not a wireframe or a pitch deck. It is a working full-stack application: a polished, conversion-optimized marketing site; a complete signup-to-dashboard user journey; a real-time job aggregation engine pulling from five live sources; six distinct AI-powered features built on Gemini; a two-sided monetization engine (subscriptions + affiliate revenue share + display ads); and a Postgres schema with row-level security enforced on every table.

What's being offered is the **codebase, infrastructure design, and go-to-market assets** for a freelancer-focused SaaS — ready for a buyer to deploy, brand, and grow, or to absorb into an existing freelance/remote-work product portfolio.

---

## 2. The Problem

Remote freelance platforms (Upwork, Freelancer.com, We Work Remotely, Reddit hiring boards) are fragmented. A freelancer who wants first-mover advantage on a fresh listing has to manually monitor five-plus different sites. By the time they find a great post, ten other freelancers have already applied. Meanwhile, most "job alert" tools are single-source, have no AI matching, and offer no way for a freelancer to earn anything *between* jobs.

SnipeJob solves three problems at once for the same user:
1. **Discovery speed** — one dashboard aggregating multiple freelance job sources instead of five tabs.
2. **Application quality** — AI does the matching, the resume tailoring, and the proposal writing.
3. **Income gaps** — a built-in affiliate task marketplace lets users earn cash on slow weeks.

---

## 3. Product Overview

**Tagline:** *Land Freelance Work First.*

SnipeJob is a freemium SaaS with a $9/month Pro tier. Free users get real value (not a crippled trial), which keeps the top of the funnel wide; Pro users get the AI features that actually win contracts, which keeps the conversion path honest and benefit-driven rather than artificially gated.

| | Free | Pro — $9/mo |
|---|---|---|
| Job feed sources | All 5 sources | All 5 sources |
| Sectors visible | Choose 3 | All 16 sectors |
| Job pinning & dashboard | ✅ | ✅ |
| AI resume/profile autofill at signup | ✅ | ✅ |
| AI job match scoring | Keyword-based (free, instant) | Full Gemini fit-analysis |
| One-click AI proposal writer | ❌ | ✅ |
| AI resume scoring & tips | ✅ | ✅ (+ full AI rewrite) |
| AI mock interview prep | 3 generic questions | 5 job-tailored questions + AI answer scoring |
| Sector skill/cert trend insights | ✅ | ✅ |
| Side Task affiliate earnings | ✅ (30% cut, monthly payout) | ✅ (30% cut, instant payout) |
| Dashboard ads | Shown | None |
| Identity verification (AI KYC) | Available | Available |

---

## 4. Core Feature Set

### 4.1 Multi-Source Live Job Aggregation
A GitHub Actions cron job runs every 15 minutes, pulling fresh listings from **Reddit (r/forhire, r/freelance_jobs, r/remotejs, r/designjobs, r/videoeditingjobs), We Work Remotely, Remotive, Himalayas, and Freelancer.com**, auto-classifying each post into one of 16 sectors (web, data, video, design, AI, writing, mobile, cybersecurity, marketing, support, virtual assistant, sales, management, finance, legal, other) using keyword scoring. Listings older than 48 hours are automatically purged, keeping the database lean and the feed fresh.

### 4.2 AI Profile Autofill (Gemini 1.5 Flash)
At signup, a user can paste their bio or upload a PDF résumé. Gemini extracts their name, strongest marketable skill, a polished bio, education, and seniority level — turning a multi-field onboarding form into a 10-second action.

### 4.3 AI Job Matching & Ranking
Free users get an instant, zero-AI-cost keyword overlap score against their primary skill. Pro users get a true Gemini-driven fit analysis across their full profile (skill, bio, seniority) against the live job pool, with a plain-English reason for every match.

### 4.4 One-Click AI Apply
SnipeJob's signature feature. Pro users click a single button on any job card; Gemini reads the job post and the user's profile and drafts a tailored, ready-to-send proposal in seconds — editable before sending.

### 4.5 AI Resume Tools
Every user can get an instant AI score (0–100) on their profile bio with concrete improvement tips. Pro users can additionally generate a fully tailored, job-specific resume rewrite on demand.

### 4.6 AI Mock Interview Prep
Free users practice against generic, sector-relevant behavioral questions. Pro users get five questions generated specifically from a chosen job posting, plus AI-scored feedback on every answer they submit — a genuinely differentiated career-prep feature most competitors don't offer at any price.

### 4.7 Sector Trend Intelligence
A cached-and-refreshed Gemini analysis of in-demand skills and worth-getting certifications, broken out per sector, surfaced directly in the dashboard's "Career Prep" panel.

### 4.8 Side Task — Built-In Affiliate Income
A second monetization surface that also benefits users: short third-party offers (surveys, app trials, sign-up bonuses) matched to the user's country, with **30% of every confirmed payout credited straight to their SnipeJob wallet** — withdrawable from $2 via PayPal, bank transfer, BTC, ETH, or USDT. This is what makes the free tier sticky: users have a reason to open the app even on days with no new job matches.

### 4.9 AI-Powered Identity Verification
Government ID images are analyzed by Gemini for authenticity and country-of-origin, cross-checked against the request's edge-network country signal — a zero-headcount, zero-third-party-vendor KYC layer that protects the affiliate payout system from fraud.

### 4.10 Project / Contract Tracker
A lightweight dashboard panel for freelancers to track active and completed contracts (client, value, due date, completion %) alongside their job search — keeping SnipeJob open as a daily habit beyond just job hunting.

---

## 5. Monetization Model

SnipeJob is built with **three concurrent revenue streams**, which is unusual for a project at this stage and a meaningful part of its acquisition value:

1. **Subscription revenue** — $9/month Pro tier, built on Stripe Billing (recurring billing, proration, dunning, and cancellation handled by Stripe, not custom code).
2. **Affiliate revenue share** — SnipeJob keeps 70% of every Side Task payout processed through its postback system; the user's 30% cut is what's marketed to them.
3. **Display advertising** — a dashboard ad banner shown to free-tier users only, auto-hidden the moment a user upgrades, ready to drop in any ad network's tag (AdSense-ready).

A buyer is not just acquiring a job board — they're acquiring a platform with three independent levers to pull on day one.

---

## 6. Technical Architecture

| Layer | Technology | Why it matters to a buyer |
|---|---|---|
| Edge API | Cloudflare Workers | No servers to patch or scale manually; generous free tier; sub-50ms global response times |
| Database & Auth | Supabase (Postgres) | Row-level security enforced on every table — users can only ever touch their own data, enforced at the database layer, not just in application code |
| AI | Google Gemini 1.5 Flash | Lowest-cost frontier-adjacent model family suitable for this workload; six distinct product features run on one shared API integration pattern |
| Scraper / Cron | GitHub Actions (free tier) | Zero infrastructure to maintain for the job-aggregation pipeline |
| Frontend | Static HTML/CSS/JS, deployable to GitHub Pages or any static host | No build pipeline, no framework version risk, trivially portable to any host or CDN |
| Payments | Stripe Checkout + Billing | PCI scope stays with Stripe; recurring billing logic isn't hand-rolled |

**The infrastructure bill at low-to-moderate scale is close to $0/month** outside of the Gemini API usage and Supabase once it exceeds the free tier — an exceptionally efficient cost base for a buyer to inherit and scale.

---

## 7. Security Posture

This codebase has been through a dedicated engineering audit as part of this listing, with the following protections already in place or just hardened:

- Row-level security on every user-data table — a user's API token, even if leaked, cannot read or write another user's profile, jobs, earnings, or withdrawal history.
- AI-verified KYC gating the affiliate payout system.
- Country-mismatch fraud detection on every affiliate task completion (VPN/proxy abuse protection).
- Payment confirmation now requires a verified cryptographic signature from the payment processor — a previously-unauthenticated webhook path was identified and closed during this audit.
- The affiliate postback endpoint now requires a shared secret known only to the connected ad network — a previously-exploitable self-payout path was identified and closed during this audit.
- Atomic, race-condition-safe wallet withdrawal logic at the database layer.

*A full list of fixes applied is documented in the included engineering handoff guide, demonstrating active due diligence rather than presenting an unaudited codebase.*

---

## 8. What's Included In This Sale

- Full source: Cloudflare Worker API (22 routes), Supabase schema with RLS policies and triggers, automated job scraper, GitHub Actions cron workflow, and a complete single-page frontend.
- A fully copywritten, conversion-oriented marketing site: hero, social-proof testimonials, Side Task explainer, plan comparison table, FAQ, and pricing section — ready to launch, not a placeholder template.
- Existing deployment documentation (hosting guide, Stripe payment integration guide, monetization configuration guide).
- A clean three-tier sector taxonomy (16 sectors) already wired through scraping, filtering, and matching.

---

## 9. Honest Disclosures (Buyer Due Diligence)

In the interest of transparency for a marketplace listing:

- This is a **launch-ready codebase and business model**, not a business with an existing user base or revenue history. Testimonials and social-proof figures on the marketing site are illustrative placeholder copy and should be replaced with real figures once the product has live users.
- The current "job alerts" delivery mechanism is a **15-minute polling cron**, not a push/email/SMS notification system. The marketing copy's "under 30 seconds" and "priority queue" alert-speed claims describe a roadmap capability, not the current delivery mechanism, and should be aligned with reality before public launch (see Section 10).
- The Side Task affiliate feature requires the buyer to sign up with an affiliate network (e.g. CPALead, OfferToro) and add the API credentials — the integration code is complete and ready, but no network is pre-connected.
- The AI full-resume-rewrite feature (a paid-tier entitlement) has a working backend endpoint but is not yet wired to a frontend trigger — flagged as a fast-follow in the roadmap below.

---

## 10. Roadmap / Growth Opportunities for a Buyer

- **Real push notifications** — email (Resend/Postmark) or browser push for true real-time alerts, closing the gap between marketing promise and current polling-based delivery.
- **Finish the AI full resume rewrite UI** — backend is complete; needs a job-picker and result view.
- **Persist the project tracker to the database** — currently a UI-only, session-scoped feature.
- **Automate crypto subscription payments** via NOWPayments to complement Stripe.
- **Employer-side job posting** — a self-serve "post a job here" flow would convert SnipeJob from a pure aggregator into a two-sided marketplace with its own organic listings revenue.
- **Expand job sources** — LinkedIn, Indeed Remote, AngelList/Wellfound, and niche Discord/Slack job boards are natural next integrations using the existing scraper pattern.
- **Native mobile app** — the API is already a clean, documented REST layer; a React Native or Flutter client could ship quickly on top of it.

---

## 11. Why This Asset, Why Now

AI-assisted job search and AI-assisted freelancing are both categories with rising search interest and minimal credible competition outside of large incumbents who don't specialize in freelance work specifically. SnipeJob combines:

- A genuinely useful **and** monetized free tier (rare — most competitors gate everything),
- A real AI feature set that goes beyond "GPT wrapper" status (six distinct, well-scoped AI touchpoints across the user journey),
- Infrastructure economics that make profitability achievable at a very small subscriber count, and
- A finished, professional marketing site that would otherwise take a buyer weeks to design and copywrite from scratch.

This is an acquisition that lets a buyer skip the 0-to-1 build phase entirely and move straight to growth.
