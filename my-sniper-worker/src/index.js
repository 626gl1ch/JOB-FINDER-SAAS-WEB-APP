/**
 * SnipeJob Cloudflare Worker API
 * Zero-cost backend for job sniping and monetization.
 */

const COUNTRY_CODES = {
  "Nigeria": "NG", "Ghana": "GH", "Kenya": "KE", "South Africa": "ZA",
  "Ethiopia": "ET", "Tanzania": "TZ", "Uganda": "UG", "Rwanda": "RW",
  "Cameroon": "CM", "Ivory Coast": "CI", "Senegal": "SN", "Zambia": "ZM",
  "Zimbabwe": "ZW", "Mozambique": "MZ", "Angola": "AO", "Mali": "ML",
  "India": "IN", "Pakistan": "PK", "Bangladesh": "BD", "Philippines": "PH",
  "Indonesia": "ID", "Vietnam": "VN", "Thailand": "TH", "Malaysia": "MY",
  "Sri Lanka": "LK", "Nepal": "NP", "Myanmar": "MM",
  "United Kingdom": "GB", "United States": "US", "Canada": "CA",
  "Australia": "AU", "Germany": "DE", "France": "FR", "Italy": "IT",
  "Spain": "ES", "Netherlands": "NL", "Sweden": "SE", "Norway": "NO",
  "Denmark": "DK", "Poland": "PL", "Portugal": "PT", "Belgium": "BE",
  "Switzerland": "CH", "Austria": "AT", "Ireland": "IE",
  "Brazil": "BR", "Mexico": "MX", "Argentina": "AR", "Colombia": "CO",
  "Chile": "CL", "Peru": "PE", "Venezuela": "VE",
  "Saudi Arabia": "SA", "UAE": "AE", "Egypt": "EG", "Morocco": "MA",
  "Turkey": "TR", "Israel": "IL", "Jordan": "JO",
  "China": "CN", "Japan": "JP", "South Korea": "KR", "Singapore": "SG",
  "Hong Kong": "HK", "Taiwan": "TW", "New Zealand": "NZ",
};

export default {
  async fetch(request, env) {
    // CORS headers are defined first so the top-level catch can always send them,
    // even when an unhandled exception occurs before they would otherwise be set.
    const origin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY || !env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "Worker misconfigured: missing environment variables" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    try {
    const url = new URL(request.url);
    const method = request.method;

    // Canonical base URL of the deployed app (the SPA in index.html). Used to
    // build Stripe success/cancel redirect targets that work no matter what
    // domain the REQUEST came from — critical for the sales-funnel flow below,
    // where the request originates from a completely different site than the
    // app itself, so request Origin/Referer can't be trusted to point back at
    // the app. Override via the APP_BASE_URL secret/var if the app moves to a
    // custom domain later (e.g. https://snipejob.app) — no code change needed.
    const APP_BASE_URL = (env.APP_BASE_URL || "https://626gl1ch.github.io/JOB-FINDER-SAAS-WEB-APP").replace(/\/$/, "");

    // Subscription plan catalogue. "annual" is the $90/yr founding-rate plan
    // sold from the sales funnel; "monthly" is the existing $9/mo in-app plan.
    // Both map to their own Paystack plan code (configured as Worker secrets).
    const PLAN_CONFIG = {
      monthly: { planEnv: "PAYSTACK_PRO_PLAN_CODE", label: "monthly", amount: 900 },   // ₦900 or $9 in base currency
      annual:  { planEnv: "PAYSTACK_PRO_ANNUAL_PLAN_CODE", label: "annual",  amount: 9000 },  // ₦9000 or $90
    };
    const getPlanExpiry = (plan) => {
      const expiry = new Date();
      if (plan === "annual") expiry.setFullYear(expiry.getFullYear() + 1);
      else expiry.setMonth(expiry.getMonth() + 1);
      return expiry;
    };

    const authHeader = request.headers.get("Authorization");
    const userToken = authHeader ? authHeader.split(" ")[1] : null;

    // Decode the JWT payload to get the real Supabase user UUID (the "sub" claim).
    // We do NOT verify the signature here — Supabase still does that on every
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
        userId = null; // malformed token — requests needing userId will 401 below
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

    // Shared Gemini text-generation helper — used by ai-apply, ai-resume,
    // job ranking, resume scoring, interview prep, and signup autofill.
    // Accepts either a plain text prompt (string) or a multimodal parts
    // array (for PDF input — see /api/profile/autofill).
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
    // FIX (2026-06-27): this previously only checked `!!env.SUPABASE_URL`,
    // which reports "true" even if the secret holds garbage (exactly what
    // happened: SUPABASE_URL was a single stray control character, which is
    // still a truthy string). Now it also checks the value actually parses
    // as an https:// URL pointing at a *.supabase.co host, so a corrupted
    // secret shows up here instead of only surfacing as a confusing
    // "Invalid URL" 500 on every other route.
    if (url.pathname === "/debug/env" && method === "GET") {
        let supabaseUrlLooksValid = false;
        try {
          const parsed = new URL(env.SUPABASE_URL);
          supabaseUrlLooksValid = parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
        } catch (_) {
          supabaseUrlLooksValid = false;
        }
        return new Response(JSON.stringify({
            hasSupabaseUrl: !!env.SUPABASE_URL,
            supabaseUrlLooksValid,
            hasSupabaseAnonKey: !!env.SUPABASE_ANON_KEY,
            hasSupabaseServiceRoleKey: !!env.SUPABASE_SERVICE_ROLE_KEY,
            hasGeminiApiKey: !!env.GEMINI_API_KEY,
            hasPaystackSecretKey: !!env.PAYSTACK_SECRET_KEY,
            hasPaystackProPlanCode: !!env.PAYSTACK_PRO_PLAN_CODE,
            hasPaystackProAnnualPlanCode: !!env.PAYSTACK_PRO_ANNUAL_PLAN_CODE,
            hasPaystackWebhookSecret: !!env.PAYSTACK_WEBHOOK_SECRET,
            hasPostbackSecret: !!env.POSTBACK_SECRET,
            hasResendApiKey: !!env.RESEND_API_KEY,
            hasWorkerInternalSecret: !!env.WORKER_INTERNAL_SECRET,
            appBaseUrl: APP_BASE_URL,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 0c. POST /api/profile/autofill (Signup-time resume scan — runs BEFORE
    // the account exists, so this is intentionally unauthenticated. Accepts
    // either resume_text (pasted) or file_base64 (PDF upload, sent straight
    // to Gemini's multimodal input — no separate PDF parsing library needed).
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

      const instruction = `Extract the following from this resume/bio. Be conservative — if something isn't clearly stated, leave it as an empty string rather than guessing.
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

    // 0b. GET /api/profile (merged in from my-sniper-worker — that copy is now retired)
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
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      // Get user profile to check tier and sectors (scoped to logged-in user)
      const profileRes = await supabase(`profiles?select=current_tier,sectors&id=eq.${userId}`);
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
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const { job_id } = await request.json();
      if (!job_id) return new Response("Missing job_id", { status: 400, headers: corsHeaders });

      // Check if user is Pro (scoped to logged-in user)
      // FIX (audit pass): this used to select a `payload_resume` column that
      // does not exist anywhere in schema.sql, which made PostgREST error on
      // every call — AI Apply was broken for every user, including paying
      // Pro users. Now selects the same real profile fields /api/ai-resume
      // already uses successfully.
      const profileRes = await supabase(`profiles?select=current_tier,full_name,exp_level,primary_skill,bio,education&id=eq.${userId}`);
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
        headers: { "Content-Type": "application/json" }, // was missing — required by the Gemini API
        body: JSON.stringify({
          contents: [{
            parts: [{
                text: `You are an expert freelance proposal writer. Write a customized, professional, and persuasive job proposal for the following job:
                JOB TITLE: ${job.title}
                JOB DESCRIPTION: ${job.payload_description}

                APPLICANT PROFILE:
                Name: ${profile.full_name || "the applicant"}
                Experience level: ${profile.exp_level || "mid"}
                Top skill: ${profile.primary_skill || ""}
                Bio: ${profile.bio || ""}
                Education: ${profile.education || ""}

                Keep the tone confident but helpful. Do not use placeholders like [Your Name] — use the applicant profile above. Return only the proposal text.`
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
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const { job_id } = await request.json();
      if (!job_id) return new Response("Missing job_id", { status: 400, headers: corsHeaders });

      // 1. Get user profile (scoped to logged-in user)
      const profileRes = await supabase(`profiles?select=full_name,sectors,exp_level,primary_skill,bio,education,current_tier&id=eq.${userId}`);
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
        headers: { "Content-Type": "application/json" }, // was missing — required by the Gemini API
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

    // --- NEW: AI RESUME BUILDER ENDPOINTS ---
    if (url.pathname === "/api/resume/generate" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const { source, resume_text, manual_data } = await request.json().catch(() => ({}));
      
      let userInfoText = "";
      if (source === "upload") {
        userInfoText = `Raw Uploaded Resume Content:\n${resume_text}`;
      } else if (source === "manual") {
        userInfoText = `Manual Onboarding Profile Info:\nName: ${manual_data?.full_name}\nLevel: ${manual_data?.exp_level}\nSkill: ${manual_data?.primary_skill}\nBio: ${manual_data?.bio}\nEducation: ${manual_data?.education}`;
      } else { // profile
        const profileRes = await supabase(`profiles?select=full_name,sectors,exp_level,primary_skill,bio,education&id=eq.${userId}`);
        const profile = (await profileRes.json())[0];
        if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });
        userInfoText = `Existing User Profile:\nName: ${profile.full_name}\nLevel: ${profile.exp_level}\nSkill: ${profile.primary_skill}\nBio: ${profile.bio}\nEducation: ${profile.education}`;
      }

      const prompt = `You are a professional resume writer. Build a polished, complete, and modern resume using the following user details:
      
      ${userInfoText}
      
      Structure the output as a clean, ready-to-use text resume with standard sections: Contact Info, Professional Summary, Work Experience (elaborate professionally based on bio/profile if needed), Skills, and Education. Focus on strong impact verbs and clear layout. Return ONLY the formatted resume text.`;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      const geminiData = await geminiRes.json();
      const resumeText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!geminiRes.ok || !resumeText) {
        return new Response("AI Resume generation failed.", { status: 502, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ resume: resumeText }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    if (url.pathname === "/api/resume/analyze-ats" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const { resume_text } = await request.json().catch(() => ({}));
      if (!resume_text) return new Response("Missing resume_text", { status: 400, headers: corsHeaders });

      const prompt = `Analyze the following resume for ATS (Applicant Tracking System) compatibility, formatting quality, keyword relevance, and content effectiveness.
      RESUME:
      ${resume_text}
      
      Return a valid JSON object with the following keys. Do not wrap it in markdown formatting (like \`\`\`json):
      {
        "ats_score": number (0-100),
        "formatting_score": number (0-100),
        "keyword_score": number (0-100),
        "content_score": number (0-100),
        "compatibility_feedback": ["list of strings"],
        "formatting_feedback": ["list of strings"],
        "keyword_feedback": ["list of strings"],
        "content_feedback": ["list of strings"]
      }`;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      const geminiData = await geminiRes.json();
      let text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      // Strip markdown code fences if present
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();

      return new Response(text, { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    if (url.pathname === "/api/resume/optimize" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const { resume_text } = await request.json().catch(() => ({}));
      if (!resume_text) return new Response("Missing resume_text", { status: 400, headers: corsHeaders });

      const prompt = `Recommend specific optimizations for the following resume. Recommends:
      1. An improved professional summary.
      2. Better bullet points for experience.
      3. Better achievements metrics suggestions.
      4. Stronger overall positioning.
      
      RESUME:
      ${resume_text}
      
      Return a valid JSON object with the following keys. Do not wrap it in markdown formatting:
      {
        "improved_summary": "string",
        "better_bullet_points": ["string"],
        "better_achievements": ["string"],
        "positioning_suggestions": ["string"]
      }`;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      const geminiData = await geminiRes.json();
      let text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();

      return new Response(text, { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    if (url.pathname === "/api/resume/tailor" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const { resume_text, job_description } = await request.json().catch(() => ({}));
      if (!resume_text || !job_description) return new Response("Missing parameters", { status: 400, headers: corsHeaders });

      const prompt = `Compare the following resume against the job description opportunity.
      RESUME:
      ${resume_text}
      
      JOB DESCRIPTION:
      ${job_description}
      
      Identify missing requirements, suggest improvements, and generate a tailored optimized version of the resume.
      Return a valid JSON object with the following keys. Do not wrap it in markdown formatting:
      {
        "comparison_match": number,
        "missing_requirements": ["string"],
        "suggested_improvements": ["string"],
        "tailored_resume": "complete plain text resume string"
      }`;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      const geminiData = await geminiRes.json();
      let text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();

      return new Response(text, { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // 3a. POST /api/payment/create-checkout (Paystack — logged-in user upgrading from inside the app)
    // Initializes a Paystack transaction with the user's email and the selected plan code.
    // Returns { authorization_url } which the frontend redirects to.
    if (url.pathname === "/api/payment/create-checkout" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const body = await request.json().catch(() => ({}));
      const plan = PLAN_CONFIG[body.plan] ? body.plan : "monthly";
      const planCode = env[PLAN_CONFIG[plan].planEnv];

      if (!env.PAYSTACK_SECRET_KEY || !planCode) {
        return new Response(JSON.stringify({ error: "Payment not configured" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Fetch user email from profiles
      const profileRes = await supabase(`profiles?select=email&id=eq.${userId}`);
      const profile = (await profileRes.json())[0];
      if (!profile?.email) {
        return new Response(JSON.stringify({ error: "Profile email not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const callbackUrl = `${APP_BASE_URL}/index.html?payment=success`;

      const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: profile.email,
          amount: PLAN_CONFIG[plan].amount * 100, // kobo/cents (amount * 100)
          plan: planCode,
          callback_url: callbackUrl,
          metadata: { user_id: userId, plan, source: "app" },
        }),
      });

      const paystackData = await paystackRes.json();
      if (!paystackRes.ok || !paystackData.data?.authorization_url) {
        console.error("Paystack checkout error:", JSON.stringify(paystackData).slice(0, 500));
        return new Response(
          JSON.stringify({ error: paystackData.message || "Could not create checkout session" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ url: paystackData.data.authorization_url, reference: paystackData.data.reference }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3a-pub. POST /api/payment/create-checkout-public (Paystack — sales funnel, no auth)
    // Requires email in the request body since there's no account yet.
    if (url.pathname === "/api/payment/create-checkout-public" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const plan = PLAN_CONFIG[body.plan] ? body.plan : null;
      if (!plan) {
        return new Response(JSON.stringify({ error: "Invalid plan — expected 'monthly' or 'annual'." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const email = (body.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return new Response(JSON.stringify({ error: "A valid email address is required to start checkout." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const planCode = env[PLAN_CONFIG[plan].planEnv];
      if (!env.PAYSTACK_SECRET_KEY || !planCode) {
        return new Response(JSON.stringify({ error: "Payment not configured" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let cancelUrl = `${APP_BASE_URL}/index.html`;
      if (typeof body.cancel_url === "string" && /^https?:\/\//i.test(body.cancel_url)) {
        cancelUrl = body.cancel_url;
      }

      const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: PLAN_CONFIG[plan].amount * 100,
          plan: planCode,
          callback_url: `${APP_BASE_URL}/index.html?premium_signup=1`,
          metadata: { plan, source: "sales_funnel", cancel_url: cancelUrl },
        }),
      });

      const paystackData = await paystackRes.json();
      if (!paystackRes.ok || !paystackData.data?.authorization_url) {
        console.error("Paystack public checkout error:", JSON.stringify(paystackData).slice(0, 500));
        return new Response(
          JSON.stringify({ error: paystackData.message || "Could not create checkout session" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ url: paystackData.data.authorization_url, reference: paystackData.data.reference }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3a-verify. GET /api/payment/verify-session (Paystack — public, used after funnel redirect)
    // Verifies a Paystack transaction reference; returns { paid, plan, email, already_registered }
    if (url.pathname === "/api/payment/verify-session" && method === "GET") {
      const reference = url.searchParams.get("reference");
      if (!reference || !env.PAYSTACK_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Missing reference" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { "Authorization": `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      });
      const paystackData = await paystackRes.json();
      if (!paystackRes.ok || !paystackData.data) {
        return new Response(JSON.stringify({ error: "Transaction not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const txn = paystackData.data;
      const paid = txn.status === "success";
      const plan = txn.metadata?.plan === "annual" ? "annual" : "monthly";
      const email = (txn.customer?.email || "").toLowerCase();

      let alreadyRegistered = false;
      if (email) {
        const existing = await supabase(`profiles?select=id&email=ilike.${encodeURIComponent(email)}`, {
          headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
        });
        const rows = await existing.json().catch(() => []);
        alreadyRegistered = Array.isArray(rows) && rows.length > 0;
      }

      return new Response(JSON.stringify({ paid, plan, email, already_registered: alreadyRegistered }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3a-claim. POST /api/payment/claim-premium (Paystack — authenticated, attaches a paid reference to an account)
    // Re-verifies payment server-side against Paystack. Guards against double-claiming.
    if (url.pathname === "/api/payment/claim-premium" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const body = await request.json().catch(() => ({}));
      // Accept both 'reference' (new) and 'session_id' (legacy frontend fallback)
      const reference = body.reference || body.session_id;
      if (!reference || !env.PAYSTACK_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Missing reference" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { "Authorization": `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      });
      const paystackData = await paystackRes.json();
      if (!paystackRes.ok || paystackData.data?.status !== "success") {
        return new Response(JSON.stringify({ error: "This payment has not been completed." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const txn = paystackData.data;
      const txnEmail = (txn.customer?.email || "").toLowerCase();

      // Verify the account email matches the payment email
      const myProfileRes = await supabase(`profiles?select=email&id=eq.${userId}`);
      const myProfile = (await myProfileRes.json())[0];
      if (!myProfile || myProfile.email.toLowerCase() !== txnEmail) {
        return new Response(JSON.stringify({ error: "This payment was made with a different email address than your account." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Atomically claim the reference — insert-if-absent, then verify ownership
      await supabase("claimed_paystack_sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer": "resolution=ignore-duplicates",
        },
        body: JSON.stringify({ reference, user_id: userId }),
      });
      const claimCheck = await supabase(`claimed_paystack_sessions?select=user_id&reference=eq.${encodeURIComponent(reference)}`, {
        headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
      });
      const claimRow = (await claimCheck.json().catch(() => []))[0];
      if (claimRow && claimRow.user_id !== userId) {
        return new Response(JSON.stringify({ error: "This payment has already been used to activate a different account." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const plan = txn.metadata?.plan === "annual" ? "annual" : "monthly";
      const expiry = getPlanExpiry(plan);

      await supabase(`profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          current_tier: "paid",
          plan_type: plan,
          subscription_expiry: expiry.toISOString(),
          paystack_customer_code: txn.customer?.customer_code || null,
          paystack_subscription_code: txn.plan_object?.subscription_code || null,
          signup_source: txn.metadata?.source === "sales_funnel" ? "sales_funnel" : "app",
        }),
      });

      return new Response(JSON.stringify({ success: true, plan, current_tier: "paid" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3a2. GET /api/payment/status (Paystack — authenticated, called after redirect back from Paystack)
    // Verifies the reference and eagerly upgrades the profile without waiting for the webhook.
    if (url.pathname === "/api/payment/status" && method === "GET") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const reference = url.searchParams.get("reference");
      if (!reference || !env.PAYSTACK_SECRET_KEY) {
        return new Response(JSON.stringify({ active: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { "Authorization": `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      });
      const paystackData = await paystackRes.json();
      const txn = paystackData.data;

      if (paystackRes.ok && txn?.status === "success") {
        const txnEmail = (txn.customer?.email || "").toLowerCase();
        // Confirm this reference belongs to the calling user
        const myProfileRes = await supabase(`profiles?select=email&id=eq.${userId}`);
        const myProfile = (await myProfileRes.json())[0];
        if (myProfile && myProfile.email.toLowerCase() === txnEmail) {
          const plan = txn.metadata?.plan === "annual" ? "annual" : "monthly";
          const expiry = getPlanExpiry(plan);
          await supabase(`profiles?id=eq.${userId}`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              current_tier: "paid",
              plan_type: plan,
              subscription_expiry: expiry.toISOString(),
              paystack_customer_code: txn.customer?.customer_code || null,
            }),
          });
          return new Response(JSON.stringify({ active: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      return new Response(JSON.stringify({ active: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3b. POST /api/payment/webhook (Paystack Webhook — SHA-512 HMAC verified)
    // Paystack sends X-Paystack-Signature header with HMAC-SHA512 of raw body.
    // Events handled: charge.success, subscription.create, subscription.disable
    if (url.pathname === "/api/payment/webhook" && method === "POST") {
      const rawBody = await request.text();
      const paystackSignature = request.headers.get("x-paystack-signature");

      if (env.PAYSTACK_WEBHOOK_SECRET && paystackSignature) {
        try {
          const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(env.PAYSTACK_WEBHOOK_SECRET),
            { name: "HMAC", hash: "SHA-512" },
            false,
            ["sign"]
          );
          const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
          const computedHash = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

          if (computedHash !== paystackSignature) {
            return new Response("Webhook signature mismatch", { status: 400, headers: corsHeaders });
          }
        } catch (sigErr) {
          console.error("Paystack signature check failed:", sigErr.message);
          return new Response("Webhook signature error", { status: 400, headers: corsHeaders });
        }
      }

      let event;
      try { event = JSON.parse(rawBody); } catch (_) {
        return new Response("Invalid JSON body", { status: 400, headers: corsHeaders });
      }

      const eventType = event.event;
      const data = event.data;

      // charge.success — fires when a one-time charge or subscription first payment succeeds
      if (eventType === "charge.success") {
        const txnEmail = (data.customer?.email || "").toLowerCase();
        const meta = data.metadata || {};
        const targetUserId = meta.user_id || null;
        const plan = meta.plan === "annual" ? "annual" : "monthly";
        const expiry = getPlanExpiry(plan);

        if (targetUserId) {
          // In-app checkout: user_id is in metadata
          await supabase(`profiles?id=eq.${targetUserId}`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              current_tier: "paid",
              plan_type: plan,
              subscription_expiry: expiry.toISOString(),
              paystack_customer_code: data.customer?.customer_code || null,
              signup_source: meta.source === "sales_funnel" ? "sales_funnel" : "app",
            }),
          });
        } else if (txnEmail) {
          // Sales-funnel checkout: look up by email
          const profileSearch = await supabase(`profiles?select=id&email=ilike.${encodeURIComponent(txnEmail)}`, {
            headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
          });
          const found = (await profileSearch.json().catch(() => []))[0];
          if (found) {
            await supabase(`profiles?id=eq.${found.id}`, {
              method: "PATCH",
              headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({
                current_tier: "paid",
                plan_type: plan,
                subscription_expiry: expiry.toISOString(),
                paystack_customer_code: data.customer?.customer_code || null,
                signup_source: "sales_funnel",
              }),
            });
          }
        }
      }

      // subscription.create — Paystack subscription successfully activated
      if (eventType === "subscription.create") {
        const customerCode = data.customer?.customer_code;
        const subscriptionCode = data.subscription_code;
        if (customerCode) {
          const profileSearch = await supabase(`profiles?select=id,plan_type&paystack_customer_code=eq.${encodeURIComponent(customerCode)}`, {
            headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
          });
          const found = (await profileSearch.json().catch(() => []))[0];
          if (found) {
            await supabase(`profiles?id=eq.${found.id}`, {
              method: "PATCH",
              headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ paystack_subscription_code: subscriptionCode }),
            });
          }
        }
      }

      // subscription.disable — subscription cancelled, downgrade to free
      if (eventType === "subscription.disable") {
        const customerCode = data.customer?.customer_code;
        if (customerCode) {
          const profileSearch = await supabase(`profiles?select=id&paystack_customer_code=eq.${encodeURIComponent(customerCode)}`, {
            headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
          });
          const found = (await profileSearch.json().catch(() => []))[0];
          if (found) {
            await supabase(`profiles?id=eq.${found.id}`, {
              method: "PATCH",
              headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ current_tier: "free", subscription_expiry: null }),
            });
          }
        }
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
        headers: { "Content-Type": "application/json" }, // was missing — required by the Gemini API
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
        // e.g. Gemini safety block, quota exceeded, or invalid key —
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
          country: edgeCountry,
        }),
      });

      return new Response(JSON.stringify(aiResult), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4b. GET /api/offers (Live Side Task offer feed — fetches from your
    // affiliate network and tags every offer link with this user's UUID as
    // subid, so postbacks can be matched back to the right wallet. Swap the
    // OFFER_FEED_URL and field names below for whichever network you join —
    // see HOSTING.md "Affiliate Revenue" section for the macro reference.)
    if (url.pathname === "/api/offers" && method === "GET") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const profileRes = await supabase(`profiles?select=current_tier,country&id=eq.${userId}`);
      const profile = (await profileRes.json())[0];
      if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });

      // Side Tasks are Pro-only — gate here so free users see the upgrade wall
      if (profile.current_tier !== "paid") {
        return new Response(JSON.stringify({ items: [], configured: false, pro_required: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!env.OFFER_FEED_URL || !env.OFFER_FEED_API_KEY) {
        // No network connected yet — return an empty list rather than erroring,
        // so the dashboard shows "no tasks available" instead of breaking.
        return new Response(JSON.stringify({ items: [], configured: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Country resolution: prefer the user's profile country (mapped to its
      // ISO code), then fall back to Cloudflare's edge-detected CF-IPCountry
      // header, which already arrives as a 2-letter code.
      const rawCountry = profile.country || request.headers.get("CF-IPCountry") || "";
      const userCountryCode = COUNTRY_CODES[rawCountry] || (rawCountry.length === 2 ? rawCountry.toUpperCase() : null);

      if (!userCountryCode) {
        // Country not set or unrecognised — return empty rather than showing
        // offers from the wrong country. User should update their profile.
        return new Response(JSON.stringify({
          items: [],
          configured: true,
          country_missing: true,
          message: "Update your profile country to see available tasks.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      try {
        // Pass the ISO code to CPALead so the network pre-filters on their
        // end, then double-filter below to catch any stragglers some
        // networks include (multi-country offers listing every country
        // they accept) — only exact-country or worldwide offers get through.
        const feedRes = await fetch(`${env.OFFER_FEED_URL}?api_key=${env.OFFER_FEED_API_KEY}&country=${userCountryCode}&format=json`);
        if (!feedRes.ok) throw new Error(`Feed returned ${feedRes.status}`);

        const feedData = await feedRes.json();
        const rawOffers = Array.isArray(feedData) ? feedData : (feedData.offers || feedData.data || []);

        const offers = rawOffers
          .filter(o => {
            const offerCountry = (o.country || o.countries || o.geo || "").toUpperCase();
            return !offerCountry ||
                   offerCountry === userCountryCode ||
                   offerCountry === "WW" ||
                   offerCountry === "WORLDWIDE" ||
                   offerCountry.includes(userCountryCode);
          })
          .slice(0, 15)
          .map(o => {
            const rawPayout = parseFloat(o.payout || o.amount || o.revenue || 0);
            return {
              id: o.offer_id || o.id,
              title: o.title || o.name,
              description: o.description || o.short_description || "",
              user_cut: +(rawPayout * 0.5).toFixed(2),
              // userId embedded here is what comes back as {subid} on the postback
              link: `${o.link || o.url}${(o.link || o.url || '').includes('?') ? '&' : '?'}subid=${userId}`,
              country: userCountryCode,
              category: o.category || o.vertical || "general",
            };
          });

        return new Response(JSON.stringify({ items: offers, configured: true, user_country: userCountryCode }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        console.error("Offer feed fetch error:", e.message);
        return new Response("Could not load tasks right now. Please try again shortly.", { status: 502, headers: corsHeaders });
      }
    }

    // 4c. GET /api/earnings (Recent affiliate credit history, for the
    // "Recent earnings" panel — reads from affiliate_logs which
    // process_affiliate_credit already writes to on every postback.)
    if (url.pathname === "/api/earnings" && method === "GET") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const res = await supabase(`affiliate_logs?select=user_credited_amount,incoming_network_provider,processing_timestamp&user_id=eq.${userId}&order=processing_timestamp.desc&limit=10`);
      const rows = await res.json();
      return new Response(JSON.stringify({ items: rows }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. GET / POST /api/postback (Durable Affiliate Track & Fraud Firewall)
    if (url.pathname === "/api/postback" && (method === "GET" || method === "POST")) {
      const secret = url.searchParams.get("secret");
      if (!env.POSTBACK_SECRET || secret !== env.POSTBACK_SECRET) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }

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

      // Map profile country and incoming country to ISO 2-letter codes
      const profileCountryCode = profile.country ? (COUNTRY_CODES[profile.country] || (profile.country.length === 2 ? profile.country.toUpperCase() : null)) : null;
      const incomingCountryCode = country ? (COUNTRY_CODES[country] || (country.length === 2 ? country.toUpperCase() : null)) : null;

      if (!profileCountryCode || !incomingCountryCode || (profileCountryCode !== incomingCountryCode && (profile.country || "").toLowerCase() !== (country || "").toLowerCase())) {
        // VPN Violation
        if (profile) {
            await supabase(`profiles?id=eq.${subid}`, {
                method: "PATCH",
                body: JSON.stringify({ vpn_violation_count: profile.vpn_violation_count + 1 })
            });
        }
        return new Response("Fraud detected", { status: 403, headers: corsHeaders });
      }

      const userCut = payout * 0.5;
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
    // landing page's "available to everyone" promise — fixed to match.)
    if (url.pathname === "/api/withdraw" && method === "POST") {
       if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

       const body = await request.json();
       const { amount, channel, address } = body;

       if (!amount || amount < 2) return new Response("Minimum $2", { status: 400, headers: corsHeaders });

       // Read tier only, to compute the payout schedule shown back to the
       // user — NOT used for the actual balance check below, so a stale
       // read here can't cause a bad deduction.
       const profileRes = await supabase(`profiles?select=current_tier&id=eq.${userId}`);
       const profile = (await profileRes.json())[0];
       if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });

       const isPro = profile.current_tier === "paid";

       // Free tier: next 1st-of-month at least 3 days out (so a withdrawal
       // requested on the 30th doesn't get an unrealistic next-day date).
       // Pro tier: no scheduled date — processed immediately by your payout flow.
       let scheduledDate = null;
       if (!isPro) {
         const now = new Date();
         let target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
         const daysUntil = (target - now) / 86400000;
         if (daysUntil < 3) target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
         scheduledDate = target.toISOString().slice(0, 10);
       }

       // FIX (audit pass): this used to be a manual read-balance-then-PATCH,
       // which is a check-then-write race condition — two withdrawals fired
       // close together could both read the same balance, both pass the
       // check, and both deduct, pushing wallet_balance negative. Now calls
       // the atomic process_withdrawal_v2() Postgres function (schema.sql),
       // which does the balance check and the deduction in a single UPDATE
       // ... WHERE wallet_balance >= amount statement, so a second concurrent
       // call simply can't succeed once the balance is gone. Note this uses
       // the *_v2 function (works for free + Pro); the original
       // process_withdrawal() still exists but is Pro-only and unused here.
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
         const errText = await rpcRes.text();
         if (errText.includes("Insufficient balance")) {
           return new Response("Insufficient balance", { status: 400, headers: corsHeaders });
         }
         console.error("process_withdrawal_v2 error:", errText.slice(0, 500));
         return new Response("Withdrawal failed. Please try again.", { status: 500, headers: corsHeaders });
       }

       return new Response(JSON.stringify({
         success: true,
         payout_timing: isPro ? "immediate" : "monthly_batch",
         scheduled_payout_date: scheduledDate,
       }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. GET /api/jobs/ranked (AI Job Ranking — free tier gets a fast local
    // keyword score, Pro gets Gemini's full-fit analysis. Free has no
    // Gemini cost; only Pro calls the model.)
    if (url.pathname === "/api/jobs/ranked" && method === "GET") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const profileRes = await supabase(`profiles?select=current_tier,sectors,primary_skill,bio,exp_level&id=eq.${userId}`);
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
      const jobList = jobs.slice(0, 12).map((j, i) => `${i}. ${j.title} — ${j.payload_description.slice(0, 200)}`).join("\n");
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
    // rewrite via /api/ai-resume — this is the lighter, free-tier hook.)
    // Accepts optional { resume_text } body param. If not provided, falls back
    // to the user's saved profile bio. This allows both:
    //   a) Career Prep tab "Score my resume" with pasted text
    //   b) Scoring based on saved profile (empty body / no paste)
    if (url.pathname === "/api/resume/score" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const reqBody = await request.json().catch(() => ({}));
      const providedResumeText = (reqBody.resume_text || '').trim();

      const profileRes = await supabase(`profiles?select=bio,primary_skill,exp_level,education,current_tier&id=eq.${userId}`);
      const profile = (await profileRes.json())[0];
      if (!profile) return new Response("Profile not found", { status: 404, headers: corsHeaders });

      // Determine what to score: pasted text > profile bio
      const scoreText = providedResumeText || profile.bio || '';
      if (scoreText.trim().length < 20) {
        return new Response("Paste a resume or add a bio of at least 20 characters in your profile first.", { status: 400, headers: corsHeaders });
      }

      const prompt = providedResumeText
        ? `You are a professional resume reviewer. Score this resume out of 100 on clarity, quantified impact, and keyword strength.

RESUME:
${scoreText}

Return ONLY strict JSON, no markdown: {"score": 72, "tips": ["tip one under 15 words", "tip two", "tip three"]}`
        : `You are a resume reviewer. Score this candidate's profile out of 100 on clarity, quantified impact, and keyword strength for their field.
SKILL: ${profile.primary_skill}
LEVEL: ${profile.exp_level}
EDUCATION: ${profile.education}
BIO: ${scoreText}

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

      const profileRes = await supabase(`profiles?select=current_tier,sectors,primary_skill,exp_level&id=eq.${userId}`);
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

    // 8. POST /api/interview/answer (Pro only — scoring costs a Gemini call
    // per answer, so this stays behind the paywall even though /start is
    // partly free.)
    if (url.pathname === "/api/interview/answer" && method === "POST") {
      if (!userToken || !userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const profileRes = await supabase(`profiles?select=current_tier&id=eq.${userId}`);
      const profile = (await profileRes.json())[0];
      if (!profile || profile.current_tier !== "paid") {
        return new Response("Pro feature only — upgrade to get AI scoring on your interview answers.", { status: 403, headers: corsHeaders });
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

    // 9. GET /api/trends (Free for everyone — reads from the shared
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

    // ─── INTERNAL: subscription expiry email (called by Supabase pg_cron) ────
    // Protected by X-Internal-Secret header. NOT a public endpoint.
    if (url.pathname === "/api/internal/send-expiry-email" && method === "POST") {
      const secret = request.headers.get("X-Internal-Secret");
      if (!env.WORKER_INTERNAL_SECRET || secret !== env.WORKER_INTERNAL_SECRET) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }

      if (!env.RESEND_API_KEY) {
        console.warn("RESEND_API_KEY not set — expiry email not sent");
        return new Response(JSON.stringify({ sent: false, reason: "RESEND_API_KEY not configured" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const body = await request.json().catch(() => ({}));
      const { email, full_name, expiry_date, plan_type } = body;
      if (!email) return new Response("Missing email", { status: 400, headers: corsHeaders });

      const expiryFormatted = new Date(expiry_date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const planLabel = plan_type === "annual" ? "Annual" : "Monthly";
      const renewalUrl = `${APP_BASE_URL}/index.html#upgrade`;

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "SnipeJob <noreply@snipejob.app>",
          to: [email],
          subject: `Your SnipeJob Pro ${planLabel} access expires in 3 days`,
          html: `<!DOCTYPE html><html><body style="background:#1C1C1E;color:#F2F2F7;font-family:Arial,sans-serif;margin:0;padding:40px 20px"><div style="max-width:480px;margin:0 auto"><div style="font-weight:900;font-size:22px;background:linear-gradient(135deg,#7C5CFC,#00D4FF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:24px">SnipeJob</div><h1 style="font-size:20px;margin:0 0 12px">Your Pro access expires on ${expiryFormatted}</h1><p style="color:#AEAEB2;font-size:14px;line-height:1.6;margin:0 0 24px">Hi ${full_name || "there"},<br><br>Your SnipeJob Pro ${planLabel} plan expires on <strong>${expiryFormatted}</strong>. After that your account moves to the free tier and you'll lose access to AI proposals, one-click apply, Side Task earnings, and interview prep.</p><a href="${renewalUrl}" style="display:inline-block;background:linear-gradient(135deg,#7C5CFC,#00D4FF);color:#0d0d12;font-weight:700;font-size:15px;text-decoration:none;border-radius:999px;padding:14px 28px;margin-bottom:24px">Renew my Pro access →</a><p style="color:#6B6B70;font-size:12px;line-height:1.6">If you've already renewed or cancelled intentionally, you can ignore this. Questions? Reply to this email.</p></div></body></html>`,
        }),
      });

      if (!emailRes.ok) {
        const errText = await emailRes.text().catch(() => "");
        console.error("Resend email error:", errText.slice(0, 300));
        return new Response(JSON.stringify({ sent: false, error: errText }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ sent: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
