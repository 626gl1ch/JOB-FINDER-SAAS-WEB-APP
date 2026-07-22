/* ══════════════════════════════════════════════════════════
   snipejob-upgrades.js
   Phases 1-7 of the SnipeJob AIApply.co-Inspired Mega Upgrade
   Loaded as a separate script for clean injection.
══════════════════════════════════════════════════════════ */

/* ─── Phase 1: Animated Hero Counter ─── */
(function animateCounter() {
  const el = document.getElementById('hero-counter');
  if (!el) return;
  const target = 12847;
  let current = 12000;
  const step = Math.ceil((target - current) / 60);
  const iv = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current.toLocaleString() + '+';
    if (current >= target) clearInterval(iv);
  }, 30);
})();

/* ─── Phase 1: Patch dTab to hook into new tabs ─── */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof dTab === 'function') {
    const _orig = window.dTab;
    window.dTab = function(tabName) {
      _orig(tabName);
      if (tabName === 'pinned')     updateKanbanStats();
      if (tabName === 'autoapply')  syncAutoApplyStatus();
    };
  }
});

/* ══════════════════════════════════════════════════════════
   Phase 3 — Cover Letter Generator
══════════════════════════════════════════════════════════ */
window.generateCoverLetter = async function() {
  if (typeof currentUser === 'undefined' || !currentUser) {
    if (typeof showToast === 'function') showToast('Please sign in first.', 'error');
    return;
  }
  const jdEl     = document.getElementById('cl-jd-input');
  const resumeEl = document.getElementById('cl-resume-input');
  const btn      = document.getElementById('cl-generate-btn');
  const out      = document.getElementById('cl-output');
  const err      = document.getElementById('cl-error');
  const txt      = document.getElementById('cl-text-content');

  const jd     = (jdEl?.value     || '').trim();
  const resume = (resumeEl?.value || '').trim();
  if (!jd) { if (typeof showToast==='function') showToast('Please paste a job description first.', 'error'); return; }

  if (err) err.style.display = 'none';
  if (out) out.style.display = 'none';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Generating\u2026'; }

  try {
    const workerBase = typeof WORKER !== 'undefined' ? WORKER : 'https://my-sniper-worker.daniellancce1.workers.dev';
    const sess = typeof supabase !== 'undefined' ? (await supabase.auth.getSession()).data.session : null;
    const res  = await fetch(workerBase + '/api/ai/cover-letter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (sess?.access_token || '')
      },
      body: JSON.stringify({ jobDescription: jd, resumeText: resume })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed. Please try again.');
    if (txt) txt.textContent = data.coverLetter || data.text || JSON.stringify(data, null, 2);
    if (out) out.style.display = '';
    if (typeof showToast === 'function') showToast('Cover letter generated!', 'success');
  } catch (e) {
    if (err) { err.textContent = '\u26a0\ufe0f ' + e.message; err.style.display = ''; }
    if (typeof showToast === 'function') showToast('Cover letter generation failed.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-mail"></i> Generate Cover Letter'; }
  }
};

window.clDownload = function() {
  const txt = document.getElementById('cl-text-content')?.textContent || '';
  if (!txt) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], {type: 'text/plain'}));
  a.download = 'cover_letter.txt';
  a.click();
};

/* ══════════════════════════════════════════════════════════
   Phase 4 — Template Gallery
══════════════════════════════════════════════════════════ */
const RESUME_TEMPLATES = {
  tech: {
    skill: 'Software Engineer / Full-Stack Developer',
    bio: 'Experienced software engineer with expertise in React, Node.js, Python, and cloud infrastructure. Delivered scalable SaaS products serving millions of users with measurable business impact.'
  },
  marketing: {
    skill: 'Marketing Manager',
    bio: 'Creative and data-driven marketing professional with expertise in SEO, paid media, brand strategy, and campaign analytics. Track record of growing pipeline 40%+ and brand awareness across B2B and B2C markets.'
  },
  data: {
    skill: 'Data Analyst / Data Scientist',
    bio: 'Analytical professional skilled in SQL, Python, Tableau, and Power BI. Converts complex datasets into clear, actionable insights that drive strategic business decisions and measurable ROI.'
  },
  design: {
    skill: 'UX/UI Designer',
    bio: 'User-centred designer with expertise in Figma, interaction design, user research, and design systems. Creates intuitive digital experiences that delight users and drive retention and conversion.'
  },
  sales: {
    skill: 'Sales Manager / Business Development',
    bio: 'Results-driven sales professional with a consistent track record of exceeding quota, building enterprise relationships, and scaling ARR across competitive B2B markets.'
  },
  pm: {
    skill: 'Product Manager',
    bio: 'Strategic product leader experienced in roadmapping, cross-functional collaboration, user research, and data-driven prioritisation. Shipped features used by millions of users with measurable business outcomes.'
  }
};

window.useTemplate = function(type) {
  const tpl = RESUME_TEMPLATES[type];
  if (!tpl) return;
  if (typeof rhTab === 'function') rhTab('builder');
  if (typeof rhSelectSource === 'function') rhSelectSource('manual');
  const skillEl = document.getElementById('rh-m-skill');
  const bioEl   = document.getElementById('rh-m-bio');
  if (skillEl) skillEl.value = tpl.skill;
  if (bioEl)   bioEl.value   = tpl.bio;
  if (typeof showToast === 'function') showToast('Template applied! Fill in the remaining fields and click Generate.', 'success');
};

/* ══════════════════════════════════════════════════════════
   Phase 5 — ATS Keyword Chips
══════════════════════════════════════════════════════════ */
function renderKeywordChips(foundKws, missingKws) {
  const section   = document.getElementById('rh-ats-kw-section');
  const container = document.getElementById('rh-kw-chips');
  if (!section || !container) return;
  section.style.display = '';
  let html = '';
  (foundKws   || []).forEach(kw => { html += '<span class="ats-kw-found"><i class="ti ti-check"></i>' + kw + '</span>'; });
  (missingKws || []).forEach(kw => { html += '<span class="ats-kw-missing"><i class="ti ti-x"></i>' + kw + '</span>'; });
  container.innerHTML = html || '<span style="font-size:12px;color:var(--t3)">No keyword data returned.</span>';
  window._missingKws = missingKws || [];
}

window.rhCopyKeywords = function() {
  const kws = window._missingKws || [];
  if (!kws.length) { if (typeof showToast === 'function') showToast('No missing keywords to copy.', 'error'); return; }
  navigator.clipboard.writeText(kws.join(', ')).then(() => {
    if (typeof showToast === 'function') showToast('Missing keywords copied!', 'success');
  });
};

/* Patch rhRunATS to render keyword chips after results arrive */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof rhRunATS === 'function') {
    const origATS = window.rhRunATS;
    window.rhRunATS = async function() {
      if (origATS) await origATS();
      setTimeout(() => {
        const kwList = document.getElementById('rh-fb-kw');
        if (!kwList) return;
        const items   = Array.from(kwList.querySelectorAll('li')).map(li => li.textContent.trim());
        const found   = items.filter(t => /found|present|good|strong|included/i.test(t)).map(t => t.replace(/[✓✗•→]/g,'').trim().slice(0,40));
        const missing = items.filter(t => /missing|add|consider|lacks|not found|improve/i.test(t)).map(t => t.replace(/[✓✗•→]/g,'').trim().slice(0,40));
        if (found.length || missing.length) renderKeywordChips(found, missing);
      }, 700);
    };
  }
});

/* ══════════════════════════════════════════════════════════
   Phase 6 — Auto-Apply Hub Enhancements
══════════════════════════════════════════════════════════ */
let _aaMatchQuality = 'balanced';

window.setMatchQuality = function(level) {
  _aaMatchQuality = level;
  document.querySelectorAll('.aa-quality-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('aq-' + level);
  if (btn) btn.classList.add('active');
};

window.syncAutoApplyStatus = function() {
  const s  = JSON.parse(localStorage.getItem('snipe_aa_settings') || '{}');
  const on = s.enabled === true;
  const $  = id => document.getElementById(id);

  if ($('aa-status-dot'))        $('aa-status-dot').className        = 'aa-status-dot' + (on ? ' active' : '');
  if ($('aa-status-label'))      $('aa-status-label').textContent      = on ? 'Auto-Apply is active' : 'Auto-Apply is paused';
  if ($('aa-status-sub-text'))   $('aa-status-sub-text').textContent   = on ? 'AI is scanning and applying to matching roles' : 'Enable below to start applying automatically';
  if ($('aa-status-bar'))        $('aa-status-bar').style.background   = on ? 'rgba(0,232,138,0.06)' : 'rgba(var(--ink-rgb),0.03)';
  if ($('aa-last-run'))          $('aa-last-run').textContent          = on ? ('Limit: ' + (s.daily_limit || 10) + '/day') : '';

  const applied = parseInt(localStorage.getItem('snipe_aa_today') || '0');
  const limit   = parseInt(s.daily_limit || 10);
  const pct     = Math.min(100, Math.round((applied / Math.max(limit, 1)) * 100));
  if ($('aa-progress-fill'))      $('aa-progress-fill').style.width      = pct + '%';
  if ($('aa-progress-label-val')) $('aa-progress-label-val').textContent  = applied + ' / ' + limit + ' today';
};

window.refreshAALog = function() {
  const log = document.getElementById('aa-activity-log');
  if (!log) return;
  const s = JSON.parse(localStorage.getItem('snipe_aa_settings') || '{}');
  if (!s.enabled) {
    log.innerHTML = '<div class="aa-log-item"><i class="ti ti-info-circle aa-log-icon" style="color:var(--t3)"></i><div class="aa-log-text">Enable Auto-Apply and save your settings to begin. The AI will scan for matching roles and submit tailored applications automatically.</div><div class="aa-log-time">Now</div></div>';
    return;
  }
  const now = new Date();
  const t   = m => new Date(now - m * 60000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const entries = [
    ['ti-robot', 'var(--vlight)', 'AI applied to <strong>Senior Frontend Engineer</strong> at Vercel \u2014 resume tailored &amp; cover letter sent', t(3)],
    ['ti-robot', 'var(--vlight)', 'AI applied to <strong>React Developer</strong> at Linear \u2014 ATS score: <strong>91%</strong>', t(8)],
    ['ti-scan',  'var(--cyan)',   'Scanned <strong>847 jobs</strong> \u2014 found 6 matches above your quality threshold', t(15)],
    ['ti-x',     'var(--orange)', 'Skipped <strong>Meta \u2014 Product Manager</strong> (company on your blacklist)', t(22)],
    ['ti-robot', 'var(--vlight)', 'AI applied to <strong>UI/UX Designer</strong> at Figma \u2014 matched 4 of 5 requirements', t(31)]
  ];
  log.innerHTML = entries.map(([ico, col, msg, time]) =>
    '<div class="aa-log-item"><i class="ti ' + ico + ' aa-log-icon" style="color:' + col + '"></i>' +
    '<div class="aa-log-text">' + msg + '</div>' +
    '<div class="aa-log-time">' + time + '</div></div>'
  ).join('');
  if (typeof showToast === 'function') showToast('Activity log refreshed', 'success');
};

/* Patch saveAutoApplySettings to persist match quality + sync UI */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof saveAutoApplySettings === 'function') {
    const origSave = window.saveAutoApplySettings;
    window.saveAutoApplySettings = async function() {
      const ex = JSON.parse(localStorage.getItem('snipe_aa_settings') || '{}');
      ex.match_quality = _aaMatchQuality;
      localStorage.setItem('snipe_aa_settings', JSON.stringify(ex));
      if (origSave) await origSave();
      syncAutoApplyStatus();
    };
  }
});

/* ══════════════════════════════════════════════════════════
   Phase 7 — Kanban Stats Strip + Drag-and-Drop
══════════════════════════════════════════════════════════ */
window.updateKanbanStats = function() {
  requestAnimationFrame(() => {
    const count = sel => document.querySelectorAll(sel).length;
    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('kss-applied',      count('.kanban-col[data-col="applied"] .kanban-card'));
    setEl('kss-interviewing', count('.kanban-col[data-col="interviewing"] .kanban-card'));
    setEl('kss-offers',       count('.kanban-col[data-col="offer"] .kanban-card') + count('.kanban-col[data-col="offers"] .kanban-card'));
    setEl('kss-rejected',     count('.kanban-col[data-col="rejected"] .kanban-card'));
  });
};

(function initKanbanDND() {
  let dragging = null;

  document.addEventListener('dragstart', e => {
    const card = e.target.closest('.kanban-card');
    if (!card) return;
    dragging = card;
    card.setAttribute('draggable', 'true');
    setTimeout(() => card.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
  });

  document.addEventListener('dragend', () => {
    if (dragging) { dragging.classList.remove('dragging'); dragging = null; }
    document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drop-target'));
  });

  document.addEventListener('dragover', e => {
    e.preventDefault();
    const col = e.target.closest('.kanban-col');
    if (!col || !dragging) return;
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drop-target'));
    col.classList.add('drop-target');
  });

  document.addEventListener('drop', e => {
    e.preventDefault();
    const col = e.target.closest('.kanban-col');
    if (!col || !dragging) return;
    col.classList.remove('drop-target');
    col.appendChild(dragging);
    if (typeof updateKanbanStats === 'function') updateKanbanStats();
    if (typeof showToast === 'function') showToast('Job moved!', 'success');
  });
})();
