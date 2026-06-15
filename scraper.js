const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const parser = new Parser();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function scrapeReddit() {
  const subreddits = ['forhire', 'freelance_jobs', 'remotejs', 'designjobs', 'videoteditingjobs'];
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
            payload_description: post.selftext.substring(0, 800),
            internal_labels: ['new']
          });
        }
      }
    } catch (e) {
      console.error(`Error scraping Reddit ${sub}:`, e.message);
    }
  }
  return jobs;
}

async function scrapeRSS(url, sourceName) {
  const jobs = [];
  try {
    const feed = await parser.parseURL(url);
    for (const item of feed.items) {
      const content = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
      let sector = 'other';

      for (const [key, keywords] of Object.entries(SECTORS)) {
        if (keywords.some(k => content.includes(k))) {
          sector = key;
          break;
        }
      }

      jobs.push({
        title: item.title,
        company: sourceName,
        sector: sector,
        listing_source: sourceName,
        job_url: item.link,
        payload_description: (item.contentSnippet || '').substring(0, 800),
        internal_labels: ['new']
      });
    }
  } catch (e) {
    console.error(`Error scraping RSS ${sourceName}:`, e.message);
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
      // Ignore duplicates or errors
    }
  }

  // Cleanup old jobs (> 48h)
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  try {
    await axios.delete(`${SUPABASE_URL}/rest/v1/scraped_jobs?indexed_at=lt.${cutoff}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
  } catch (e) {
    console.error("Cleanup error:", e.message);
  }
}

async function run() {
  let allJobs = [];
  
  console.log("Starting scraping cycle...");
  
  const redditJobs = await scrapeReddit();
  allJobs = allJobs.concat(redditJobs);

  const wwrJobs = await scrapeRSS('https://weworkremotely.com/remote-jobs.rss', 'We Work Remotely');
  allJobs = allJobs.concat(wwrJobs);

  const remotiveJobs = await scrapeRSS('https://remotive.com/remote-jobs/feed', 'Remotive');
  allJobs = allJobs.concat(remotiveJobs);

  const himalayasJobs = await scrapeRSS('https://himalayas.app/jobs/rss', 'Himalayas');
  allJobs = allJobs.concat(himalayasJobs);

  const upworkJobs = await scrapeRSS('https://www.upwork.com/ab/feed/jobs/rss?q=remote', 'Upwork');
  allJobs = allJobs.concat(upworkJobs);

  const freelancerJobs = await scrapeRSS('https://www.freelancer.com/rss.xml', 'Freelancer.com');
  allJobs = allJobs.concat(freelancerJobs);

  console.log(`Scraping complete. Found ${allJobs.length} total jobs.`);
  await syncToSupabase(allJobs);
}

run();
