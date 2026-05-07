/* ============================================================
 * device-manager.js  |  v1 (2026-05-07)
 * ------------------------------------------------------------
 * Device Manager modal for Meeting Workspace.
 *
 * Usage:
 *   <link rel="stylesheet" href="/device-manager.css">
 *   <script src="/device-manager.js" defer></script>
 *   <button id="deviceGearBtn">⚙️</button>
 *
 * The script:
 *   1. Reads licenseKey + deviceId from localStorage
 *      (keys: 'mw_license_key' and 'mw_device_id').
 *      ⚠️ If your app uses different keys, change the STORAGE_* constants below.
 *   2. Shows the gear button only when a license is present.
 *   3. Opens a modal that lists active devices and lets user remove any.
 * ============================================================ */

(function () {
  'use strict';

  // ⚠️ Adjust these if your app uses different localStorage keys.
  const STORAGE_LICENSE = 'mw_license_key';
  const STORAGE_DEVICE  = 'mw_device_id';

  const API_LIST       = '/.netlify/functions/list-devices';
  const API_DEACTIVATE = '/.netlify/functions/deactivate-device';

  const I18N = {
    en: {
      title: 'Device Manager',
      plan: 'Plan',
      slotsUsed: '{active} of {limit} devices',
      current: 'This device',
      remove: 'Remove',
      firstSeen: 'Activated',
      lastSeen: 'Last used',
      noLicense: 'No license activated. Enter your license key to manage devices.',
      loading: 'Loading devices…',
      errorGeneric: 'Could not load devices. Please try again.',
      errorBlacklisted: 'License has been revoked.',
      errorNotFound: 'License not found.',
      confirmTitle: 'Remove this device?',
      confirmBody: 'This device will no longer be able to use Meeting Workspace with this license. It can be re-activated later.',
      confirmSelf: '⚠️ You are removing YOUR CURRENT DEVICE. You will be signed out and must re-enter your license key.',
      cancel: 'Cancel',
      confirmRemove: 'Yes, remove',
      close: 'Close',
      removed: 'Device removed.',
      removeFailed: 'Could not remove device.',
      rateLimited: 'Too many attempts. Please try again in a few minutes.',
      justNow: 'just now',
      minAgo: '{n} min ago',
      hrAgo: '{n} hr ago',
      daysAgo: '{n} day(s) ago'
    },
    'zh-Hant': {
      title: '裝置管理',
      plan: '方案',
      slotsUsed: '{active} / {limit} 部裝置',
      current: '當前裝置',
      remove: '移除',
      firstSeen: '啟用於',
      lastSeen: '最近使用',
      noLicense: '未啟用授權。請輸入授權碼後再管理裝置。',
      loading: '載入中…',
      errorGeneric: '無法載入裝置清單，請稍後再試。',
      errorBlacklisted: '授權碼已被撤銷。',
      errorNotFound: '找不到此授權碼。',
      confirmTitle: '確認移除此裝置？',
      confirmBody: '呢部裝置將不能再用此授權碼使用 Meeting Workspace。你之後仍可重新啟用。',
      confirmSelf: '⚠️ 你正在移除 自己當前嘅裝置。移除後你需要重新輸入授權碼。',
      cancel: '取消',
      confirmRemove: '確定移除',
      close: '關閉',
      removed: '裝置已移除。',
      removeFailed: '移除失敗，請再試。',
      rateLimited: '操作過於頻繁，請幾分鐘後再試。',
      justNow: '剛剛',
      minAgo: '{n} 分鐘前',
      hrAgo: '{n} 小時前',
      daysAgo: '{n} 日前'
    }
  };

  function getLang() {
    try {
      const saved = localStorage.getItem('lang') || localStorage.getItem('legal_lang');
      if (saved && I18N[saved]) return saved;
      const htmlLang = document.documentElement.getAttribute('lang') || 'en';
      if (htmlLang.toLowerCase().startsWith('zh')) return 'zh-Hant';
    } catch {}
    return 'en';
  }
  function t(key, vars) {
    const dict = I18N[getLang()] || I18N.en;
    let s = dict[key] || I18N.en[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.replace(`{${k}}`, vars[k]); });
    return s;
  }

  function fmtRelative(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1)  return t('justNow');
    if (min < 60) return t('minAgo', { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24)  return t('hrAgo',  { n: hr });
    const d = Math.floor(hr / 24);
    return t('daysAgo', { n: d });
  }

  function getLicense() {
    try {
      return {
        licenseKey: localStorage.getItem(STORAGE_LICENSE) || '',
        deviceId:   localStorage.getItem(STORAGE_DEVICE)  || ''
      };
    } catch { return { licenseKey: '', deviceId: '' }; }
  }

  function umami(name, props) {
    try { if (window.umami && typeof window.umami.track === 'function') window.umami.track(name, props || {}); } catch {}
  }

  async function apiPost(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  // ========== Modal DOM ==========
  let modalEl = null;
  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'dm-overlay';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.innerHTML = `
      <div class="dm-modal">
        <div class="dm-header">
          <h3 class="dm-title"></h3>
          <button class="dm-close" aria-label="Close">✕</button>
        </div>
        <div class="dm-meta"></div>
        <div class="dm-body"><div class="dm-loading"></div></div>
        <div class="dm-toast" hidden></div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });
    modalEl.querySelector('.dm-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalEl.classList.contains('dm-open')) closeModal();
    });
    return modalEl;
  }

  function openModal() {
    ensureModal();
    modalEl.classList.add('dm-open');
    document.body.style.overflow = 'hidden';
    modalEl.querySelector('.dm-title').textContent = t('title');
    modalEl.querySelector('.dm-loading').textContent = t('loading');
    loadAndRender();
    umami('Device Manager Opened');
  }
  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove('dm-open');
    document.body.style.overflow = '';
  }

  function showToast(msg, kind) {
    const el = modalEl.querySelector('.dm-toast');
    el.textContent = msg;
    el.className = `dm-toast dm-toast-${kind || 'info'}`;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 3200);
  }

  async function loadAndRender() {
    const { licenseKey, deviceId } = getLicense();
    const body = modalEl.querySelector('.dm-body');
    const meta = modalEl.querySelector('.dm-meta');

    if (!licenseKey) {
      meta.textContent = '';
      body.innerHTML = `<div class="dm-empty">${t('noLicense')}</div>`;
      return;
    }

    body.innerHTML = `<div class="dm-loading">${t('loading')}</div>`;

    const { status, json } = await apiPost(API_LIST, { licenseKey });

    if (!json.ok) {
      let msg = t('errorGeneric');
      if (json.reason === 'blacklisted') msg = t('errorBlacklisted');
      if (json.reason === 'not_found')   msg = t('errorNotFound');
      body.innerHTML = `<div class="dm-empty dm-error">${msg}</div>`;
      return;
    }

    meta.innerHTML = `
      <span class="dm-chip">${t('plan')}: <b>${String(json.plan || 'pro').toUpperCase()}</b></span>
      <span class="dm-chip">${t('slotsUsed', { active: json.active, limit: json.limit })}</span>
    `;

    if (!json.devices.length) {
      body.innerHTML = `<div class="dm-empty">—</div>`;
      return;
    }

    body.innerHTML = json.devices.map(d => {
      const isCurrent = d.deviceId === deviceId;
      return `
        <div class="dm-device ${isCurrent ? 'dm-current' : ''}" data-id="${d.deviceId}">
          <div class="dm-device-ico">💻</div>
          <div class="dm-device-body">
            <div class="dm-device-name">
              ${d.label}
              ${isCurrent ? `<span class="dm-tag">${t('current')}</span>` : ''}
            </div>
            <div class="dm-device-sub">
              <span>${t('lastSeen')}: ${fmtRelative(d.lastSeen)}</span>
              <span class="dm-dot">·</span>
              <span>${t('firstSeen')}: ${fmtRelative(d.firstSeen)}</span>
            </div>
          </div>
          <button class="dm-btn dm-btn-danger" data-action="remove" data-id="${d.deviceId}" data-current="${isCurrent}">
            ${t('remove')}
          </button>
        </div>
      `;
    }).join('');

    body.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', () => handleRemove(btn.dataset.id, btn.dataset.current === 'true'));
    });
  }

  function handleRemove(deviceIdToRemove, isCurrent) {
    const confirmHtml = `
      <div class="dm-confirm">
        <h4>${t('confirmTitle')}</h4>
        <p>${t('confirmBody')}</p>
        ${isCurrent ? `<p class="dm-warn">${t('confirmSelf')}</p>` : ''}
        <div class="dm-actions">
          <button class="dm-btn dm-btn-ghost" data-action="cancel">${t('cancel')}</button>
          <button class="dm-btn dm-btn-danger" data-action="confirm">${t('confirmRemove')}</button>
        </div>
      </div>
    `;
    const body = modalEl.querySelector('.dm-body');
    const prev = body.innerHTML;
    body.innerHTML = confirmHtml;
    body.querySelector('[data-action="cancel"]').onclick = () => { body.innerHTML = prev; loadAndRender(); };
    body.querySelector('[data-action="confirm"]').onclick = () => doRemove(deviceIdToRemove, isCurrent);
  }

  async function doRemove(deviceIdToRemove, isCurrent) {
    const { licenseKey, deviceId } = getLicense();
    const { status, json } = await apiPost(API_DEACTIVATE, {
      licenseKey,
      deviceId: deviceIdToRemove,
      currentDeviceId: deviceId
    });

    if (status === 429) {
      showToast(t('rateLimited'), 'error');
      loadAndRender();
      return;
    }

    if (!json.ok) {
      showToast(t('removeFailed'), 'error');
      loadAndRender();
      return;
    }

    showToast(t('removed'), 'success');
    umami('Device Removed', {
      selfRemoved: !!json.selfRemoved,
      remaining: json.remaining,
      limit: json.limit,
      plan: json.plan
    });

    if (json.selfRemoved) {
      try {
        localStorage.removeItem(STORAGE_LICENSE);
      } catch {}
      setTimeout(() => {
        closeModal();
        location.reload();
      }, 1500);
      return;
    }

    loadAndRender();
  }

  // ========== Gear button visibility + wire-up ==========
  function wireGearButton() {
    const btn = document.getElementById('deviceGearBtn');
    if (!btn) return;
    const { licenseKey } = getLicense();
    btn.style.display = licenseKey ? '' : 'none';
    btn.addEventListener('click', openModal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireGearButton);
  } else {
    wireGearButton();
  }

  // Expose for programmatic open
  window.MeetingWorkspaceDeviceManager = { open: openModal, close: closeModal };
})();
