const axios = require('axios');
const cheerio = require('cheerio');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SECTORS = {
  web: ['frontend', 'backend', 'fullstack', 'react', 'wordpress', 'website', 'node', 'php', 'javascript'],
  data: ['data science', 'analytics', 'python', 'machine learning', 'sql', 'excel scraper', 'data analyst'],
  video: ['editor', 'premiere', 'after effects', 'da vinci', 'thumbnail', 'tiktok video', 'video editor'],
  design: ['ui', 'ux', 'figma', 'graphic design', 'logo', 'branding'],
  ai: ['ai', 'automation', 'gpt', 'llm', 'langchain', 'openai']
};

async function scrapeReddit() {
  const subreddits = ['forhire', 'freelance_jobs', 'remotejs'];
  const jobs = [];

  for (const sub of subreddits) {
    try {
      const res = await axios.get(`https://www.reddit.com/r/${sub}/new.json`, {
        headers: { 'User-Agent': 'SnipeJobBot/1.0' }
      });
      const posts = res.data.data.children;

      for (const { data: post } of posts) {
        if (post.is_self) {
          const content = (post.title + ' ' + post.selftext).toLowerCase();
          let sector = 'other';

          for (const [key, keywords] of Object.entries(SECTORS)) {
            if (keywords.some(k => content.includes(k))) {
              sector = key;
              break;
            }
          }

          jobs.push({
            title: post.title,
            company: 'Reddit /r/' + sub,
            sector: sector,
            listing_source: 'Reddit',
            job_url: 'https://reddit.com' + post.permalink,
            payload_description: post.selftext.substring(0, 500),
            internal_labels: ['new']
          });
        }
      }
    } catch (e) {
      console.error(`Error scraping ${sub}:`, e.message);
    }
  }
  return jobs;
}

async function syncToSupabase(jobs) {
  console.log(`Syncing ${jobs.length} jobs...`);
  
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
      // Ignore duplicates
    }
  }

  // Cleanup old jobs (> 48h)
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  await axios.delete(`${SUPABASE_URL}/rest/v1/scraped_jobs?indexed_at=lt.${cutoff}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
}

async function run() {
  const jobs = await scrapeReddit();
  // Add other sources here (RSS, etc)
  await syncToSupabase(jobs);
}

run();
