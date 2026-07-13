// ================================================================
//  PROJECT: SNIPEJOB SAAS -- job-scraping cron script
//  Save this file as: scraper.js (repo root)
//  Run by: .github/workflows/sniper-cron.yml every 15 minutes
//
//  SOURCES (6 confirmed live as of 2026-07-12):
//   1. We Work Remotely   — RSS feed, ~99 jobs
//   2. Remotive           — RSS feed, ~40 jobs
//   3. Himalayas          — RSS feed, ~100 jobs
//   4. Freelancer.com     — RSS feed, ~20 jobs
//   5. Authentic Jobs     — RSS feed, ~10 jobs
//   6. No Desk            — RSS feed, ~10 jobs
//
//  REMOVED:
//   - Upwork (RSS endpoint gone — HTTP 410 as of 2026-07-12)
//   - Reddit (HTTP 403 on bot JSON API — use PRAW if needed in future)
// ================================================================
const axios = require('axios');
const Parser = require('rss-parser');
const parser = new Parser();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Browser-like headers — required by some feeds (Himalayas, Authentic Jobs)
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const SECTORS = {
  web: ['frontend', 'backend', 'fullstack', 'react', 'wordpress', 'website', 'node', 'php', 'javascript', 'nextjs', 'vue'],
  data: ['data science', 'analytics', 'python', 'machine learning', 'sql', 'excel scraper', 'data analyst', 'big data'],
  video: ['editor', 'premiere', 'after effects', 'da vinci', 'thumbnail', 'tiktok video', 'video editor', 'motion graphics'],
  design: ['ui', 'ux', 'figma', 'graphic design', 'logo', 'branding', 'illustrator', 'photoshop'],
  ai: ['ai', 'automation', 'gpt', 'llm', 'langchain', 'openai', 'anthropic', 'stable diffusion'],
  writing: ['copywriting', 'content writer', 'blog', 'technical writer', 'editing', 'proofreading', 'ghostwriter'],
  mobile: ['ios', 'android', 'react native', 'flutter', 'swift', 'kotlin', 'mobile app'],
  cyber: ['security', 'pentest', 'hacker', 'cybersecurity', 'soc', 'compliance'],
  marketing: ['seo', 'ads', 'google ads', 'facebook ads', 'social media marketing', 'growth', 'marketing'],
  support: ['support', 'customer service', 'help desk', 'ticket', 'cx', 'client success'],
  va: ['virtual assistant', 'admin assistant', 'personal assistant', 'data entry', 'scheduling'],
  sales: ['sales', 'business development', 'bdr', 'sdr', 'account executive', 'outreach', 'cold call'],
  mgmt: ['project manager', 'product manager', 'scrum', 'agile', 'operations', 'team lead'],
  finance: ['finance', 'accounting', 'bookkeeping', 'audit', 'tax', 'payroll', 'crypto', 'trader'],
  legal: ['legal', 'lawyer', 'paralegal', 'compliance', 'contract', 'attorney']
};

function classifySector(text) {
  const lower = text.toLowerCase();
  for (const [key, keywords] of Object.entries(SECTORS)) {
    if (keywords.some(k => lower.includes(k))) return key;
  }
  return 'other';
}

/**
 * Fetch an RSS feed via axios (handles feeds that block rss-parser's default
 * User-Agent) and parse the XML string. Falls back gracefully on any error.
 */
async function scrapeRSS(url, sourceName) {
  const jobs = [];
  try {
    const res = await axios.get(url, { headers: FETCH_HEADERS, timeout: 15000 });
    const feed = await parser.parseString(res.data);
    for (const item of feed.items) {
      const content = (item.title || '') + ' ' + (item.contentSnippet || item.content || '');
      jobs.push({
        title: item.title || 'Untitled',
        company: sourceName,
        sector: classifySector(content),
        listing_source: sourceName,
        job_url: item.link || item.guid || '',
        payload_description: content.substring(0, 800),
        internal_labels: ['new']
      });
    }
    console.log(`✅ ${sourceName}: ${jobs.length} jobs scraped`);
  } catch (e) {
    console.error(`❌ ${sourceName}: ${e.message}`);
  }
  return jobs;
}

async function syncToSupabase(jobs) {
  console.log(`\nSyncing ${jobs.length} total jobs to Supabase...`);

  for (const job of jobs) {
    try {
      await axios.post(`${SUPABASE_URL}/rest/v1/scraped_jobs`, job, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        }
      });
    } catch (e) {
      // Silently ignore duplicates or constraint errors
    }
  }

  // Cleanup old jobs (> 48h) to keep the table lean
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  try {
    await axios.delete(`${SUPABASE_URL}/rest/v1/scraped_jobs?indexed_at=lt.${cutoff}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    console.log(`🧹 Cleaned up jobs older than 48h`);
  } catch (e) {
    console.error('Cleanup error:', e.message);
  }
}

async function run() {
  console.log('🚀 Starting SnipeJob scraping cycle...\n');
  let allJobs = [];

  // ── Source 1: We Work Remotely ───────────────────────────────────────
  allJobs = allJobs.concat(await scrapeRSS(
    'https://weworkremotely.com/remote-jobs.rss',
    'We Work Remotely'
  ));

  // ── Source 2: Remotive ───────────────────────────────────────────────
  allJobs = allJobs.concat(await scrapeRSS(
    'https://remotive.com/remote-jobs/feed',
    'Remotive'
  ));

  // ── Source 3: Himalayas ──────────────────────────────────────────────
  allJobs = allJobs.concat(await scrapeRSS(
    'https://himalayas.app/jobs/rss',
    'Himalayas'
  ));

  // ── Source 4: Freelancer.com ─────────────────────────────────────────
  allJobs = allJobs.concat(await scrapeRSS(
    'https://www.freelancer.com/rss.xml',
    'Freelancer.com'
  ));

  // ── Source 5: Authentic Jobs ─────────────────────────────────────────
  allJobs = allJobs.concat(await scrapeRSS(
    'https://authenticjobs.com/feed/',
    'Authentic Jobs'
  ));

  // ── Source 6: No Desk ────────────────────────────────────────────────
  allJobs = allJobs.concat(await scrapeRSS(
    'https://nodesk.co/remote-jobs/index.xml',
    'No Desk'
  ));

  console.log(`\n📦 Scraping complete. Total jobs found: ${allJobs.length}`);
  await syncToSupabase(allJobs);
  console.log('✅ Sync complete.');
}

run();
