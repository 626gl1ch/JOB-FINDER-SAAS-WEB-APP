/**
 * SnipeJob Cloudflare Worker API
 * Zero-cost backend for job sniping and monetization.
 */

export default {
  async fetch(request, env) {
    // CORS headers are defined first so the top-level catch can always send them,
    // even when an unhandled exception occurs before they would otherwise be set.
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    try {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const authHeader = request.headers.get("Authorization");
    const userToken = authHeader ? authHeader.split(" ")[1] : null;

    // Decode the JWT payload to get the real Supabase user UUID (the "sub" claim).
    // We do NOT verify the signature here ÔÇö Supabase still does that on every
    // REST call made via the `supabase()` helper below, since we forward the
    // same bearer token and RLS enforces auth.uid() server-side. This decode
    // is only so the worker itself can reference the correct UUID (e.g. for
    // user_id columns), instead of accidentally sending the raw JWT string
    // where a UUID is expected.
    let userId = null;
    if (userToken) {
      try {
        const payloadB64 = userToken.split(".")[1];
        const payloadJson = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
        userId = JSON.parse(payloadJson).sub || null;
      } catch (e) {
        userId = null; // malformed token ÔÇö requests needing userId will 401 below
      }
    }

    // Helper for Supabase requests
    const supabase = async (path, options = {}) => {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
          "apikey": env.SUPABASE_ANON_KEY,
          "Authorization": userToken ? `Bearer ${userToken}` : `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      return res;
    };

    // Shared Gemini text-generation helper ÔÇö used by ai-apply, ai-resume,
    // job ranking, resume scoring, interview prep, and signup autofill.
    // Accepts either a plain text prompt (string) or a multimodal parts
    // array (for PDF input ÔÇö see /api/profile/autofill).
    const callGemini = async (promptOrParts) => {
      const parts = typeof promptOrParts === "string" ? [{ text: promptOrParts }] : promptOrParts;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] }),
      });
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return { ok: res.ok && !!text, text, raw: data };
    };

    // Parses Gemini's text response as JSON, stripping markdown code fences
    // if present (Gemini sometimes wraps JSON in ```json ... ``` even when
    // told not to).
    const parseGeminiJson = (text) => {
      try {
        return JSON.parse(text.replace(/```json|```/g, "").trim());
      } catch (e) {
        return null;
      }
    };

    // --- ROUTES ---

    // 0. GET /debug/env (Hosting Verification)
    if (url.pathname === "/debug/env" && method === "GET") {
        return new Response(JSON.stringify({
            hasSupabaseUrl: !!env.SUPABASE_URL,
            hasSupabaseAnonKey: !!env.SUPABASE_ANON_KEY,
            hasSupabaseServiceRoleKey: !!env.SUPABASE_SERVICE_ROLE_KEY,
            hasGeminiApiKey: !!env.GEMINI_API_KEY
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 0c. POST /api/profile/autofill (Signup-time resume scan ÔÇö runs BEFORE
    // the account exists, so this is intentionally unauthenticated. Accepts
    // either resume_text (pasted) or file_base64 (PDF upload, sent straight
    // to Gemini's multimodal input ÔÇö no separate PDF parsing library needed).
    if (url.pathname === "/api/profile/autofill" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { resume_text, file_base64 } = body;

      if (!resume_text && !file_base64) {
        return new Response("Provide resume_text or file_base64", { status: 400, headers: corsHeaders });
      }
      // Basic abuse guard: cap pasted text length and base64 payload size
      // server-side too, since this route has no auth gate.
      if (resume_text && resume_text.length > 20000) {
        return new Response("Resume text too long", { status: 400, headers: corsHeaders });
      }
      if (file_base64 && file_base64.length > 11000000) { // ~8MB binary as base64
        return new Response("File too large", { status: 400, headers: corsHeaders });
      }

      const instruction = `Extract the following from this resume/bio. Be conservative ÔÇö if something isn't clearly stated, leave it as an empty string rather than guessing.
Return ONLY strict JSON, no markdown: {"full_name": "", "primary_skill": "their single strongest/most marketable skill", "bio": "2-3 sentence professional summary in their voice, under 400 characters", "education": "degree or certifications, short", "exp_level": "one of: junior, mid, senior, expert"}`;

      const parts = file_base64
        ? [{ text: instruction }, { inline_data: { mime_type: "application/pdf", data: file_base64 } }]
        : [{ text: `${instruction}\n\nRESUME/BIO TEXT:\n${resume_text}` }];

      const gemini = await callGemini(parts);
      if (!gemini.ok) {
        console.error("Gemini autofill error:", JSON.stringify(gemini.raw).slice(0, 500));
        return new Response("AI scan is temporarily unavailable. Please fill in the fields manually.", { status: 502, headers: corsHeaders });
      }
      const result = parseGeminiJson(gemini.text);
      if (!result) return new Response("AI returned an unreadable result. Please fill in the fields manually.", { status: 502, headers: corsHeaders });

      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 0b. GET /api/profile (merged in from my-sniper-worker ÔÇö that copy is now retired)
    if (url.pathname === "/api/profile" && method === "GET") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const res = await supabase(`profiles?select=*&id=eq.${userId}`);
      const profiles = await res.json();
      if (!Array.isArray(profiles) || profiles.length === 0) {
        return new Response("Profile not found", { status: 404, headers: corsHeaders });
      }
      return new Response(JSON.stringify(profiles[0]), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 0d. PATCH /api/profile (Completes onboarding for OAuth signups, who
    // already have an auth.users row + a blank profiles row from the DB
    // trigger, but skipped the wizard's profile/sector steps via redirect.)
    if (url.pathname === "/api/profile" && method === "PATCH") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const body = await request.json().catch(() => ({}));
      const allowedFields = ["full_name", "country", "exp_level", "primary_skill", "bio", "education", "sectors"];
      const updates = {};
      for (const field of allowedFields) {
        if (body[field] !== undefined) updates[field] = body[field];
      }
      if (Object.keys(updates).length === 0) {
        return new Response("No valid fields to update", { status: 400, headers: corsHeaders });
      }
      const res = await supabase(`profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: { "Prefer": "return=representation" },
        body: JSON.stringify(updates),
      });
      const updated = await res.json();
      return new Response(JSON.stringify(updated[0] || {}), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. GET /api/jobs (Tier-Enforced Job Delivery)
    if (url.pathname === "/api/jobs" && method === "GET") {
      if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      // Get user profile to check tier and sectors
      const profileRes = await supabase("profiles?select=current_tier,sectors");
      const profiles = await profileRes.json();
      const profile = profiles[0];

      if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });

      const sector = url.searchParams.get("sector") || "all";
      let query = `scraped_jobs?select=*&order=indexed_at.desc`;
      const userSectors = profile.sectors || []; // guard against a null sectors column on new profiles

      if (sector !== "all") {
        // Even if requesting a specific sector, check if free user has access
        if (profile.current_tier === "free" && !userSectors.includes(sector)) {
            return new Response("Upgrade to Pro to access this sector", { status: 403, headers: corsHeaders });
        }
        query += `&sector=eq.${sector}`;
      } else if (profile.current_tier === "free") {
        // Free users only see their selected sectors (max 3)
        // If they haven't selected any, show them 'web' by default
        const sectors = userSectors.length > 0 ? userSectors.slice(0, 3).join(",") : "web";
        query += `&sector=in.(${sectors})`;
      }

      // Tier limits
      if (profile.current_tier === "free") {
        query += "&limit=30"; // Increased limit slightly
      }

      const jobsRes = await supabase(query);
      const jobs = await jobsRes.json();

      return new Response(JSON.stringify({
        items: jobs,
        ad_compulsory_trigger: profile.current_tier === "free",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1b. GET /api/pinned (Fetch user pinned jobs)
    if (url.pathname === "/api/pinned" && method === "GET") {
        if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        const res = await supabase("user_pinned_jobs?select=*,job:scraped_jobs(*)");
        const data = await res.json();
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1c. POST /api/pin (Pin a job)
    if (url.pathname === "/api/pin" && method === "POST") {
        if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        const { job_id } = await request.json();
        if (!job_id) return new Response("Missing job_id", { status: 400, headers: corsHeaders });
        const res = await supabase("user_pinned_jobs", {
            method: "POST",
            body: JSON.stringify({ user_id: userId, job_id: job_id })
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            // Postgres unique-violation code when the job is already pinned
            const friendly = errBody.includes("23505") ? "Job already pinned" : (errBody || "Could not pin job");
            return new Response(friendly, { status: res.status, headers: corsHeaders });
        }
        return new Response(res.body, { status: res.status, headers: corsHeaders });
    }

    // 1d. DELETE /api/pin (Unpin a job)
    if (url.pathname === "/api/pin" && method === "DELETE") {
        if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        const { job_id } = await request.json();
        const res = await supabase(`user_pinned_jobs?job_id=eq.${job_id}`, { method: "DELETE" });
        return new Response(null, { status: res.status, headers: corsHeaders });
    }

    // 1e. PATCH /api/pin (Update pin status)
    if (url.pathname === "/api/pin" && method === "PATCH") {
        if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        const { job_id, status } = await request.json();
        const res = await supabase(`user_pinned_jobs?job_id=eq.${job_id}`, {
            method: "PATCH",
            body: JSON.stringify({ system_status: status })
        });
        return new Response(null, { status: res.status, headers: corsHeaders });
    }

    // 2. POST /api/ai-apply (AI Premium One-Click Application)
    if (url.pathname === "/api/ai-apply" && method === "POST") {
      if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const { job_id } = await request.json();
      if (!job_id) return new Response("Missing job_id", { status: 400, headers: corsHeaders });

      // Check if user is Pro
      const profileRes = await supabase("profiles?select=current_tier,payload_resume"); // Assuming resume is stored or passed
      const profile = (await profileRes.json())[0];
      if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });

      if (profile.current_tier !== "paid") {
        return new Response("Pro feature only", { status: 403, headers: corsHeaders });
      }

      // Get job details
      const jobRes = await supabase(`scraped_jobs?select=title,payload_description&id=eq.${job_id}`);
      const job = (await jobRes.json())[0];

      if (!job) return new Response("Job not found", { status: 404, headers: corsHeaders });

      // Call Gemini for proposal
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // was missing ÔÇö required by the Gemini API
        body: JSON.stringify({
          contents: [{
            parts: [{
                text: `You are an expert freelance proposal writer. Write a customized, professional, and persuasive job proposal for the following job:
                JOB TITLE: ${job.title}
                JOB DESCRIPTION: ${job.payload_description}

                Keep the tone confident but helpful. Do not use placeholders like [Your Name], use the user's profile information if provided. Return only the proposal text.`
            }]
          }]
        }),
      });

      const geminiData = await geminiRes.json();
      const proposalText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!geminiRes.ok || !proposalText) {
        console.error("Gemini ai-apply error:", JSON.stringify(geminiData).slice(0, 500));
        return new Response("AI proposal generation is temporarily unavailable. Please try again shortly.", { status: 502, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ proposal: proposalText }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- NEW: AI 1-TAP RESUME ENDPOINT ---
    if (url.pathname === "/api/ai-resume" && method === "POST") {
      if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const { job_id } = await request.json();
      if (!job_id) return new Response("Missing job_id", { status: 400, headers: corsHeaders });

      // 1. Get user profile
      const profileRes = await supabase("profiles?select=full_name,sectors,exp_level,primary_skill,bio,education,current_tier");
      const profile = (await profileRes.json())[0];
      if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });
      if (profile.current_tier !== "paid") return new Response("Pro feature only", { status: 403, headers: corsHeaders });

      // 2. Get job details
      const jobRes = await supabase(`scraped_jobs?select=title,payload_description&id=eq.${job_id}`);
      const job = (await jobRes.json())[0];
      if (!job) return new Response("Job not found", { status: 404, headers: corsHeaders });

      // 3. Call Gemini for Tailored Resume
      const prompt = `You are an expert resume writer. Generate a highly tailored, professional, and impactful resume for the following job:
      JOB: ${job.title}
      DESCRIPTION: ${job.payload_description}

      USER INFO:
      Name: ${profile.full_name}
      Level: ${profile.exp_level}
      Top Skill: ${profile.primary_skill}
      Bio: ${profile.bio}
      Education: ${profile.education}

      Structure the output as a clean, ready-to-send text resume with sections for Professional Summary, Skills, Experience (extrapolate based on bio), and Education. Focus on matching keywords from the job description.`;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // was missing ÔÇö required by the Gemini API
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      const geminiData = await geminiRes.json();
      const resumeText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!geminiRes.ok || !resumeText) {
        console.error("Gemini ai-resume error:", JSON.stringify(geminiData).slice(0, 500));
        return new Response("AI resume generation is temporarily unavailable. Please try again shortly.", { status: 502, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ status: "submitted", resume: resumeText }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // 3. POST /api/payment/webhook (Stripe/NOWPayments Webhook)
    if (url.pathname === "/api/payment/webhook" && method === "POST") {
        // Simplified webhook handler for simulation
        const { user_id, status } = await request.json();

        if (status === "confirmed") {
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + 1); // +1 Month

            await supabase(`profiles?id=eq.${user_id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    current_tier: "paid",
                    subscription_expiry: expiry.toISOString()
                })
            });
        }

        return new Response("Webhook processed", { status: 200, headers: corsHeaders });
    }

    // 4. POST /api/verify-id (Zero-Cost AI Identity Checks)
    if (url.pathname === "/api/verify-id" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const formData = await request.formData();
      const idImage = formData.get("image");
      const phoneNumber = formData.get("phone_number");

      if (!idImage) return new Response("Missing image", { status: 400, headers: corsHeaders });

      // In a real implementation, you'd upload to Supabase Storage here.
      // For brevity, we pass the image buffer directly to Gemini.

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // was missing ÔÇö required by the Gemini API
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "You are an automated KYC scanning engine. Analyze this identification document. Extract the Name, Document Type, and Country. Determine if the image appears to be a legitimate government ID or a fake/VPN mock-up. Return a strict JSON response with fields: 'is_valid' (boolean), 'extracted_country' (2-letter ISO code), 'confidence' (0-100), and 'reason' (string)." },
              { inline_data: { mime_type: "image/jpeg", data: Buffer.from(await idImage.arrayBuffer()).toString("base64") } }
            ]
          }]
        }),
      });

      const geminiData = await geminiRes.json();
      const candidateText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!geminiRes.ok || !candidateText) {
        // e.g. Gemini safety block, quota exceeded, or invalid key ÔÇö
        // previously this threw an uncaught TypeError and the client saw a
        // generic 500 with no explanation.
        console.error("Gemini verify-id error:", JSON.stringify(geminiData).slice(0, 500));
        return new Response("AI verification is temporarily unavailable. Please try again shortly.", { status: 502, headers: corsHeaders });
      }

      let aiResult;
      try {
        aiResult = JSON.parse(candidateText.replace(/```json|```/g, ""));
      } catch (e) {
        return new Response("AI verification returned an unreadable result. Please try again.", { status: 502, headers: corsHeaders });
      }

      const edgeCountry = request.headers.get("CF-IPCountry");
      let status = "flagged";

      if (aiResult.is_valid && aiResult.extracted_country === edgeCountry) {
        status = "verified";
      }

      // Update profile
      await supabase("profiles?id=eq." + userId, {
        method: "PATCH",
        body: JSON.stringify({
          id_status: status,
          verified_phone: phoneNumber,
          country: edgeCountry
        })
      });

      return new Response(JSON.stringify(aiResult), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4b. GET /api/offers (Live Side Task offer feed ÔÇö fetches from your
    // affiliate network and tags every offer link with this user's UUID as
    // subid, so postbacks can be matched back to the right wallet. Swap the
    // OFFER_FEED_URL and field names below for whichever network you join ÔÇö
    // see HOSTING.md "Affiliate Revenue" section for the macro reference.)
    if (url.pathname === "/api/offers" && method === "GET") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const profileRes = await supabase("profiles?select=current_tier,country");
      const profile = (await profileRes.json())[0];
      if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });
      // Side Tasks are available on both tiers (per the landing page promise) ÔÇö
      // no tier gate here. Payout *timing* differs by tier instead, handled
      // in /api/withdraw (free = monthly batch, Pro = immediate).

      if (!env.OFFER_FEED_URL || !env.OFFER_FEED_API_KEY) {
        // No network connected yet ÔÇö return an empty list rather than erroring,
        // so the dashboard shows "no tasks available" instead of breaking.
        return new Response(JSON.stringify({ items: [], configured: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      try {
        // Example shape for CPALead-style feeds ÔÇö adjust the URL/params and
        // the field names in the .map() below to match your chosen network's
        // actual JSON response format.
        const feedRes = await fetch(`${env.OFFER_FEED_URL}?api_key=${env.OFFER_FEED_API_KEY}&country=${profile.country || ''}&format=json`);
        const feedData = await feedRes.json();
        const rawOffers = Array.isArray(feedData) ? feedData : (feedData.offers || []);

        const offers = rawOffers.slice(0, 15).map(o => ({
          id: o.offer_id || o.id,
          title: o.title || o.name,
          payout: parseFloat(o.payout || o.amount || 0),
          user_cut: +(parseFloat(o.payout || o.amount || 0) * 0.3).toFixed(2),
          // userId embedded here is what comes back as {subid} on the postback
          link: `${o.link || o.url}${(o.link || o.url || '').includes('?') ? '&' : '?'}subid=${userId}`,
          country: o.country || profile.country,
        }));

        return new Response(JSON.stringify({ items: offers, configured: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        console.error("Offer feed fetch error:", e.message);
        return new Response("Could not load tasks right now. Please try again shortly.", { status: 502, headers: corsHeaders });
      }
    }

    // 4c. GET /api/earnings (Recent affiliate credit history, for the
    // "Recent earnings" panel ÔÇö reads from affiliate_logs which
    // process_affiliate_credit already writes to on every postback.)
    if (url.pathname === "/api/earnings" && method === "GET") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const res = await supabase(`affiliate_logs?select=user_credited_amount,incoming_network_provider,processing_timestamp&user_id=eq.${userId}&order=processing_timestamp.desc&limit=10`);
      const rows = await res.json();
      return new Response(JSON.stringify({ items: rows }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. POST /api/postback (Durable Affiliate Track & Fraud Firewall)
    if (url.pathname === "/api/postback" && method === "POST") {
      const subid = url.searchParams.get("subid"); // User UUID
      const payout = parseFloat(url.searchParams.get("payout"));
      const clickIp = url.searchParams.get("click_ip");
      const country = url.searchParams.get("country");

      // Verify user and country
      const profileRes = await supabase(`profiles?select=country,vpn_violation_count,current_tier&id=eq.${subid}`);
      const profiles = await profileRes.json();
      const profile = profiles[0];

      if (!profile || profile.current_tier !== 'paid') {
          return new Response("Pro subscription required for tasks", { status: 403, headers: corsHeaders });
      }

      if (profile.country !== country) {
        // VPN Violation
        if (profile) {
            await supabase(`profiles?id=eq.${subid}`, {
                method: "PATCH",
                body: JSON.stringify({ vpn_violation_count: profile.vpn_violation_count + 1 })
            });
        }
        return new Response("Fraud detected", { status: 403, headers: corsHeaders });
      }

      const userCut = payout * 0.3;
      const provider = url.searchParams.get("provider") || "unknown";

      // Atomic transaction via Supabase function
      await supabase("rpc/process_affiliate_credit", {
        method: "POST",
        body: JSON.stringify({
          target_user_id: subid,
          sub_id: url.searchParams.get("tracking_id") || `task_${Date.now()}`,
          provider: provider,
          raw_payout: payout,
          user_cut: userCut,
          ip_addr: clickIp
        })
      });

      return new Response("OK", { headers: corsHeaders });
    }

    // 4. POST /api/withdraw (Free tier: queued for monthly batch payout.
    // Pro tier: flagged for immediate processing. Previously this route
    // blocked ALL free-tier withdrawals outright, which contradicted the
    // landing page's "available to everyone" promise ÔÇö fixed to match.)
    if (url.pathname === "/api/withdraw" && method === "POST") {
       if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

       const body = await request.json();
       const { amount, channel, address } = body;

       if (!amount || amount < 2) return new Response("Minimum $2", { status: 400, headers: corsHeaders });

       // Check balance
       const profileRes = await supabase("profiles?select=wallet_balance,current_tier");
       const profile = (await profileRes.json())[0];
       if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });
       if (profile.wallet_balance < amount) return new Response("Insufficient balance", { status: 400, headers: corsHeaders });

       const isPro = profile.current_tier === "paid";

       // Free tier: next 1st-of-month at least 3 days out (so a withdrawal
       // requested on the 30th doesn't get an unrealistic next-day date).
       // Pro tier: no scheduled date ÔÇö processed immediately by your payout flow.
       let scheduledDate = null;
       if (!isPro) {
         const now = new Date();
         let target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
         const daysUntil = (target - now) / 86400000;
         if (daysUntil < 3) target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
         scheduledDate = target.toISOString().slice(0, 10);
       }

       // Deduct and log ÔÇö both calls scoped to this user explicitly,
       // rather than relying solely on RLS to filter an unscoped PATCH.
       await supabase(`profiles?id=eq.${userId}`, {
           method: "PATCH",
           body: JSON.stringify({ wallet_balance: profile.wallet_balance - amount })
       });

       await supabase("withdrawal_requests", {
           method: "POST",
           body: JSON.stringify({
               user_id: userId,
               total_amount: amount,
               payment_channel: channel,
               target_address: address,
               status: "pending",
               tier_at_request: isPro ? "paid" : "free",
               scheduled_payout_date: scheduledDate,
           })
       });

       return new Response(JSON.stringify({
         success: true,
         payout_timing: isPro ? "immediate" : "monthly_batch",
         scheduled_payout_date: scheduledDate,
       }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. GET /api/jobs/ranked (AI Job Ranking ÔÇö free tier gets a fast local
    // keyword score, Pro gets Gemini's full-fit analysis. Free has no
    // Gemini cost; only Pro calls the model.)
    if (url.pathname === "/api/jobs/ranked" && method === "GET") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const profileRes = await supabase("profiles?select=current_tier,sectors,primary_skill,bio,exp_level");
      const profile = (await profileRes.json())[0];
      if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });

      const sector = url.searchParams.get("sector") || "all";
      let query = `scraped_jobs?select=*&order=indexed_at.desc&limit=20`;
      if (sector !== "all") query += `&sector=eq.${sector}`;
      const jobsRes = await supabase(query);
      const jobs = await jobsRes.json();

      if (profile.current_tier !== "paid") {
        // FREE: local keyword-overlap score, no AI call, instant + zero cost.
        const skillWords = (profile.primary_skill || "").toLowerCase().split(/\W+/).filter(Boolean);
        const ranked = jobs.map(job => {
          const text = (job.title + " " + job.payload_description).toLowerCase();
          const hits = skillWords.filter(w => w.length > 2 && text.includes(w)).length;
          const matchScore = skillWords.length > 0 ? Math.min(100, Math.round((hits / skillWords.length) * 100)) : 0;
          return { ...job, match_score: matchScore, match_reason: hits > 0 ? `Matches your primary skill: ${profile.primary_skill}` : "General sector match" };
        }).sort((a, b) => b.match_score - a.match_score);

        return new Response(JSON.stringify({ items: ranked, ranking_tier: "basic" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // PRO: ask Gemini to score the top jobs against the full profile.
      const jobList = jobs.slice(0, 12).map((j, i) => `${i}. ${j.title} ÔÇö ${j.payload_description.slice(0, 200)}`).join("\n");
      const prompt = `You are a job-matching engine. Score how well this candidate fits each job, 0-100.
CANDIDATE: Skill: ${profile.primary_skill}. Level: ${profile.exp_level}. Bio: ${profile.bio}

JOBS (numbered):
${jobList}

Return ONLY a strict JSON array, no markdown, no explanation: [{"index": 0, "score": 85, "reason": "short reason under 12 words"}, ...] for every job listed.`;

      const gemini = await callGemini(prompt);
      if (!gemini.ok) {
        console.error("Gemini job-ranking error:", JSON.stringify(gemini.raw).slice(0, 500));
        return new Response("AI ranking is temporarily unavailable. Showing unranked jobs.", { status: 502, headers: corsHeaders });
      }
      const scores = parseGeminiJson(gemini.text);
      if (!scores) return new Response("AI ranking returned an unreadable result.", { status: 502, headers: corsHeaders });

      const scoreMap = new Map(scores.map(s => [s.index, s]));
      const ranked = jobs.slice(0, 12).map((job, i) => ({
        ...job,
        match_score: scoreMap.get(i)?.score ?? 0,
        match_reason: scoreMap.get(i)?.reason ?? "",
      })).sort((a, b) => b.match_score - a.match_score);

      return new Response(JSON.stringify({ items: ranked, ranking_tier: "pro" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 6. POST /api/resume/score (Free: score + tips. Pro already has full
    // rewrite via /api/ai-resume ÔÇö this is the lighter, free-tier hook.)
    if (url.pathname === "/api/resume/score" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const profileRes = await supabase("profiles?select=bio,primary_skill,exp_level,education,current_tier");
      const profile = (await profileRes.json())[0];
      if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });
      if (!profile.bio || profile.bio.trim().length < 20) {
        return new Response("Add a bio of at least 20 characters in your profile first.", { status: 400, headers: corsHeaders });
      }

      const prompt = `You are a resume reviewer. Score this candidate's profile out of 100 on clarity, quantified impact, and keyword strength for their field.
SKILL: ${profile.primary_skill}
LEVEL: ${profile.exp_level}
EDUCATION: ${profile.education}
BIO: ${profile.bio}

Return ONLY strict JSON, no markdown: {"score": 72, "tips": ["tip one under 15 words", "tip two", "tip three"]}`;

      const gemini = await callGemini(prompt);
      if (!gemini.ok) {
        console.error("Gemini resume-score error:", JSON.stringify(gemini.raw).slice(0, 500));
        return new Response("AI resume scoring is temporarily unavailable. Please try again shortly.", { status: 502, headers: corsHeaders });
      }
      const result = parseGeminiJson(gemini.text);
      if (!result) return new Response("AI scoring returned an unreadable result. Please try again.", { status: 502, headers: corsHeaders });

      return new Response(JSON.stringify({
        score: result.score,
        tips: result.tips,
        full_rewrite_available: profile.current_tier === "paid",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 7. POST /api/interview/start (Free: 3 generic sector questions, no AI
    // cost. Pro: Gemini generates questions tailored to a specific pinned job.)
    if (url.pathname === "/api/interview/start" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const body = await request.json().catch(() => ({}));
      const { job_id } = body;

      const profileRes = await supabase("profiles?select=current_tier,sectors,primary_skill,exp_level");
      const profile = (await profileRes.json())[0];
      if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });

      const sector = profile.sectors?.[0] || "web";

      if (profile.current_tier !== "paid" || !job_id) {
        // FREE (or no job selected): generic stock questions, zero Gemini cost.
        const STOCK_QUESTIONS = {
          web: ["Walk me through how you'd debug a production issue you've never seen before.", "Tell me about a time you had to learn a new framework quickly.", "How do you decide between writing custom code and using a library?"],
          default: ["Tell me about a project you're proud of and why.", "Describe a time you disagreed with a teammate or client. How did you handle it?", "How do you prioritize when you have multiple deadlines at once?"],
        };
        const questions = STOCK_QUESTIONS[sector] || STOCK_QUESTIONS.default;

        const sessionRes = await supabase("interview_sessions", {
          method: "POST",
          headers: { "Prefer": "return=representation" },
          body: JSON.stringify({ user_id: userId, sector, tier_at_time: profile.current_tier, job_id: null }),
        });
        const session = (await sessionRes.json())[0];

        return new Response(JSON.stringify({ session_id: session?.id, questions, tier: "basic" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // PRO with a job selected: tailored questions from the job description.
      const jobRes = await supabase(`scraped_jobs?select=title,payload_description&id=eq.${job_id}`);
      const job = (await jobRes.json())[0];
      if (!job) return new Response("Job not found", { status: 404, headers: corsHeaders });

      const prompt = `Generate exactly 5 realistic interview questions for this specific role. Mix behavioral and technical.
JOB: ${job.title}
DESCRIPTION: ${job.payload_description}
CANDIDATE LEVEL: ${profile.exp_level}

Return ONLY a strict JSON array of 5 question strings, no markdown: ["question 1", "question 2", ...]`;

      const gemini = await callGemini(prompt);
      if (!gemini.ok) {
        console.error("Gemini interview-start error:", JSON.stringify(gemini.raw).slice(0, 500));
        return new Response("AI interview prep is temporarily unavailable. Please try again shortly.", { status: 502, headers: corsHeaders });
      }
      const questions = parseGeminiJson(gemini.text);
      if (!questions) return new Response("AI returned an unreadable question set. Please try again.", { status: 502, headers: corsHeaders });

      const sessionRes = await supabase("interview_sessions", {
        method: "POST",
        headers: { "Prefer": "return=representation" },
        body: JSON.stringify({ user_id: userId, sector, tier_at_time: profile.current_tier, job_id }),
      });
      const session = (await sessionRes.json())[0];

      return new Response(JSON.stringify({ session_id: session?.id, questions, tier: "pro" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 8. POST /api/interview/answer (Pro only ÔÇö scoring costs a Gemini call
    // per answer, so this stays behind the paywall even though /start is
    // partly free.)
    if (url.pathname === "/api/interview/answer" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const profileRes = await supabase("profiles?select=current_tier");
      const profile = (await profileRes.json())[0];
      if (!profile || profile.current_tier !== "paid") {
        return new Response("Pro feature only ÔÇö upgrade to get AI scoring on your interview answers.", { status: 403, headers: corsHeaders });
      }

      const { session_id, question, answer } = await request.json();
      if (!session_id || !question || !answer) return new Response("Missing session_id, question, or answer", { status: 400, headers: corsHeaders });

      const prompt = `Score this interview answer 0-100 and give one sentence of feedback.
QUESTION: ${question}
ANSWER: ${answer}

Return ONLY strict JSON, no markdown: {"score": 78, "feedback": "one sentence, under 25 words"}`;

      const gemini = await callGemini(prompt);
      if (!gemini.ok) {
        console.error("Gemini interview-answer error:", JSON.stringify(gemini.raw).slice(0, 500));
        return new Response("AI scoring is temporarily unavailable. Please try again shortly.", { status: 502, headers: corsHeaders });
      }
      const result = parseGeminiJson(gemini.text);
      if (!result) return new Response("AI scoring returned an unreadable result. Please try again.", { status: 502, headers: corsHeaders });

      await supabase("interview_answers", {
        method: "POST",
        body: JSON.stringify({ session_id, question, answer, score: result.score, feedback: result.feedback }),
      });

      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 9. GET /api/trends (Free for everyone ÔÇö reads from the shared
    // sector_trends cache table, which a separate daily cron populates.
    // No per-request Gemini cost.)
    if (url.pathname === "/api/trends" && method === "GET") {
      if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const sector = url.searchParams.get("sector") || "web";
      const res = await supabase(`sector_trends?select=*&sector=eq.${sector}`);
      const rows = await res.json();
      if (!rows[0]) {
        return new Response(JSON.stringify({ sector, trending_skills: [], recommended_certs: [], summary: "Trends for this sector haven't been generated yet." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(rows[0]), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (err) {
      // Top-level catch: always return CORS headers so the browser never sees
      // a network-level CORS block on a 500 error. Real errors are logged to
      // the Cloudflare Worker dashboard under "Logs".
      console.error("Unhandled worker error:", err?.message ?? err);
      return new Response(
        JSON.stringify({ error: "Internal server error", detail: err?.message ?? String(err) }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }
};
