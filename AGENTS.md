# SnipeJob SaaS — Backend Ops Rules
> Antigravity IDE only. Applies to every backend task opened in this workspace.
> Companion security rules live in `~/.gemini/GEMINI.md` → `## Backend Ops Security Rules`.
> MCP server blocks live in `~/.gemini/config/mcp_config.json`.

---

## Project Identity

| Field | Value |
|---|---|
| **Product** | SnipeJob ("Land Freelance Work First") |
| **Workspace** | JOB FINDER SAAS V3 |
| **Frontend** | `index.html` — single-page SaaS app, hosted on GitHub Pages |
| **GitHub repo** | `626gl1ch/JOB-FINDER-SAAS-WEB-APP` → `https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/` |
| **Edge API** | Cloudflare Worker `my-sniper-worker` → `https://my-sniper-worker.daniellancce1.workers.dev` |
| **Database / Auth** | Supabase · project ref: `mdmpcxtjwnovbhidwwhj` → `https://mdmpcxtjwnovbhidwwhj.supabase.co` |
| **AI** | Google Gemini 1.5 Flash (via `GEMINI_API_KEY` Worker secret) |
| **Payments** | Paystack Standard + Subscriptions (test-mode default; live-mode requires explicit confirmation) |
| **Email** | Resend (expiry warning emails via `RESEND_API_KEY` Worker secret) |
| **Affiliate** | CPALead postback (offer feed URL + API key via Worker secrets) |
| **Scraper cron** | GitHub Actions → `scraper.js` (uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` repo secrets) |
| **Subscription cron** | Supabase `pg_cron` → calls `/api/internal/send-expiry-email` daily at 08:00 UTC |
| **Companion workspace** | `JOB FINDER SALES FUNNEL` — static funnel page, calls the same Worker |

---

## A.0 — How Antigravity Should Use This File

1. **Before any backend task**, re-read this file and `~/.gemini/GEMINI.md → ## Backend Ops Security Rules`.
2. **State which MCP connection(s) you'll use** and confirm scope (read-only vs. write, test vs. live).
3. **Pre-flight check** (see A.5) before touching anything.
4. If a capability is listed under "Not possible via MCP — build custom," use the custom MCP template provided — do not force an existing tool.
5. **Always obey the Security Rules** (GEMINI.md R1–R12). If a request conflicts with a security rule, stop and ask before proceeding.
6. **Default: read-only / plan-first.** Never execute a destructive or money-moving action without showing the exact command/payload and getting a go-ahead, unless pre-authorized for this session.

---

## A.1 — Supabase MCP

**MCP server name:** `supabase-snipejob` (read-only, default)
**MCP server name:** `supabase-snipejob-write` (write — activate explicitly per task only)

**Project ref:** `mdmpcxtjwnovbhidwwhj`
**Always pass `project_ref`** — omitting it exposes every project in the org.

### What the MCP server can do
- Run arbitrary SQL (`execute_sql`)
- Apply / generate migrations; list tables, columns, relationships, extensions
- Generate TypeScript types from schema
- Pull security and performance advisors (`get_advisors` — RLS gaps, missing indexes)
- Pull live logs
- Manage schema branches (create / list / merge / rebase / delete / reset)
- List, deploy, and inspect Edge Functions
- Search Supabase docs
- Project and org admin; update storage config (paid plans)

### SnipeJob-specific tables and functions to know
**Tables:** `profiles`, `scraped_jobs`, `user_pinned_jobs`, `affiliate_logs`, `withdrawal_requests`, `claimed_paystack_sessions` (or equivalent claimed payment sessions table)

**⚠️ Tables needed by the Worker but not yet confirmed in `schema.sql`:**
`interview_sessions`, `interview_answers`, `sector_trends` — verify these exist before touching Interview Prep or Sector Trends in production.

**Functions / triggers:** `handle_new_user()` (+`on_auth_user_created`), `process_affiliate_credit()`, `process_withdrawal()`, `check_subscription_expiry()` (+`cron.schedule` at `0 8 * * *`).

**pg_cron job:** `snipejob-subscription-expiry-check` — runs `public.check_subscription_expiry()` daily at 08:00 UTC. Calls Worker at `app.worker_url`; authenticated by `app.worker_internal_secret` (must match `WORKER_INTERNAL_SECRET` Worker secret).

### Not possible via MCP — build custom

**Bulk Auth user management with custom claims:**
```typescript
// Custom tool using supabase-js auth.admin methods
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
// e.g. supabase.auth.admin.updateUserById(uid, { app_metadata: { tier: "pro" } })
```

**Row-level data seeding for schema branches** (branches copy schema only, not data):
Build a `seed_branch` tool that runs a seed SQL script against the branch.

**Cross-project secret sync** (e.g. mirroring a Supabase service key into a Cloudflare Worker secret):
See A.4 — cross-service orchestration tool.

---

## A.2 — Cloudflare MCP

**MCP server name:** `cloudflare-snipejob`
**Worker name:** `my-sniper-worker` (account: `daniellancce1`)
**Worker source:** `my-sniper-worker/src/index.js`
**Wrangler config:** `my-sniper-worker/wrangler.jsonc`

**All Worker secrets are set via `npx wrangler secret put <NAME>` from inside `my-sniper-worker/`.**

### What the MCP server can do
- Full Workers lifecycle (deploy, list, delete, tail logs)
- DNS record management
- R2 / D1 / KV operations
- Zero Trust / Access policies
- Firewall and load balancer config
- Analytics, browser rendering
- Secrets (`wrangler secret put` equivalents via API)

### SnipeJob Worker secrets to know
| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | DB connection |
| `SUPABASE_ANON_KEY` | Client-facing auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin DB operations |
| `GEMINI_API_KEY` | All AI features |
| `PAYSTACK_SECRET_KEY` | Paystack API Key (`sk_test_...` or `sk_live_...`) |
| `PAYSTACK_WEBHOOK_SECRET` | Webhook signature verification |
| `PAYSTACK_PRO_PLAN_CODE` | Monthly plan code in Paystack |
| `PAYSTACK_PRO_ANNUAL_PLAN_CODE` | Annual plan code in Paystack |
| `RESEND_API_KEY` | Expiry warning emails |
| `WORKER_INTERNAL_SECRET` | Authenticates pg_cron → Worker calls |
| `OFFER_FEED_URL` | CPALead affiliate feed |
| `OFFER_FEED_API_KEY` | CPALead API key |
| `APP_BASE_URL` | Optional — only if moving off default GitHub Pages URL |

### Not possible via MCP — build custom

**Triggering business-logic endpoints inside `my-sniper-worker` on demand**
(e.g. manually triggering the affiliate postback flow, or running an ad-hoc expiry check):
Use `workers-mcp` to expose specific Worker methods as MCP tools:
```typescript
import { WorkerEntrypoint } from "cloudflare:workers";
import { ProxyToSelf } from "workers-mcp";

export default class MyWorker extends WorkerEntrypoint {
  async triggerExpiryCheck(): Promise<string> {
    // calls check_subscription_expiry logic directly
    return "Expiry check triggered";
  }
  async fetch(request: Request) {
    return new ProxyToSelf(this).fetch(request);
  }
}
```
Install: `npm install workers-mcp` then `npx workers-mcp setup`. Redeploy after any method signature change.

**Billing-tier / plan changes** — read-only via MCP; treat as manual-only.

---

## A.3 — Paystack MCP

**MCP server name:** `paystack-snipejob` (test mode, default)
**MCP server name (production):** `paystack-snipejob-live` (**requires custom direct-API wrapper and "yes, this is live and I mean it" confirmation per R8 before any tool call**)

### What the official MCP server can do
Exposes the entire Paystack API dynamically by parsing the OpenAPI specification at runtime. All documented endpoints are accessible via two generic tools:
- `get_paystack_operation` — fetch operation details by operation ID.
- `make_paystack_request` — execute any Paystack API request once parameters are known.

### SnipeJob Paystack identifiers to know
- Monthly plan: `PAYSTACK_PRO_PLAN_CODE`
- Annual plan: `PAYSTACK_PRO_ANNUAL_PLAN_CODE`
- Webhook endpoint: `/api/payment/webhook` on the Worker
- Webhook events handled: `charge.success`, `subscription.create`, `subscription.disable` (or equivalent Paystack webhook events)

### Not possible via MCP — build custom (covers Live Operations + Webhook management)
The official Paystack MCP server **only accepts test secret keys** (`sk_test_*`) by design. For live mode, build a thin custom stdio MCP server using `@modelcontextprotocol/sdk` and the Paystack REST API:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PAYSTACK_BASE = "https://api.paystack.co";
const HEADERS = {
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY!}`,
  "Content-Type": "application/json",
};

const server = new McpServer({ name: "paystack-snipejob-live", version: "1.0.0" });

server.tool("initialize_transaction",
  { email: { type: "string" }, amount: { type: "number" }, callback_url: { type: "string" }, plan: { type: "string" } },
  async ({ email, amount, callback_url, plan }) => {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ email, amount: amount * 100, callback_url, plan }), // amount in kobo/cents
    });
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
  });

server.tool("verify_transaction",
  { reference: { type: "string" } },
  async ({ reference }) => {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
      headers: HEADERS,
    });
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
  });
```

---

## A.4 — Cross-Service Consistency Tool

Nothing off-the-shelf verifies consistency across Supabase, Cloudflare, and Paystack simultaneously.
Build this once and reuse for every backend audit:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const PAYSTACK_BASE = "https://api.paystack.co";
const PAYSTACK_HEADERS = {
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY!}`,
  "Content-Type": "application/json",
};

const server = new McpServer({ name: "snipejob-consistency-check", version: "1.0.0" });

// Check that Paystack plan IDs referenced in the Worker's secrets actually exist in Paystack
server.tool("check_plan_price_consistency", {}, async () => {
  const planCodes = [process.env.PAYSTACK_PRO_PLAN_CODE!, process.env.PAYSTACK_PRO_ANNUAL_PLAN_CODE!];
  const results = [];
  for (const code of planCodes) {
    try {
      const res = await fetch(`${PAYSTACK_BASE}/plan/${code}`, { headers: PAYSTACK_HEADERS });
      if (res.ok) results.push(`OK: ${code}`);
      else results.push(`MISSING IN PAYSTACK: ${code}`);
    } catch {
      results.push(`ERROR CHECKING: ${code}`);
    }
  }
  return { content: [{ type: "text", text: results.join("\n") }] };
});
```

---

## A.5 — Ongoing Behavior (Every Backend Task)

### Before starting any task
1. Re-read this file and `~/.gemini/GEMINI.md → ## Backend Ops Security Rules`.
2. State which MCP connection(s) you will use, and confirm:
   - **Scope**: read-only (`supabase-snipejob`) vs. write (`supabase-snipejob-write`) — default is read-only
   - **Paystack mode**: test (`paystack-snipejob`) vs. live (`paystack-snipejob-live`) — default is test
   - **Worker target**: is `wrangler.jsonc` pointing at `my-sniper-worker` in the correct account (`daniellancce1`)?
3. **Pre-flight**: confirm you're pointed at `mdmpcxtjwnovbhidwwhj` (not another Supabase project), that test/live mode matches intent, and that no naming mismatches exist between what the task expects and what exists.
4. For any SQL write, migration, Worker deploy, DNS change, secret rotation, or Paystack write — print the exact command/payload and wait for confirmation (**R2**).

### After completing any task
1. **Post-flight**: re-query affected resources to confirm the change applied.
2. Check for orphaned resources (e.g. a Worker secret set but no longer referenced in code).
3. Cross-check consistency across services if the change spans more than one (use A.4 tool if available).
4. **Summarize what changed** in plain text: resource name, before → after state (**R10**).

### Never
- Skip pre/post-flight to save time.
- Treat a prior successful run as blanket authorization for a similar-but-distinct action.
- Chain multiple destructive actions silently — list them, get one confirmation, then execute (**R9**).
- Echo a raw secret value in chat, logs, or any committed file (**R5**).

---

## Open Items (from SNIPEJOB_MASTER_DOCUMENTATION.md §8 and funnel reference)

- [ ] Confirm `interview_sessions`, `interview_answers`, `sector_trends` tables exist in Supabase live project.
- [ ] Privacy Policy / Terms of Service / Refund Policy pages — **hard blocker for Paystack live-mode activation**.
- [ ] Master login (`_MASTER_EMAIL` / `_MASTER_PASSWORD`) in `index.html` client-side source — decide: remove or explicitly acknowledge as debug-only.
- [ ] Confirm `PAYSTACK_PRO_ANNUAL_PLAN_CODE` is set in both test and live mode and the funnel migration has run.
- [ ] Full Paystack test-mode loop (both plans) before sending paid traffic.
