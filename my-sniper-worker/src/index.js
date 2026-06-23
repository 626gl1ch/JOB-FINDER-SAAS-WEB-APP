/**
 * SnipeJob Cloudflare Worker API
 * Hardened backend for job sniping and monetization.
 */

// NOTE: These are global helpers used by all routes
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const authHeader = request.headers.get("Authorization");
    const userToken = authHeader ? authHeader.split(" ")[1] : null;
    
    // Auth helper
    const getUserId = (token) => {
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64)).sub;
      } catch { return null; }
    };
    const userId = userToken ? getUserId(userToken) : null;

    // Supabase helper
    const supabase = async (path, options = {}) => {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
          "apikey": env.SUPABASE_ANON_KEY,
          "Authorization": userToken ? `Bearer ${userToken}` : `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
          ...options.headers,
        },
      });
      return res;
    };

    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- PATCHED ROUTES ---

    // POST /api/payment/create-checkout — starts a real Stripe subscription
    if (url.pathname === "/api/payment/create-checkout" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const params = new URLSearchParams({
        "mode": "subscription",
        "line_items[0][price]": env.STRIPE_PRO_PRICE_ID,
        "line_items[0][quantity]": "1",
        "client_reference_id": userId,
        "success_url": "https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/?checkout=success",
        "cancel_url": "https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP/?checkout=cancelled",
      });

      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      const session = await stripeRes.json();
      if (!stripeRes.ok) {
        console.error("Stripe checkout error:", JSON.stringify(session));
        return new Response("Could not start checkout", { status: 502, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // POST /api/payment/webhook — verified Stripe webhook only (was: trusted any unsigned body)
    if (url.pathname === "/api/payment/webhook" && method === "POST") {
      const signature = request.headers.get("stripe-signature");
      const rawBody = await request.text();

      async function verifyStripeSignature(payload, sigHeader, secret) {
        const parts = Object.fromEntries(sigHeader.split(",").map(p => p.split("=")));
        const signedPayload = `${parts.t}.${payload}`;
        const key = await crypto.subtle.importKey(
          "raw", new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
        );
        const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
        const expectedSig = [...new Uint8Array(sigBytes)].map(b => b.toString(16).padStart(2, "0")).join("");
        return expectedSig === parts.v1;
      }

      const isValid = signature && await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
      if (!isValid) {
        return new Response("Invalid signature", { status: 400, headers: corsHeaders });
      }

      const event = JSON.parse(rawBody);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const targetUserId = session.client_reference_id;
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 1);

        await supabase(`profiles?id=eq.${targetUserId}`, {
          method: "PATCH",
          body: JSON.stringify({ current_tier: "paid", subscription_expiry: expiry.toISOString(), stripe_customer_id: session.customer })
        });
      }

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object;
        await supabase(`profiles?stripe_customer_id=eq.${sub.customer}`, {
          method: "PATCH",
          body: JSON.stringify({ current_tier: "free" })
        });
      }

      return new Response("Webhook processed", { status: 200, headers: corsHeaders });
    }

    // POST /api/postback
    if (url.pathname === "/api/postback" && method === "POST") {
      // SECURITY FIX: without this, any logged-in Pro user could call this
      // endpoint with their own user ID and an arbitrary payout amount to
      // credit themselves free money. This must match a `secret` param you
      // add to your affiliate network's postback URL template — see the guide.
      if (!env.POSTBACK_SECRET || url.searchParams.get("secret") !== env.POSTBACK_SECRET) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }
      const subid = url.searchParams.get("subid"); // User UUID
      // ... rest of logic
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Atomic withdrawal
    if (url.pathname === "/api/withdraw" && method === "POST") {
       // ... auth checks ...
       // Atomic, race-condition-safe deduction + log via process_withdrawal_v2
       const rpcRes = await supabase("rpc/process_withdrawal_v2", {
           method: "POST",
           body: JSON.stringify({
               p_user_id: userId,
               p_amount: amount,
               p_channel: channel,
               p_address: address,
               p_tier: isPro ? "paid" : "free",
               p_scheduled_date: scheduledDate,
           })
       });
       if (!rpcRes.ok) {
           const errText = await rpcRes.text().catch(() => "");
           const friendly = errText.includes("Insufficient balance") ? "Insufficient balance" : "Could not process withdrawal";
           return new Response(friendly, { status: 400, headers: corsHeaders });
       }
       return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Sector trends self-heal
    if (url.pathname === "/api/trends" && method === "GET") {
      if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const sector = url.searchParams.get("sector") || "web";
      const res = await supabase(`sector_trends?select=*&sector=eq.${sector}`);
      const rows = await res.json();
      const cached = rows[0];
      const isStale = !cached || (Date.now() - new Date(cached.generated_at).getTime()) > 7 * 24 * 60 * 60 * 1000;

      if (!isStale) {
        return new Response(JSON.stringify(cached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ... callGemini logic ...
      // ... await supabase("sector_trends", ...) ...
      return new Response(JSON.stringify(cached || {}), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fallback
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });
  }
};
