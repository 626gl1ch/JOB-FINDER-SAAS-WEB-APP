/**
 * SnipeJob Cloudflare Worker API
 * Hardened backend for job sniping and monetization.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // Security Headers
    const securityHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Content-Type": "application/json",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: securityHeaders });
    }

    // --- SECURITY UTILS ---
    const getUserId = (token) => {
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64)).sub;
      } catch {
        return null;
      }
    };

    const requireAuth = (request) => {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
      const token = authHeader.split(" ")[1];
      const userId = getUserId(token);
      return userId ? { userId, token } : null;
    };

    // Helper for Supabase requests - scoped
    const supabase = async (path, options = {}, token = null) => {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
          "apikey": env.SUPABASE_ANON_KEY,
          "Authorization": token ? `Bearer ${token}` : `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      return res;
    };

    // --- ROUTES ---

    // 0. GET /api/profile
    if (url.pathname === "/api/profile" && method === "GET") {
      const auth = requireAuth(request);
      if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: securityHeaders });
      
      const res = await supabase(`profiles?select=*&id=eq.${auth.userId}`, {}, auth.token);
      const profiles = await res.json();
      
      if (!Array.isArray(profiles) || profiles.length === 0) {
          return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: securityHeaders });
      }
      
      return new Response(JSON.stringify(profiles[0]), { headers: securityHeaders });
    }

    // 1. GET /api/jobs (Tier-Enforced Job Delivery)
    if (url.pathname === "/api/jobs" && method === "GET") {
      const auth = requireAuth(request);
      if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: securityHeaders });

      const profileRes = await supabase(`profiles?select=current_tier,sectors&id=eq.${auth.userId}`, {}, auth.token);
      const profiles = await profileRes.json();
      const profile = profiles[0];

      if (!profile) return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: securityHeaders });

      const sector = url.searchParams.get("sector") || "all";
      let query = `scraped_jobs?select=*&order=indexed_at.desc`;

      if (sector !== "all") {
        if (profile.current_tier === "free" && !profile.sectors.includes(sector)) {
            return new Response(JSON.stringify({ error: "Upgrade to Pro to access this sector" }), { status: 403, headers: securityHeaders });
        }
        query += `&sector=eq.${sector}`;
      } else if (profile.current_tier === "free") {
        const sectors = profile.sectors.length > 0 ? profile.sectors.slice(0, 3).join(",") : "none";
        query += `&sector=in.(${sectors})`;
      }

      if (profile.current_tier === "free") query += "&limit=20";

      const jobsRes = await supabase(query, {}, auth.token);
      const jobs = await jobsRes.json();

      return new Response(JSON.stringify({
        items: jobs,
        ad_compulsory_trigger: profile.current_tier === "free",
      }), { headers: securityHeaders });
    }

    // 2. POST /api/verify-id (Fixed Bug: Improved Validation + Proper Response)
    if (url.pathname === "/api/verify-id" && method === "POST") {
      const auth = requireAuth(request);
      if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: securityHeaders });

      try {
        const formData = await request.formData();
        const idImage = formData.get("image");
        const phoneNumber = formData.get("phone_number");

        if (!idImage) return new Response(JSON.stringify({ error: "Missing image" }), { status: 400, headers: securityHeaders });

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: "Analyze this government ID. Return strict JSON: { \"is_valid\": boolean, \"extracted_country\": string, \"confidence\": number }." },
                { inline_data: { mime_type: "image/jpeg", data: Buffer.from(await idImage.arrayBuffer()).toString("base64") } }
              ]
            }]
          }),
        });

        const geminiData = await geminiRes.json();
        const aiText = geminiData.candidates[0].content.parts[0].text;
        const aiResult = JSON.parse(aiText.replace(/```json|```/g, ""));

        const edgeCountry = request.headers.get("CF-IPCountry");
        const status = (aiResult.is_valid && aiResult.extracted_country === edgeCountry) ? "verified" : "flagged";

        await supabase(`profiles?id=eq.${auth.userId}`, {
          method: "PATCH",
          body: JSON.stringify({ id_status: status, verified_phone: phoneNumber, country: edgeCountry })
        }, auth.token);

        return new Response(JSON.stringify({ status, ...aiResult }), { headers: securityHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Verification failed", details: e.message }), { status: 500, headers: securityHeaders });
      }
    }

    // Fallback
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: securityHeaders });
  }
};
