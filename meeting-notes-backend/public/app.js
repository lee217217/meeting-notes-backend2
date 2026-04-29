(function () {
  const STEPS = ['coordinator', 'summarizer', 'action_item_agent', 'followup_email_agent', 'qa_review_agent'];
  const SUPPORTED = ['en', 'zh-Hant'];
  const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
  const MAX_NOTES = 20000;
  const MIN_NOTES = 30;

  const state = {
    lang: localStorage.getItem('lang') || (navigator.language.startsWith('zh') ? 'zh-Hant' : 'en'),
    theme: localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    dict: {},
    lastPayload: null,
    lastArtifacts: null
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
    themeToggle: $('themeToggle'),
    status: $('status'),
    summaryOutput: $('summaryOutput'),
    decisionsOutput: $('decisionsOutput'),
    actionsOutput: $('actionsOutput'),
    emailOutput: $('emailOutput'),
    stepper: $('stepper'),
    errorBanner: $('errorBanner'),
    errorBannerText: $('errorBannerText'),
    retryButton: $('retryButton'),
    notesCounter: $('notesCounter'),
    notesCount: $('notesCount'),
    dropZone: $('dropZone'),
    fileInput: $('fileInput'),
    shortcutKbd: $('shortcutKbd')
  };

  // ===== OS detection for shortcut =====
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  if (els.shortcutKbd) {
    els.shortcutKbd.textContent = isMac ? '⌘ + ↵' : 'Ctrl + Enter';
  }

  // ===== i18n =====
  function t(k) { return (state.dict && state.dict[k]) || k; }
  async function loadLocale(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'en';
    try {
      const res = await fetch('/locales/' + lang + '.json', { cache: 'no-cache' });
      state.dict = await res.json();
      state.lang = lang;
      localStorage.setItem('lang', lang);
      document.documentElement.setAttribute('lang', lang === 'zh-Hant' ? 'zh-Hant' : 'en');
      applyTranslations();
      updateLangButtons();
      clearOutputs();
    } catch (e) { console.error('Failed to load locale', e); }
  }
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
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
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.addEventListener('click', () => loadLocale(b.dataset.lang));
  });

  // ===== Theme =====
  function setTheme(th) {
    state.theme = th;
    document.documentElement.setAttribute('data-theme', th);
    localStorage.setItem('theme', th);
  }
  setTheme(state.theme);
  els.themeToggle.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));

  // ===== Counter =====
  function updateCounter() {
    const len = els.notes.value.length;
    els.notesCount.textContent = len.toLocaleString();
    els.notesCounter.classList.toggle('warn', len > 19500 || (len > 0 && len < MIN_NOTES));
  }
  els.notes.addEventListener('input', updateCounter);

  // ===== Status / Error =====
  function setStatus(key, cls) {
    els.status.textContent = key ? t(key) : '';
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }
  function setStatusText(text, cls) {
    els.status.textContent = text || '';
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }
  function showError(msg) {
    els.errorBannerText.textContent = msg;
    els.errorBanner.classList.add('show');
  }
  function hideError() {
    els.errorBanner.classList.remove('show');
    els.errorBannerText.textContent = '';
  }
  els.retryButton.addEventListener('click', () => {
    hideError();
    if (state.lastPayload) submitWorkflow(state.lastPayload);
  });

  // ===== Stepper =====
  function resetStepper() {
    els.stepper.hidden = false;
    STEPS.forEach((name) => {
      const el = els.stepper.querySelector('[data-step="' + name + '"]');
      if (el) el.className = 'step';
    });
  }
  function markStep(name, cls) {
    const el = els.stepper.querySelector('[data-step="' + name + '"]');
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

  // ===== Render =====
  function renderList(el, items, formatter, emptyKey) {
    el.innerHTML = '';
    if (!items || items.length === 0) {
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
    if (text && text.trim()) {
      el.textContent = text;
      el.classList.remove('empty');
    } else {
      el.textContent = t(emptyKey);
      el.classList.add('empty');
    }
  }
  function normalizeArtifacts(data) {
    const a = (data && data.artifacts) || {};
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
    renderList(els.actionsOutput, a.action_items, (it) => {
      if (typeof it === 'string') return it;
      const parts = [it.task || ''];
      if (it.owner) parts.push('Owner: ' + it.owner);
      if (it.due_date) parts.push('Due: ' + it.due_date);
      if (it.priority) parts.push('Priority: ' + it.priority);
      return parts.filter(Boolean).join(' | ');
    }, 'emptyActions');
  }
  function clearOutputs() {
    renderArtifacts({ summary: '', decisions: [], action_items: [], follow_up_email: '' });
  }

  // ===== Copy =====
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
          if (it.owner) d.push('owner: ' + it.owner);
          if (it.due_date) d.push('due: ' + it.due_date);
          if (it.priority) d.push('priority: ' + it.priority);
          lines.push('- ' + d.filter(Boolean).join(' | '));
        }
      });
      lines.push('');
    }
    if (a.follow_up_email) { lines.push('# ' + t('outEmail'), a.follow_up_email); }
    return lines.join('\n').trim();
  }
  async function copyText(text, okKey) {
    if (!text) { setStatus('statusNothingToCopy', 'error'); return; }
    try { await navigator.clipboard.writeText(text); setStatus(okKey, 'success'); }
    catch { setStatus('statusCopyFailed', 'error'); }
  }
  els.copyMarkdown.addEventListener('click', () => copyText(buildMarkdown(), 'statusCopiedMd'));
  els.copyEmail.addEventListener('click', () => copyText((state.lastArtifacts && state.lastArtifacts.follow_up_email) || '', 'statusCopiedEmail'));

  // ===== File import =====
  function cleanVtt(text) {
    // 去掉 WEBVTT header、時間戳、cue index
    return text
      .replace(/^WEBVTT.*$/m, '')
      .replace(/^\d+$/gm, '')
      .replace(/^\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}.*$/gm, '')
      .replace(/<[^>]+>/g, '')
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
    if (!isText) {
      showError(t('errFileType'));
      return;
    }
    try {
      const raw = await file.text();
      let content = raw;
      if (name.endsWith('.vtt')) content = cleanVtt(raw);
      if (content.length > MAX_NOTES) {
        content = content.slice(0, MAX_NOTES);
        setStatusText(t('statusTruncated'), 'success');
      } else {
        setStatusText(t('statusImported').replace('{name}', file.name), 'success');
      }
      els.notes.value = content;
      updateCounter();
      hideError();
    } catch (e) {
      showError(t('errFileRead'));
    }
  }
  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    handleFile(file);
    e.target.value = '';
  });

  // drag & drop
  ['dragenter', 'dragover'].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      els.dropZone.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      els.dropZone.classList.remove('dragging');
    });
  });
  els.dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // ===== Sample / Clear =====
  els.loadSample.addEventListener('click', () => {
    els.meetingTitle.value = t('sampleTitle');
    els.notes.value = t('sampleNotes');
    updateCounter();
  });
  els.clearForm.addEventListener('click', () => {
    els.form.reset();
    updateCounter();
    clearOutputs();
    hideError();
    els.stepper.hidden = true;
    state.lastArtifacts = null;
    setStatus('statusFormCleared', 'success');
  });

  // ===== Submit =====
  async function submitWorkflow(payload) {
    setStatus('statusRunning');
    hideError();
    resetStepper();
    markStep('coordinator', 'active');

    if (!state.lastArtifacts) {
      els.summaryOutput.innerHTML =
        '<div class="skeleton w90"></div><div class="skeleton w60"></div><div class="skeleton w80"></div>';
      els.summaryOutput.classList.remove('empty');
    }

    els.submitButton.disabled = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch('/.netlify/functions/multi-agent-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await res.json();
      if (!res.ok || (data && data.success === false)) throw new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      if (!data || !data.artifacts) throw new Error(t('errEmpty'));

      applyTraceToStepper(data.trace);
      const normalized = normalizeArtifacts(data);
      state.lastArtifacts = normalized;
      renderArtifacts(normalized);
      setStatus('statusSuccess', 'success');
    } catch (err) {
      console.error(err);
      const msg = err && err.name === 'AbortError' ? t('statusTimeout') : (err && err.message) || 'Error';
      showError(msg);
      setStatusText(msg, 'error');
      if (state.lastArtifacts) renderArtifacts(state.lastArtifacts);
      else clearOutputs();
      STEPS.forEach((s) => {
        const el = els.stepper.querySelector('[data-step="' + s + '"]');
        if (el && !el.classList.contains('done')) el.className = 'step failed';
      });
    } finally {
      clearTimeout(timeoutId);
      els.submitButton.disabled = false;
    }
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
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
      els.form.requestSubmit();
    }
  });

  // ===== Init =====
  loadLocale(state.lang);
  updateCounter();
})();