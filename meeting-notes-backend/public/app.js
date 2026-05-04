// ──────────────────────────────────────────────
// Umami Analytics helper
// 用 track('Event Name', { prop: 'value' }) 嚟發送
// 守衛：如果 script 未 load / ad-blocker 擋到 → 唔會炸
// ──────────────────────────────────────────────
function track(eventName, eventData) {
  try {
    if (typeof window !== 'undefined' && window.umami && typeof window.umami.track === 'function') {
      if (eventData) {
        window.umami.track(eventName, eventData);
      } else {
        window.umami.track(eventName);
      }
    }
  } catch (err) {
    // 靜默失敗，analytics 唔應該影響產品
    console.debug('[track] failed:', err);
  }
}
(function () {
  const STEPS = ['coordinator', 'summarizer', 'action_item_agent', 'followup_email_agent', 'qa_review_agent'];
  const SUPPORTED = ['en', 'zh-Hant'];
  const MAX_FILE_SIZE = 2 * 1024 * 1024;
  const MAX_NOTES = 20000;
  const MIN_NOTES = 30;
  const HISTORY_MAX = 20;
  const ETA_SECONDS = 30;
  const QUOTA_LIMIT = 3;
  const QUOTA_KEY = 'quota';
  const PRO_KEY = 'pro';

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
    dict: {},
    lastPayload: null,
    lastArtifacts: null,
    isRunning: false,
    etaTimer: null
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    form: $('form'),
    meetingTitle: $('meetingTitle'),
    meetingType: $('meetingType'),
    outputLanguage: $('outputLanguage'),
    outputMode: $('outputMode'),
    notes: $('notes'),
    submitButton: $('submitButton'),
    loadSample: $('loadSample'),
    clearForm: $('clearForm'),
    copyMarkdown: $('copyMarkdown'),
    copyEmail: $('copyEmail'),
    downloadMd: $('downloadMd'),
    themeToggle: $('themeToggle'),
    historyBtn: $('historyBtn'),
    status: $('status'),
    summaryOutput: $('summaryOutput'),
    decisionsOutput: $('decisionsOutput'),
    actionsOutput: $('actionsOutput'),
    emailOutput: $('emailOutput'),
    stepper: $('stepper'),
    etaLine: $('etaLine'),
    etaSec: $('etaSec'),
    errorBanner: $('errorBanner'),
    errorBannerText: $('errorBannerText'),
    retryButton: $('retryButton'),
    notesCounter: $('notesCounter'),
    notesCount: $('notesCount'),
    dropZone: $('dropZone'),
    fileInput: $('fileInput'),
    autoCleanBtn: $('autoCleanBtn'),
    shortcutKbd: $('shortcutKbd'),
    historyDrawer: $('historyDrawer'),
    drawerOverlay: $('drawerOverlay'),
    closeDrawer: $('closeDrawer'),
    historyList: $('historyList'),
    historyEmpty: $('historyEmpty'),
    clearHistoryBtn: $('clearHistory'),
    quotaPill: $('quotaPill'),
    quotaCount: $('quotaCount'),
    quotaLimit: $('quotaLimit'),
    upgradeModal: $('upgradeModal'),
    haveLicenseBtn: $('haveLicenseBtn')
  };

  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  if (els.shortcutKbd) els.shortcutKbd.textContent = isMac ? '⌘ + ↵' : 'Ctrl + Enter';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function t(k) {
    return (state.dict && state.dict[k]) || k;
  }

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
      if (typeof it === 'string') {
        li.textContent = it;
        els.actionsOutput.appendChild(li);
        return;
      }
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
    if (text && text.trim()) {
      el.textContent = text;
      el.classList.remove('empty');
    } else {
      el.textContent = t(emptyKey);
      el.classList.add('empty');
    }
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
    setTimeout(() => {
      btn.classList.remove('copied');
      span.textContent = old;
    }, 1600);
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
        if (typeof it === 'string') {
          lines.push('- ' + it);
        } else {
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
    } catch {
      setStatus('statusCopyFailed', 'error');
    }
  }

  els.copyMarkdown?.addEventListener('click', (e) => copyText(buildMarkdown(), e.currentTarget, 'statusCopiedMd'));
  els.copyEmail?.addEventListener('click', (e) => copyText((state.lastArtifacts && state.lastArtifacts.follow_up_email) || '', e.currentTarget, 'statusCopiedEmail'));

  els.downloadMd?.addEventListener('click', () => {
    const md = buildMarkdown();
    if (!md) { setStatus('statusNothingToCopy', 'error'); return; }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const title = (state.lastPayload && state.lastPayload.meetingTitle) || 'meeting';
    a.href = url;
    a.download = title.replace(/[^\w\u4e00-\u9fff-]+/g, '-').slice(0, 60) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus('statusDownloaded', 'success');
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
    if (file.size > MAX_FILE_SIZE) {
      showError(t('errFileTooBig') + ' (' + Math.round(file.size / 1024) + 'KB)');
      return;
    }
    const name = (file.name || '').toLowerCase();
    const isText = /\.(txt|md|vtt)$/.test(name) || /^text\//.test(file.type || '');
    if (!isText) { showError(t('errFileType')); return; }
    try {
      const raw = await file.text();
      let content = raw;
      if (name.endsWith('.vtt')) content = cleanTranscript(raw);
      if (content.length > MAX_NOTES) {
        content = content.slice(0, MAX_NOTES);
        setStatusText(t('statusTruncated'), 'success');
      } else {
        setStatusText(t('statusImported').replace('{name}', file.name), 'success');
      }
      els.notes.value = content;
      updateCounter();
      hideError();
    } catch {
      showError(t('errFileRead'));
    }
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

  function isPro() {
    try {
      const p = JSON.parse(localStorage.getItem(PRO_KEY) || '{}');
      if (!p.active) return false;
      if (p.validUntil && new Date(p.validUntil) < new Date()) return false;
      return true;
    } catch { return false; }
  }

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
        body: JSON.stringify({ licenseKey: rec.licenseKey })
      });
      const data = await res.json();
      if (!data || !data.valid) {
        console.warn('[license] revoked on revalidate:', data && data.reason);
        localStorage.removeItem(PRO_KEY);
        updateQuotaPill();
        setStatusText(t('statusLicenseRevoked') + (data?.reason ? ' (' + data.reason + ')' : ''), 'error');
        return;
      }
      rec.validUntil = data.validUntil || rec.validUntil;
      rec.lastCheck = new Date().toISOString();
      localStorage.setItem(PRO_KEY, JSON.stringify(rec));
    } catch (e) {
      console.warn('[license] revalidate failed, staying optimistic', e);
    }
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function loadQuota() {
    try {
      const q = JSON.parse(localStorage.getItem(QUOTA_KEY) || '{}');
      if (q.date !== todayStr()) return { date: todayStr(), count: 0, limit: QUOTA_LIMIT };
      return { date: q.date, count: q.count || 0, limit: QUOTA_LIMIT };
    } catch { return { date: todayStr(), count: 0, limit: QUOTA_LIMIT }; }
  }

  function saveQuota(q) { localStorage.setItem(QUOTA_KEY, JSON.stringify(q)); }

  function incrementQuota() {
    const q = loadQuota();
    q.count += 1;
    saveQuota(q);
    updateQuotaPill();
  }

  function canRun() {
    if (isPro()) return true;
    const q = loadQuota();
    return q.count < QUOTA_LIMIT;
  }

  function updateQuotaPill() {
    if (!els.quotaPill) return;
    if (isPro()) {
      els.quotaPill.className = 'quota-pill pro';
      els.quotaPill.innerHTML = '✨ <span class="quota-label">' + t('proActive') + '</span>';
      els.quotaPill.title = t('proActive');
      return;
    }
    const q = loadQuota();
    els.quotaPill.className = 'quota-pill';
    if (els.quotaCount) els.quotaCount.textContent = q.count;
    if (els.quotaLimit) els.quotaLimit.textContent = QUOTA_LIMIT;
    if (q.count >= QUOTA_LIMIT) els.quotaPill.classList.add('full');
    else if (q.count >= QUOTA_LIMIT - 1) els.quotaPill.classList.add('warn');
    els.quotaPill.title = t('quotaRemaining').replace('{n}', Math.max(0, QUOTA_LIMIT - q.count));
  }

  function openUpgradeModal() {
    if (!els.upgradeModal) return;
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
    if (isPro()) return;
    const q = loadQuota();
    if (q.count >= QUOTA_LIMIT) openUpgradeModal();
  });

  async function activateLicense(licenseKey) {
    setStatus('statusVerifyingLicense');
    try {
      const res = await fetch('/.netlify/functions/verify-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey })
      });
      const data = await res.json();

      if (!data || !data.valid) {
        const reason = (data && data.reason) ? ' (' + data.reason + ')' : '';
        setStatusText(t('statusLicenseInvalid') + reason, 'error');
        return false;
      }

      localStorage.setItem(PRO_KEY, JSON.stringify({
        active: true,
        validUntil: data.validUntil,
        email: data.customerEmail || '',
        licenseKey,
        lastCheck: new Date().toISOString()
      }));

      updateQuotaPill();
      closeUpgradeModal();
      setStatus('statusLicenseActivated', 'success');
      return true;
    } catch (e) {
      console.error('[license]', e);
      setStatusText(t('statusLicenseError'), 'error');
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

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem('history') || '[]'); }
    catch { return []; }
  }

  function saveHistory(list) {
    localStorage.setItem('history', JSON.stringify(list.slice(0, HISTORY_MAX)));
  }

  function addToHistory(payload, artifacts) {
    const list = loadHistory();
    list.unshift({
      id: Date.now(),
      title: (payload.meetingTitle || '').trim() || '(untitled)',
      at: new Date().toISOString(),
      payload,
      artifacts
    });
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
    if (!canRun()) {
      openUpgradeModal();
      setStatus('quotaExhausted', 'error');
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
      res = await fetch('/.netlify/functions/multi-agent-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      let data = null;
      try { data = await res.json(); } catch {}

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
      if (!isPro()) incrementQuota();
      setStatus('statusSuccess', 'success');
    } catch (err) {
      console.error(err);
      const msg = err.handled ? err.message : classifyError(err, res);
      showError(msg);
      setStatusText(msg, 'error');
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
      // 手機：只顯示 active tab
      if (tabSections.length && !document.querySelector('[data-tab-section].tab-active')) {
        showTab('summary');
      }
    } else {
      document.body.classList.remove('has-mobile-bar', 'tabs-active');
      // 桌面：清除 tab-active，還原全部顯示
      tabSections.forEach((sec) => sec.classList.remove('tab-active'));
      mobileTabsEl?.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    }
  }

  if (mobileRunBtn) {
    mobileRunBtn.addEventListener('click', () => {
      els.form?.requestSubmit();
    });
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