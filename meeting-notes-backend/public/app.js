// ============================================================
// app.js  |  v7 (2026-05-05)
// 4-tier quota + License device binding
// anon 1/day | email 3/day | pro 10/week | max 60/mo
// v7 CHANGE: deviceId sent on verify-license + revalidate
//            activateLicense / revalidateLicense cleaned up
// ============================================================

console.log('%c[umami+quota] build v7 loaded ✅ device-bound license  2026-05-05', 'color:#16a34a;font-weight:bold');

function track(eventName, eventData) {
  try {
    console.log('%c[umami] track →', 'color:#5b5bf5;font-weight:bold', eventName, eventData || '');
    if (typeof window !== 'undefined' && window.umami && typeof window.umami.track === 'function') {
      if (eventData) window.umami.track(eventName, eventData);
      else window.umami.track(eventName);
    } else {
      console.warn('[umami] window.umami not ready — event dropped:', eventName);
    }
  } catch (err) { console.debug('[track] failed:', err); }
}
// Alias for old code calling trackEvent()
const trackEvent = track;

(function () {
  const STEPS = ['coordinator', 'summarizer', 'action_item_agent', 'followup_email_agent', 'qa_review_agent'];
  const SUPPORTED = ['en', 'zh-Hant'];
  const MAX_FILE_SIZE = 2 * 1024 * 1024;
  const MAX_NOTES = 20000;
  const MIN_NOTES = 30;
  const HISTORY_MAX = 20;
  const ETA_SECONDS = 30;

  const PLANS = {
    anon:  { label: 'Free',    daily: 1,    weekly: null, monthly: null, periodKey: 'daily'   },
    email: { label: 'Starter', daily: 3,    weekly: null, monthly: null, periodKey: 'daily'   },
    pro:   { label: 'Pro',     daily: null, weekly: 10,   monthly: null, periodKey: 'weekly'  },
    max:   { label: 'Max',     daily: null, weekly: null, monthly: 60,   periodKey: 'monthly' }
  };
  const QUOTA_KEY  = 'quota_v4';
  const PRO_KEY    = 'pro';
  const EMAIL_KEY  = 'userEmail';
  const DEVICE_KEY = 'device_id';
  const QUOTA_LIMIT = PLANS.anon.daily;

  // ──────────────────────────────────────────────
  // Device ID — stable per-browser identifier
  // ──────────────────────────────────────────────
  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  const FALLBACK_SAMPLE = {
    en: {
      title: 'Weekly production sync',
      notes: 'Attendees: Alice (PM), Bob (Eng), Carol (Design)\n- Bob reported backend API v2 is on track, will deploy Wed.\n- Carol showed new onboarding mockups; team agreed to adopt option B.\n- Decision: Freeze scope for v2.0 after this week.\n- Risk: Mobile testing device shortage; Alice to order 2 more iPads by Friday.\n- Action: Bob to finalise migration script by Tue EOD.\n- Action: Carol to deliver final icons by Thu.'
    },
    'zh-Hant': {
      title: '每週生產同步會議',
      notes: '出席：Alice (PM)、Bob (工程)、Carol (設計)\n- Bob 回報後端 API v2 進度正常，週三可部署。\n- Carol 展示新的 Onboarding 設計稿，團隊同意採用方案 B。\n- 決定：本週後凍結 v2.0 範圍。\n- 風險：行動測試裝置不足，Alice 週五前再訂 2 台 iPad。\n- 行動：Bob 週二下班前完成資料庫遷移腳本。\n- 行動：Carol 週四前交出最終圖示。'
    }
  };

  const state = {
    lang: localStorage.getItem('lang') || (navigator.language.startsWith('zh') ? 'zh-Hant' : 'en'),
    theme: localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    dict: {}, lastPayload: null, lastArtifacts: null, isRunning: false, etaTimer: null
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    form: $('form'), meetingTitle: $('meetingTitle'), meetingType: $('meetingType'),
    outputLanguage: $('outputLanguage'), outputMode: $('outputMode'), notes: $('notes'),
    submitButton: $('submitButton'), loadSample: $('loadSample'), clearForm: $('clearForm'),
    copyMarkdown: $('copyMarkdown'), copyEmail: $('copyEmail'), downloadMd: $('downloadMd'),
    themeToggle: $('themeToggle'), historyBtn: $('historyBtn'), status: $('status'),
    summaryOutput: $('summaryOutput'), decisionsOutput: $('decisionsOutput'),
    actionsOutput: $('actionsOutput'), emailOutput: $('emailOutput'),
    stepper: $('stepper'), etaLine: $('etaLine'), etaSec: $('etaSec'),
    errorBanner: $('errorBanner'), errorBannerText: $('errorBannerText'),
    retryButton: $('retryButton'), notesCounter: $('notesCounter'), notesCount: $('notesCount'),
    dropZone: $('dropZone'), fileInput: $('fileInput'), autoCleanBtn: $('autoCleanBtn'),
    shortcutKbd: $('shortcutKbd'), historyDrawer: $('historyDrawer'),
    drawerOverlay: $('drawerOverlay'), closeDrawer: $('closeDrawer'),
    historyList: $('historyList'), historyEmpty: $('historyEmpty'),
    clearHistoryBtn: $('clearHistory'), quotaPill: $('quotaPill'),
    quotaCount: $('quotaCount'), quotaLimit: $('quotaLimit'),
    upgradeModal: $('upgradeModal'), haveLicenseBtn: $('haveLicenseBtn')
  };

  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  if (els.shortcutKbd) els.shortcutKbd.textContent = isMac ? '⌘ + ↵' : 'Ctrl + Enter';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function t(k) { return (state.dict && state.dict[k]) || k; }

  async function loadLocale(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'en';
    state.lang = lang;
    localStorage.setItem('lang', lang);
    document.documentElement.setAttribute('lang', lang === 'zh-Hant' ? 'zh-Hant' : 'en');
    try {
      const res = await fetch('/locales/' + lang + '.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.dict = await res.json();
    } catch (e) {
      console.warn('[locale] load failed, keeping previous dict:', e);
    }
    applyTranslations();
    updateLangButtons();
    if (state.lastArtifacts) renderArtifacts(state.lastArtifacts);
    else clearOutputs();
    updateQuotaPill();
    track('Language Switched', { to: lang });
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
      if (!(key in state.dict)) return;
      const val = t(key);
      if (attr) el.setAttribute(attr, val);
      else el.textContent = val;
    });
  }

  function updateLangButtons() {
    document.querySelectorAll('.lang-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === state.lang);
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.lang-btn');
    if (!btn) return;
    const lang = btn.dataset.lang;
    if (!lang) return;
    loadLocale(lang);
  });

  function setTheme(th) {
    state.theme = th;
    document.documentElement.setAttribute('data-theme', th);
    localStorage.setItem('theme', th);
  }

  setTheme(state.theme);
  els.themeToggle?.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));

  function updateCounter() {
    if (!els.notes || !els.notesCount) return;
    const len = els.notes.value.length;
    els.notesCount.textContent = len.toLocaleString();
    els.notesCounter?.classList.toggle('warn', len > 19500 || (len > 0 && len < MIN_NOTES));
  }
  els.notes?.addEventListener('input', updateCounter);

  function setStatus(key, cls) {
    if (!els.status) return;
    els.status.textContent = key ? t(key) : '';
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }
  function setStatusText(text, cls) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function showError(msg) {
    if (!els.errorBanner) return;
    els.errorBannerText.textContent = msg;
    els.errorBanner.classList.add('show');
  }
  function hideError() {
    if (!els.errorBanner) return;
    els.errorBanner.classList.remove('show');
    els.errorBannerText.textContent = '';
  }

  els.retryButton?.addEventListener('click', () => {
    hideError();
    if (state.lastPayload) submitWorkflow(state.lastPayload);
  });

  function classifyError(err, res) {
    if (!navigator.onLine) return t('errOffline');
    if (err && err.name === 'AbortError') return t('statusTimeout');
    if (res) {
      if (res.status === 429) return t('errQuotaExceeded');
      if (res.status === 502 || res.status === 503 || res.status === 504) return t('errServiceBusy');
      if (res.status >= 500) return t('errServerError');
    }
    return (err && err.message) || t('errServerError');
  }

  function resetStepper() {
    if (!els.stepper) return;
    els.stepper.classList.remove('idle');
    STEPS.forEach((name) => {
      const el = els.stepper.querySelector('[data-step="' + name + '"]');
      if (el) el.className = 'step';
    });
  }
  function idleStepper() {
    if (!els.stepper) return;
    els.stepper.classList.add('idle');
    STEPS.forEach((name) => {
      const el = els.stepper.querySelector('[data-step="' + name + '"]');
      if (el) el.className = 'step';
    });
  }
  function markStep(name, cls) {
    const el = els.stepper?.querySelector('[data-step="' + name + '"]');
    if (el) el.className = 'step ' + cls;
  }
  function applyTraceToStepper(trace) {
    if (!Array.isArray(trace)) return;
    trace.forEach((x) => {
      if (!x || !x.step) return;
      if (x.status === 'completed') markStep(x.step, 'done');
      else if (x.status === 'failed' || x.status === 'parse_failed') markStep(x.step, 'failed');
      else if (x.status === 'started') markStep(x.step, 'active');
    });
  }

  function startEta() {
    if (!els.etaLine || !els.etaSec) return;
    let left = ETA_SECONDS;
    els.etaSec.textContent = left;
    els.etaLine.hidden = false;
    clearInterval(state.etaTimer);
    state.etaTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) { left = 0; clearInterval(state.etaTimer); }
      els.etaSec.textContent = left;
    }, 1000);
  }
  function stopEta() {
    clearInterval(state.etaTimer);
    if (els.etaLine) els.etaLine.hidden = true;
  }

  function priorityClass(p) {
    const v = String(p || '').toLowerCase();
    if (v.includes('high') || v.includes('高') || v === '1') return 'badge-high';
    if (v.includes('low') || v.includes('低') || v === '3') return 'badge-low';
    return 'badge-medium';
  }
  function priorityLabel(p) {
    const v = String(p || '').toLowerCase();
    if (v.includes('high') || v.includes('高')) return t('prioHigh');
    if (v.includes('low') || v.includes('低')) return t('prioLow');
    if (v.includes('medium') || v.includes('中')) return t('prioMedium');
    return p;
  }

  function renderActions(items) {
    if (!els.actionsOutput) return;
    els.actionsOutput.classList.add('actions-v2');
    els.actionsOutput.innerHTML = '';
    if (!items || !items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = t('emptyActions');
      els.actionsOutput.appendChild(li);
      return;
    }
    items.forEach((it) => {
      const li = document.createElement('li');
      if (typeof it === 'string') { li.textContent = it; els.actionsOutput.appendChild(li); return; }
      const task = document.createElement('div');
      task.className = 'action-task';
      task.textContent = it.task || '';
      li.appendChild(task);
      const meta = document.createElement('div');
      meta.className = 'action-meta';
      if (it.owner) meta.insertAdjacentHTML('beforeend', `<span class="badge badge-owner">👤 ${escapeHtml(it.owner)}</span>`);
      if (it.due_date) meta.insertAdjacentHTML('beforeend', `<span class="badge badge-due">📅 ${escapeHtml(it.due_date)}</span>`);
      if (it.priority) meta.insertAdjacentHTML('beforeend', `<span class="badge ${priorityClass(it.priority)}">${escapeHtml(priorityLabel(it.priority))}</span>`);
      if (meta.children.length) li.appendChild(meta);
      els.actionsOutput.appendChild(li);
    });
  }

  function renderList(el, items, formatter, emptyKey) {
    if (!el) return;
    el.innerHTML = '';
    if (!items || !items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = t(emptyKey);
      el.appendChild(li);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = formatter(item);
      el.appendChild(li);
    });
  }

  function setBody(el, text, emptyKey) {
    if (!el) return;
    if (text && text.trim()) { el.textContent = text; el.classList.remove('empty'); }
    else { el.textContent = t(emptyKey); el.classList.add('empty'); }
  }

  function normalizeArtifacts(data) {
    const a = (data && data.artifacts) || data || {};
    return {
      summary: typeof a.summary === 'string' ? a.summary : '',
      decisions: Array.isArray(a.decisions) ? a.decisions : [],
      action_items: Array.isArray(a.action_items) ? a.action_items : [],
      follow_up_email: typeof a.follow_up_email === 'string' ? a.follow_up_email : ''
    };
  }

  function renderArtifacts(a) {
    setBody(els.summaryOutput, a.summary, 'emptySummary');
    setBody(els.emailOutput, a.follow_up_email, 'emptyEmail');
    renderList(els.decisionsOutput, a.decisions, (it) => (typeof it === 'string' ? it : String(it)), 'emptyDecisions');
    renderActions(a.action_items);
  }

  function clearOutputs() {
    renderArtifacts({ summary: '', decisions: [], action_items: [], follow_up_email: '' });
  }

  function flashCopied(btn) {
    if (!btn) return;
    const span = btn.querySelector('span') || btn;
    const old = span.textContent;
    btn.classList.add('copied');
    span.textContent = t('statusCopiedBtn') + ' ✓';
    setTimeout(() => { btn.classList.remove('copied'); span.textContent = old; }, 1600);
  }

  function buildMarkdown() {
    const a = state.lastArtifacts;
    if (!a) return '';
    const lines = [];
    if (a.summary) { lines.push('# ' + t('outSummary'), a.summary, ''); }
    if (a.decisions && a.decisions.length) {
      lines.push('# ' + t('outDecisions'));
      a.decisions.forEach((d) => lines.push('- ' + d));
      lines.push('');
    }
    if (a.action_items && a.action_items.length) {
      lines.push('# ' + t('outActions'));
      a.action_items.forEach((it) => {
        if (typeof it === 'string') lines.push('- ' + it);
        else {
          const d = [it.task || ''];
          if (it.owner) d.push(t('labelOwner') + ': ' + it.owner);
          if (it.due_date) d.push(t('labelDue') + ': ' + it.due_date);
          if (it.priority) d.push(t('labelPriority') + ': ' + priorityLabel(it.priority));
          lines.push('- ' + d.filter(Boolean).join(' | '));
        }
      });
      lines.push('');
    }
    if (a.follow_up_email) { lines.push('# ' + t('outEmail'), a.follow_up_email); }
    return lines.join('\n').trim();
  }

  async function copyText(text, btn, okKey) {
    if (!text) { setStatus('statusNothingToCopy', 'error'); return; }
    try {
      await navigator.clipboard.writeText(text);
      setStatus(okKey, 'success');
      flashCopied(btn);
    } catch { setStatus('statusCopyFailed', 'error'); }
  }

  els.copyMarkdown?.addEventListener('click', (e) => { track('Export Clicked', { type: 'copy', target: 'markdown' }); copyText(buildMarkdown(), e.currentTarget, 'statusCopiedMd'); });
  els.copyEmail?.addEventListener('click', (e) => { track('Export Clicked', { type: 'copy', target: 'email' }); copyText((state.lastArtifacts && state.lastArtifacts.follow_up_email) || '', e.currentTarget, 'statusCopiedEmail'); });

  els.downloadMd?.addEventListener('click', () => {
    const md = buildMarkdown();
    if (!md) { setStatus('statusNothingToCopy', 'error'); return; }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const title = (state.lastPayload && state.lastPayload.meetingTitle) || 'meeting';
    a.href = url;
    a.download = title.replace(/[^\w\u4e00-\u9fff-]+/g, '-').slice(0, 60) + '.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus('statusDownloaded', 'success');
    track('Export Clicked', { type: 'download', format: 'markdown' });
  });

  function cleanTranscript(text) {
    return text
      .replace(/^WEBVTT.*$/m, '')
      .replace(/^\d+$/gm, '')
      .replace(/^\d\d:\d\d:\d\d[.,]\d{3} --> \d\d:\d\d:\d\d[.,]\d{3}.*$/gm, '')
      .replace(/^\[\d{1,2}:\d{2}(:\d{2})?\]\s*/gm, '')
      .replace(/^\(\d{1,2}:\d{2}(:\d{2})?\)\s*/gm, '')
      .replace(/<[^>]+>/g, '')
      .replace(/^Speaker \d+:\s*/gmi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) { showError(t('errFileTooBig') + ' (' + Math.round(file.size / 1024) + 'KB)'); return; }
    const name = (file.name || '').toLowerCase();
    const isText = /\.(txt|md|vtt)$/.test(name) || /^text\//.test(file.type || '');
    if (!isText) { showError(t('errFileType')); return; }
    try {
      const raw = await file.text();
      let content = raw;
      if (name.endsWith('.vtt')) content = cleanTranscript(raw);
      if (content.length > MAX_NOTES) { content = content.slice(0, MAX_NOTES); setStatusText(t('statusTruncated'), 'success'); }
      else { setStatusText(t('statusImported').replace('{name}', file.name), 'success'); }
      els.notes.value = content;
      updateCounter();
      hideError();
    } catch { showError(t('errFileRead')); }
  }

  els.fileInput?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    handleFile(f);
    e.target.value = '';
  });

  if (els.dropZone) {
    ['dragenter', 'dragover'].forEach((ev) => {
      els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); els.dropZone.classList.add('dragging'); });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); els.dropZone.classList.remove('dragging'); });
    });
    els.dropZone.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
  }

  els.autoCleanBtn?.addEventListener('click', () => {
    const before = els.notes.value;
    if (!before.trim()) return;
    els.notes.value = cleanTranscript(before);
    updateCounter();
    setStatus('statusAutoCleaned', 'success');
  });

  els.loadSample?.addEventListener('click', () => {
    const fb = FALLBACK_SAMPLE[state.lang] || FALLBACK_SAMPLE.en;
    const title = t('sampleTitle');
    const notes = t('sampleNotes');
    els.meetingTitle.value = (title === 'sampleTitle') ? fb.title : title;
    els.notes.value = (notes === 'sampleNotes') ? fb.notes : notes;
    updateCounter();
    setStatus('statusSuccess', 'success');
  });

  els.clearForm?.addEventListener('click', () => {
    els.form?.reset();
    updateCounter();
    clearOutputs();
    hideError();
    idleStepper();
    stopEta();
    state.lastArtifacts = null;
    localStorage.removeItem('lastArtifacts');
    localStorage.removeItem('lastPayload');
    setStatus('statusFormCleared', 'success');
  });

  function getLicensePlan() {
    try {
      const p = JSON.parse(localStorage.getItem(PRO_KEY) || '{}');
      if (!p.active) return null;
      if (p.validUntil && new Date(p.validUntil) < new Date()) return null;
      return (p.plan === 'max') ? 'max' : 'pro';
    } catch { return null; }
  }

  function getPlan() {
    const lic = getLicensePlan();
    if (lic) return lic;
    if (localStorage.getItem(EMAIL_KEY)) return 'email';
    return 'anon';
  }

  function isPro() { return getLicensePlan() !== null; }

  // ============================================================
  // License revalidation (runs on page load, max once per 24h)
  // ============================================================
  async function revalidateLicense() {
    let rec;
    try { rec = JSON.parse(localStorage.getItem(PRO_KEY) || '{}'); } catch { return; }
    if (!rec.active || !rec.licenseKey) return;

    const lastCheck = rec.lastCheck ? new Date(rec.lastCheck).getTime() : 0;
    const fresh = Date.now() - lastCheck < 24 * 60 * 60 * 1000;
    if (fresh) return;

    try {
      const res = await fetch('/.netlify/functions/verify-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: rec.licenseKey,
          deviceId: getDeviceId()
        })
      });
      const data = await res.json();

      // If server says invalid (expired / blacklisted / limit) → clear local pro record
      if (!data.valid) {
        console.warn('[license] revalidate invalid:', data.reason);
        if (['expired', 'blacklisted', 'activation_limit_exceeded'].includes(data.reason)) {
          localStorage.removeItem(PRO_KEY);
          updateQuotaPill();
        }
        return;
      }

      // Valid — sync local record with server
      if (data.plan) rec.plan = data.plan;
      rec.validUntil    = data.validUntil    || rec.validUntil;
      rec.activeDevices = data.activeDevices || rec.activeDevices;
      rec.deviceLimit   = data.deviceLimit   || rec.deviceLimit;
      rec.lastCheck = new Date().toISOString();
      localStorage.setItem(PRO_KEY, JSON.stringify(rec));
      updateQuotaPill();
    } catch (e) {
      console.warn('[license] revalidate failed, staying optimistic', e);
    }
  }

  // ============================================================
  // License activation (user pastes license key)
  // ============================================================
  async function activateLicense(licenseKey) {
    try {
      const res = await fetch('/.netlify/functions/verify-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          deviceId: getDeviceId()
        })
      });
      const data = await res.json();

      if (!data.valid) {
        if (data.reason === 'activation_limit_exceeded') {
          setStatusText(
            `❌ 此 license 已於 ${data.activeCount}/${data.limit} 部裝置啟用。請先喺其他裝置登出，或聯絡 support。`,
            'error'
          );
          trackEvent('License Activation Failed', { reason: 'limit_exceeded' });
          return false;
        }
        if (data.reason === 'blacklisted') {
          setStatusText('❌ 此 license 已被停用（退款或取消）', 'error');
          return false;
        }
        if (data.reason === 'expired') {
          setStatusText('❌ 此 license 已過期，請續訂', 'error');
          return false;
        }
        setStatusText(t('statusLicenseInvalid') || '❌ License key 無效', 'error');
        return false;
      }

      // ✅ Success
      const plan = (data.plan === 'max') ? 'max' : 'pro';
      localStorage.setItem(PRO_KEY, JSON.stringify({
        active: true,
        plan,
        validUntil: data.validUntil,
        email: data.customerEmail,
        licenseKey,
        deviceId: getDeviceId(),
        activeDevices: data.activeDevices,
        deviceLimit: data.deviceLimit,
        lastCheck: new Date().toISOString(),
      }));

      // Fresh start: reset quota counters on successful upgrade
      const q = loadQuota();
      q.weekCount = 0;
      q.monthCount = 0;
      saveQuota(q);

      updateQuotaPill();
      closeUpgradeModal();
      setStatus('statusLicenseActivated', 'success');
      trackEvent('License Activated', {
        plan,
        activeDevices: data.activeDevices,
        deviceLimit: data.deviceLimit
      });
      return true;
    } catch (e) {
      console.error('[license]', e);
      setStatusText(t('statusLicenseError') || 'License verification failed', 'error');
      return false;
    }
  }

  els.haveLicenseBtn?.addEventListener('click', async () => {
    const key = prompt(t('promptLicenseKey'));
    if (!key) return;
    const cleaned = key.trim();
    if (cleaned.length < 8) {
      setStatusText(t('statusLicenseInvalid'), 'error');
      return;
    }
    await activateLicense(cleaned);
  });

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function weekStr() {
    const d = new Date();
    const onejan = new Date(d.getFullYear(), 0, 1);
    const wk = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
    return d.getFullYear() + '-W' + String(wk).padStart(2, '0');
  }
  function monthStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  async function getFingerprint() {
    try {
      const raw = [
        navigator.userAgent, navigator.language,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 0, navigator.platform
      ].join('|');
      const buf = new TextEncoder().encode(raw);
      const hash = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash)).slice(0, 12)
        .map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { return ''; }
  }

  function loadQuota() {
    let q;
    try { q = JSON.parse(localStorage.getItem(QUOTA_KEY) || '{}'); } catch { q = {}; }
    const t_ = todayStr(), w_ = weekStr(), m_ = monthStr();
    if (q.day   !== t_) { q.day = t_;   q.dayCount = 0; }
    if (q.week  !== w_) { q.week = w_;  q.weekCount = 0; }
    if (q.month !== m_) { q.month = m_; q.monthCount = 0; }
    return q;
  }
  function saveQuota(q) { localStorage.setItem(QUOTA_KEY, JSON.stringify(q)); }

  function incrementQuota() {
    const q = loadQuota();
    q.dayCount   = (q.dayCount   || 0) + 1;
    q.weekCount  = (q.weekCount  || 0) + 1;
    q.monthCount = (q.monthCount || 0) + 1;
    saveQuota(q);
    updateQuotaPill();
  }

  function checkQuota() {
    const plan = getPlan();
    const L = PLANS[plan];
    const q = loadQuota();
    if (L.daily   !== null && (q.dayCount   || 0) >= L.daily)   return { ok: false, reason: 'daily',   plan, limits: L };
    if (L.weekly  !== null && (q.weekCount  || 0) >= L.weekly)  return { ok: false, reason: 'weekly',  plan, limits: L };
    if (L.monthly !== null && (q.monthCount || 0) >= L.monthly) return { ok: false, reason: 'monthly', plan, limits: L };
    return { ok: true, reason: null, plan, limits: L };
  }
  function canRun() { return checkQuota().ok; }

  function updateQuotaPill() {
    if (!els.quotaPill) return;
    const plan = getPlan();
    const L = PLANS[plan] || PLANS.anon;
    const q = loadQuota();

    if (plan === 'pro' || plan === 'max') {
      els.quotaPill.className = 'quota-pill pro';
      let used = 0, lim = 0, periodLbl = '';
      if (plan === 'pro') {
        used = Number(q.weekCount) || 0;
        lim = Number(L.weekly) || 10;
        periodLbl = '/wk';
      } else {
        used = Number(q.monthCount) || 0;
        lim = Number(L.monthly) || 60;
        periodLbl = '/mo';
      }
      const remain = Math.max(0, lim - used);
      const label = L.label || (plan === 'pro' ? 'Pro' : 'Max');
      els.quotaPill.innerHTML =
        `<span class="quota-label">${label}</span> ` +
        `<span id="quotaCount">${remain}</span>` +
        `<span id="quotaLimit" style="display:none">${lim}</span>` +
        `<span class="quota-period">${periodLbl}</span>`;
      els.quotaPill.title = `${label} · ${remain} runs left ${periodLbl}`;
      if (remain === 0) els.quotaPill.classList.add('full');
      else if (remain <= 1) els.quotaPill.classList.add('warn');
      return;
    }

    els.quotaPill.className = 'quota-pill';
    const used = Number(q.dayCount) || 0;
    const lim = Number(L.daily) || 1;

    if (!els.quotaPill.querySelector('#quotaCount') ||
        !els.quotaPill.querySelector('#quotaLimit') ||
        els.quotaPill.querySelector('.quota-period')) {
      els.quotaPill.innerHTML =
        `<span id="quotaCount">${used}</span>/<span id="quotaLimit">${lim}</span> ` +
        `<span class="quota-label" data-i18n="quotaToday">today</span>`;
      els.quotaCount = document.getElementById('quotaCount');
      els.quotaLimit = document.getElementById('quotaLimit');
    } else {
      if (els.quotaCount) els.quotaCount.textContent = used;
      if (els.quotaLimit) els.quotaLimit.textContent = lim;
    }

    if (used >= lim) els.quotaPill.classList.add('full');
    else if (used >= lim - 1) els.quotaPill.classList.add('warn');
    const remaining = Math.max(0, lim - used);
    els.quotaPill.title = `${plan === 'anon' ? 'Free' : 'Starter'} · ${remaining} left today`;
  }

  function registerEmail(email) {
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) { setStatusText('Invalid email', 'error'); return false; }
    localStorage.setItem(EMAIL_KEY, email);
    track('Email Registered', { plan: 'Starter' });
    updateQuotaPill();
    setStatusText('Starter unlocked: 3 runs/day ✓', 'success');
    return true;
  }
  window.registerEmail = registerEmail;

  function openUpgradeModal() {
    if (!els.upgradeModal) return;
    const titleEl = document.getElementById('upgradeTitleH3');
    const subEl = els.upgradeModal.querySelector('.modal-sub');
    const g = checkQuota();
    const plan = getPlan();

    if (!g.ok) {
      if (titleEl) titleEl.textContent = t('upgradeTitle');
      if (subEl) subEl.textContent = t('upgradeSub');
    } else if (plan === 'pro' || plan === 'max') {
      if (titleEl) titleEl.textContent = t('upgradeTitleManage');
      if (subEl) subEl.textContent = t('upgradeSubManage');
    } else {
      if (titleEl) titleEl.textContent = t('upgradeTitleExplore');
      if (subEl) subEl.textContent = t('upgradeSubExplore');
    }

    els.upgradeModal.hidden = false;
    els.upgradeModal.setAttribute('aria-hidden', 'false');
  }

  function closeUpgradeModal() {
    if (!els.upgradeModal) return;
    els.upgradeModal.hidden = true;
    els.upgradeModal.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', closeUpgradeModal);
  });

  els.quotaPill?.addEventListener('click', () => {
    const g = checkQuota();
    openUpgradeModal();
    trackEvent('Quota Pill Clicked', {
      plan: getPlan(),
      quotaFull: !g.ok,
      lang: state.lang,
    });
  });

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem('history') || '[]'); } catch { return []; }
  }
  function saveHistory(list) { localStorage.setItem('history', JSON.stringify(list.slice(0, HISTORY_MAX))); }
  function addToHistory(payload, artifacts) {
    const list = loadHistory();
    list.unshift({ id: Date.now(), title: (payload.meetingTitle || '').trim() || '(untitled)', at: new Date().toISOString(), payload, artifacts });
    saveHistory(list);
  }

  function renderHistory() {
    if (!els.historyList) return;
    const list = loadHistory();
    els.historyList.innerHTML = '';
    if (els.historyEmpty) els.historyEmpty.hidden = list.length > 0;
    list.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.dataset.id = item.id;
      const d = new Date(item.at);
      const dateStr = d.toLocaleString(state.lang === 'zh-Hant' ? 'zh-HK' : 'en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      li.innerHTML = `
        <button class="history-item-del" title="Delete" data-del="${item.id}">✕</button>
        <div class="history-item-title">${escapeHtml(item.title)}</div>
        <div class="history-item-meta">${dateStr}</div>
      `;
      els.historyList.appendChild(li);
    });
  }

  function openDrawer() {
    if (!els.historyDrawer) return;
    renderHistory();
    els.historyDrawer.hidden = false;
    if (els.drawerOverlay) els.drawerOverlay.hidden = false;
    els.historyDrawer.setAttribute('aria-hidden', 'false');
  }
  function closeDrawerFn() {
    if (!els.historyDrawer) return;
    els.historyDrawer.hidden = true;
    if (els.drawerOverlay) els.drawerOverlay.hidden = true;
    els.historyDrawer.setAttribute('aria-hidden', 'true');
  }

  els.historyBtn?.addEventListener('click', openDrawer);
  els.closeDrawer?.addEventListener('click', closeDrawerFn);
  els.drawerOverlay?.addEventListener('click', closeDrawerFn);

  els.clearHistoryBtn?.addEventListener('click', () => {
    if (!confirm(t('confirmClearHistory'))) return;
    localStorage.removeItem('history');
    renderHistory();
    setStatus('statusHistoryCleared', 'success');
  });

  els.historyList?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = Number(del.dataset.del);
      const list = loadHistory().filter((x) => x.id !== id);
      saveHistory(list);
      renderHistory();
      return;
    }
    const item = e.target.closest('.history-item');
    if (!item) return;
    const id = Number(item.dataset.id);
    const rec = loadHistory().find((x) => x.id === id);
    if (!rec) return;
    els.meetingTitle.value = rec.payload.meetingTitle || '';
    els.meetingType.value = rec.payload.meetingType || 'General';
    els.outputLanguage.value = rec.payload.language || 'English';
    els.outputMode.value = rec.payload.outputMode || 'full_meeting_pack';
    els.notes.value = rec.payload.notes || '';
    updateCounter();
    state.lastPayload = rec.payload;
    state.lastArtifacts = rec.artifacts;
    renderArtifacts(rec.artifacts);
    localStorage.setItem('lastArtifacts', JSON.stringify(rec.artifacts));
    localStorage.setItem('lastPayload', JSON.stringify(rec.payload));
    setStatus('statusHistoryLoaded', 'success');
    closeDrawerFn();
  });

  async function submitWorkflow(payload) {
    if (state.isRunning) return;
    const gate = checkQuota();
    if (!gate.ok) {
      openUpgradeModal();
      setStatus('quotaExhausted', 'error');
      track('Quota Exceeded', { plan: gate.plan, reason: gate.reason, lang: state.lang, source: 'client' });
      return;
    }
    state.isRunning = true;
    setStatus('statusRunning');
    hideError();
    resetStepper();
    markStep('coordinator', 'active');
    startEta();

    if (!state.lastArtifacts && els.summaryOutput) {
      els.summaryOutput.innerHTML = '<div class="skeleton w90"></div><div class="skeleton w60"></div><div class="skeleton w80"></div>';
      els.summaryOutput.classList.remove('empty');
    }

    if (els.submitButton) els.submitButton.disabled = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    let res = null;

    try {
      const fp = await getFingerprint();
      const email = localStorage.getItem(EMAIL_KEY) || '';
      let licenseKey = '';
      try {
        const proRec = JSON.parse(localStorage.getItem(PRO_KEY) || '{}');
        if (proRec.active && proRec.licenseKey) licenseKey = proRec.licenseKey;
      } catch {}

      res = await fetch('/.netlify/functions/multi-agent-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, fp, email, licenseKey }),
        signal: controller.signal
      });

      let data = null;
      try { data = await res.json(); } catch {}

      if (res.status === 429 && data && data.error === 'quota_exceeded') {
        const q = data.quota || {};
        openUpgradeModal();
        setStatus('quotaExhausted', 'error');
        track('Quota Exceeded', {
          plan: q.plan, reason: q.reason || q.period,
          source: 'server', used: q.used, limit: q.limit
        });
        const qLocal = loadQuota();
        if (q.plan === 'anon' || q.plan === 'email') qLocal.dayCount   = Math.max(qLocal.dayCount   || 0, q.used);
        else if (q.plan === 'pro')                   qLocal.weekCount  = Math.max(qLocal.weekCount  || 0, q.used);
        else if (q.plan === 'max')                   qLocal.monthCount = Math.max(qLocal.monthCount || 0, q.used);
        saveQuota(qLocal);
        updateQuotaPill();
        throw Object.assign(new Error(t('quotaExhausted') || 'Quota exceeded'), { handled: true });
      }

      if (!res.ok || (data && data.success === false)) {
        const msg = classifyError(new Error((data && data.error) || 'HTTP ' + res.status), res);
        throw Object.assign(new Error(msg), { handled: true });
      }
      if (!data || !data.artifacts) {
        throw Object.assign(new Error(t('errEmpty')), { handled: true });
      }

      applyTraceToStepper(data.trace);
      const normalized = normalizeArtifacts(data);
      state.lastPayload = payload;
      state.lastArtifacts = normalized;
      renderArtifacts(normalized);
      localStorage.setItem('lastArtifacts', JSON.stringify(normalized));
      localStorage.setItem('lastPayload', JSON.stringify(payload));
      addToHistory(payload, normalized);

      if (data.quota) {
        const qLocal = loadQuota();
        if (data.quota.period === 'daily')   qLocal.dayCount   = data.quota.used;
        if (data.quota.period === 'weekly')  qLocal.weekCount  = data.quota.used;
        if (data.quota.period === 'monthly') qLocal.monthCount = data.quota.used;
        saveQuota(qLocal);
        updateQuotaPill();
      } else {
        incrementQuota();
      }

      setStatus('statusSuccess', 'success');
      track('Run Workflow', {
        lang: state.lang,
        mode: payload.outputMode || 'full_meeting_pack',
        meetingType: payload.meetingType || 'General',
        transcript_length: (payload.notes || '').length,
        plan: getPlan()
      });
    } catch (err) {
      console.error(err);
      const msg = err.handled ? err.message : classifyError(err, res);
      showError(msg);
      setStatusText(msg, 'error');
      track('Run Failed', {
        lang: state.lang,
        mode: payload.outputMode || 'full_meeting_pack',
        status: res && res.status ? res.status : 0,
        reason: (msg || 'unknown').toString().slice(0, 80)
      });
      if (state.lastArtifacts) renderArtifacts(state.lastArtifacts);
      else clearOutputs();
      STEPS.forEach((s) => {
        const el = els.stepper?.querySelector('[data-step="' + s + '"]');
        if (el && !el.classList.contains('done')) el.className = 'step failed';
      });
    } finally {
      clearTimeout(timeoutId);
      stopEta();
      if (els.submitButton) els.submitButton.disabled = false;
      state.isRunning = false;
    }
  }

  els.form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.isRunning) return;
    const notes = els.notes.value.trim();
    if (notes.length < MIN_NOTES) { showError(t('errNotesShort')); return; }
    if (notes.length > MAX_NOTES) { showError(t('errNotesLong')); return; }
    const payload = {
      meetingTitle: els.meetingTitle.value.trim(),
      meetingType: els.meetingType.value,
      outputMode: els.outputMode.value,
      language: els.outputLanguage.value,
      notes
    };
    state.lastPayload = payload;
    submitWorkflow(payload);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      els.form?.requestSubmit();
    } else if (e.key === 'Escape') {
      if (els.historyDrawer && !els.historyDrawer.hidden) closeDrawerFn();
      if (els.errorBanner?.classList.contains('show')) hideError();
      if (els.upgradeModal && !els.upgradeModal.hidden) closeUpgradeModal();
    }
  });

  function restoreLast() {
    try {
      const a = localStorage.getItem('lastArtifacts');
      const p = localStorage.getItem('lastPayload');
      if (a && p) {
        const art = JSON.parse(a);
        const pay = JSON.parse(p);
        state.lastArtifacts = art;
        state.lastPayload = pay;
        els.meetingTitle.value = pay.meetingTitle || '';
        els.meetingType.value = pay.meetingType || 'General';
        els.outputLanguage.value = pay.language || 'English';
        els.outputMode.value = pay.outputMode || 'full_meeting_pack';
        els.notes.value = pay.notes || '';
        updateCounter();
        renderArtifacts(art);
        setStatus('statusRestored', 'success');
      }
    } catch {}
  }

  (function detectCheckoutReturn() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('checkout') === 'success' || params.has('order_id')) {
        track('Checkout Complete', { plan: 'Pro', source: params.get('source') || 'direct' });
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (e) { console.debug('[checkout-detect] failed:', e); }
  })();

  loadLocale(state.lang).then(() => {
    restoreLast();
    updateQuotaPill();
    revalidateLicense();
  });

  updateCounter();
  idleStepper();
  updateQuotaPill();

  /* ========== Mobile enhancements ========== */
  const isMobileView = () => window.matchMedia('(max-width: 768px)').matches;
  const mobileRunBtn = document.getElementById('mobileRunBtn');
  const mobileTabsEl = document.getElementById('mobileTabs');
  const tabSections = document.querySelectorAll('[data-tab-section]');

  function showTab(name) {
    tabSections.forEach((sec) => {
      sec.classList.toggle('tab-active', sec.dataset.tabSection === name);
    });
    mobileTabsEl?.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === name);
    });
  }

  function applyMobileMode() {
    if (isMobileView()) {
      document.body.classList.add('has-mobile-bar', 'tabs-active');
      if (tabSections.length && !document.querySelector('[data-tab-section].tab-active')) {
        showTab('summary');
      }
    } else {
      document.body.classList.remove('has-mobile-bar', 'tabs-active');
      tabSections.forEach((sec) => sec.classList.remove('tab-active'));
      mobileTabsEl?.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    }
  }

  if (mobileRunBtn) {
    mobileRunBtn.addEventListener('click', () => { els.form?.requestSubmit(); });
  }

  mobileTabsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) showTab(btn.dataset.tab);
  });

  if (els.submitButton && mobileRunBtn) {
    const sync = () => { mobileRunBtn.disabled = els.submitButton.disabled; };
    const mo = new MutationObserver(sync);
    mo.observe(els.submitButton, { attributes: true, attributeFilter: ['disabled'] });
    sync();
  }

  applyMobileMode();
  window.addEventListener('resize', applyMobileMode);
})();
