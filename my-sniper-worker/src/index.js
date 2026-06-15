/**
 * SnipeJob Cloudflare Worker API
 * Zero-cost backend for job sniping and monetization.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- DEBUG ENDPOINT ---
    if (url.pathname === "/debug/env" && method === "GET") {
      return new Response(JSON.stringify({
        hasSupabaseUrl: !!env.SUPABASE_URL,
        hasAnonKey: !!env.SUPABASE_ANON_KEY,
        hasServiceRole: !!env.SUPABASE_SERVICE_ROLE_KEY,
        hasGemini: !!env.GEMINI_API_KEY,
        deployedAt: new Date().toISOString()
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = request.headers.get("Authorization");
    const userToken = authHeader ? authHeader.split(" ")[1] : null;

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
      if (!res.ok) {
          const err = await res.text();
          console.error(`Supabase Error [${res.status}]: ${err}`);
      }
      return res;
    };

    // --- ROUTES ---

    // 0. GET /api/profile (Fetch authenticated user profile)
    if (url.pathname === "/api/profile" && method === "GET") {
      if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      
      const res = await supabase("profiles?select=*");
      const profiles = await res.json();
      
      if (profiles.length === 0) {
          return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: corsHeaders });
      }
      
      return new Response(JSON.stringify(profiles[0]), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // --- NEW: PINNED JOBS ENDPOINTS ---

    // GET /api/pinned (Fetch user's pinned jobs)
    if (url.pathname === "/api/pinned" && method === "GET") {
        if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        const res = await supabase("user_pinned_jobs?select=*,job:scraped_jobs(*)");
        const pinned = await res.json();
        return new Response(JSON.stringify(pinned), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /api/pin (Pin a job)
    if (url.pathname === "/api/pin" && method === "POST") {
        if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        const { job_id } = await request.json();
        const res = await supabase("user_pinned_jobs", {
            method: "POST",
            body: JSON.stringify({ job_id })
        });
        return new Response("Pinned", { status: 201, headers: corsHeaders });
    }

    // DELETE /api/pin (Unpin a job)
    if (url.pathname === "/api/pin" && method === "DELETE") {
        if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        const { job_id } = await request.json();
        await supabase(`user_pinned_jobs?job_id=eq.${job_id}`, { method: "DELETE" });
        return new Response("Unpinned", { headers: corsHeaders });
    }

    // PATCH /api/pin (Update pinned job status)
    if (url.pathname === "/api/pin" && method === "PATCH") {
        if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        const { job_id, status } = await request.json();
        await supabase(`user_pinned_jobs?job_id=eq.${job_id}`, {
            method: "PATCH",
            body: JSON.stringify({ system_status: status })
        });
        return new Response("Updated", { headers: corsHeaders });
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

      if (sector !== "all") {
        // Even if requesting a specific sector, check if free user has access
        if (profile.current_tier === "free" && !profile.sectors.includes(sector)) {
            return new Response("Upgrade to Pro to access this sector", { status: 403, headers: corsHeaders });
        }
        query += `&sector=eq.${sector}`;
      } else if (profile.current_tier === "free") {
        // Free users only see their selected sectors (max 3)
        const sectors = profile.sectors.slice(0, 3).join(",");
        query += `&sector=in.(${sectors})`;
      }

      // Tier limits
      if (profile.current_tier === "free") {
        query += "&limit=20";
      }

      const jobsRes = await supabase(query);
      const jobs = await jobsRes.json();

      return new Response(JSON.stringify({
        items: jobs,
        ad_compulsory_trigger: profile.current_tier === "free",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. POST /api/ai-apply (AI Premium One-Click Application)
    if (url.pathname === "/api/ai-apply" && method === "POST") {
      if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const { job_id } = await request.json();

      // Check if user is Pro
      const profileRes = await supabase("profiles?select=current_tier,payload_resume"); // Assuming resume is stored or passed
      const profile = (await profileRes.json())[0];

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
      const proposalText = geminiData.candidates[0].content.parts[0].text;

      return new Response(JSON.stringify({ proposal: proposalText }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- NEW: AI 1-TAP RESUME ENDPOINT ---
    if (url.pathname === "/api/ai-resume" && method === "POST") {
      if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const { job_id } = await request.json();

      // 1. Get user profile
      const profileRes = await supabase("profiles?select=full_name,sectors,exp_level,primary_skill,bio,education,current_tier");
      const profile = (await profileRes.json())[0];
      if (profile.current_tier !== "paid") return new Response("Pro feature only", { status: 403, headers: corsHeaders });

      // 2. Get job details
      const jobRes = await supabase(`scraped_jobs?select=title,payload_description&id=eq.${job_id}`);
      const job = (await jobRes.json())[0];

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
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      const geminiData = await geminiRes.json();
      const resumeText = geminiData.candidates[0].content.parts[0].text;

      // In a real app, we'd email this to the client or push to a platform API.
      // Here we simulate successful submission.
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
      if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

      const formData = await request.formData();
      const idImage = formData.get("image");
      const phoneNumber = formData.get("phone_number");

      if (!idImage) return new Response("Missing image", { status: 400, headers: corsHeaders });

      // In a real implementation, you'd upload to Supabase Storage here.
      // For brevity, we pass the image buffer directly to Gemini.

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
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
      const aiResult = JSON.parse(geminiData.candidates[0].content.parts[0].text.replace(/```json|```/g, ""));

      const edgeCountry = request.headers.get("CF-IPCountry");
      let status = "flagged";

      if (aiResult.is_valid && aiResult.extracted_country === edgeCountry) {
        status = "verified";
      }

      // Update profile
      await supabase("profiles?id=eq." + userToken, { // Note: id should be user UUID from auth
        method: "PATCH",
        body: JSON.stringify({
          id_status: status,
          verified_phone: phoneNumber,
          country: edgeCountry
        })
      });

      return new Response(JSON.stringify(aiResult), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

      // Atomic transaction via Supabase function
      await supabase("rpc/process_affiliate_credit", {
        method: "POST",
        body: JSON.stringify({
          target_user_id: subid,
          sub_id: url.searchParams.get("tracking_id") || `task_${Date.now()}`,
          provider: "CPALead",
          raw_payout: payout,
          user_cut: userCut,
          ip_addr: clickIp
        })
      });

      return new Response("OK", { headers: corsHeaders });
    }

    // 4. POST /api/withdraw
    if (url.pathname === "/api/withdraw" && method === "POST") {
       if (!userToken) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
       
       const body = await request.json();
       const { amount, channel, address } = body;

       if (amount < 2) return new Response("Minimum $2", { status: 400, headers: corsHeaders });

       // Check balance
       const profileRes = await supabase("profiles?select=wallet_balance,current_tier");
       const profile = (await profileRes.json())[0];

       if (!profile || profile.current_tier !== 'paid') {
           return new Response("Pro subscription required for withdrawals", { status: 403, headers: corsHeaders });
       }

       if (profile.wallet_balance < amount) return new Response("Insufficient balance", { status: 400, headers: corsHeaders });

       // Deduct and log
       await supabase(`profiles`, {
           method: "PATCH",
           body: JSON.stringify({ wallet_balance: profile.wallet_balance - amount })
       });

       await supabase("withdrawal_requests", {
           method: "POST",
           body: JSON.stringify({
               total_amount: amount,
               payment_channel: channel,
               target_address: address,
               status: "pending"
           })
       });

       return new Response("Withdrawal requested", { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
