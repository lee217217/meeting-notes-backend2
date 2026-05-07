/**
 * Meeting Workspace — Device Manager
 * Patch notes (2026-05-07):
 *  1. localStorage key 對齊 → device_id（唔再用 mw_device_id）
 *  2. Auto-detect license key：license_key / licenseKey / mw_license_key / lk
 *  3. Landing page 永遠 show gear ⚙️；冇 license click → 彈提示
 */
(function () {
  'use strict';

  // ---------- Config ----------
  const API = {
    list:       '/.netlify/functions/list-devices',
    deactivate: '/.netlify/functions/deactivate-device',
  };

  const LICENSE_KEYS_TO_TRY = [
    'license_key',
    'licenseKey',
    'mw_license_key',
    'lk',
  ];

  const DEVICE_ID_KEY = 'device_id'; // ✅ 對齊你實際 localStorage

  // ---------- Helpers ----------
  function getLicenseKey() {
    for (const k of LICENSE_KEYS_TO_TRY) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }
    return null;
  }

  function getDeviceId() {
    return localStorage.getItem(DEVICE_ID_KEY) || null;
  }

  function t(zh, en) {
    const lang = (localStorage.getItem('lang') || 'en').startsWith('zh') ? 'zh' : 'en';
    return lang === 'zh' ? zh : en;
  }

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `mw-toast mw-toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2800);
  }

  // ---------- No-license prompt ----------
  function showNoLicensePrompt() {
    const msg = t(
      '你仲未有 license key。請先購買 Pro / Max，或登入已有帳戶。',
      'No license key found. Please purchase Pro / Max, or sign in with an existing account.'
    );
    const goPricing = confirm(msg + '\n\n' + t('前往 Pricing 頁？', 'Go to Pricing page?'));
    if (goPricing) window.location.href = '/pricing.html';
  }

  // ---------- Modal ----------
  function ensureModal() {
    let modal = document.getElementById('mwDeviceModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'mwDeviceModal';
    modal.className = 'mw-modal-backdrop';
    modal.innerHTML = `
      <div class="mw-modal">
        <div class="mw-modal-header">
          <h3>${t('裝置管理', 'Device Management')}</h3>
          <button class="mw-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="mw-modal-body">
          <div id="mwDeviceList" class="mw-device-list">
            <div class="mw-loading">${t('載入中…', 'Loading…')}</div>
          </div>
        </div>
        <div class="mw-modal-footer">
          <small id="mwDeviceCount"></small>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.mw-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    return modal;
  }

  function openModal() {
    const licenseKey = getLicenseKey();
    if (!licenseKey) { showNoLicensePrompt(); return; }

    const modal = ensureModal();
    modal.classList.add('open');
    loadDevices(licenseKey);
  }

  function closeModal() {
    const modal = document.getElementById('mwDeviceModal');
    if (modal) modal.classList.remove('open');
  }

  // ---------- Load / Render ----------
  async function loadDevices(licenseKey) {
    const listEl = document.getElementById('mwDeviceList');
    const countEl = document.getElementById('mwDeviceCount');
    const currentDeviceId = getDeviceId();

    listEl.innerHTML = `<div class="mw-loading">${t('載入中…', 'Loading…')}</div>`;

    try {
      const res = await fetch(API.list, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey, device_id: currentDeviceId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');

      renderDevices(data.devices || [], currentDeviceId, licenseKey);
      countEl.textContent = t(
        `${data.devices.length} / ${data.limit} 個裝置`,
        `${data.devices.length} / ${data.limit} devices`
      );
    } catch (err) {
      listEl.innerHTML = `<div class="mw-error">${t('載入失敗', 'Failed to load')}: ${err.message}</div>`;
    }
  }

  function renderDevices(devices, currentDeviceId, licenseKey) {
    const listEl = document.getElementById('mwDeviceList');
    if (!devices.length) {
      listEl.innerHTML = `<div class="mw-empty">${t('未有已啟用裝置', 'No active devices')}</div>`;
      return;
    }

    listEl.innerHTML = devices.map((d) => {
      const isCurrent = d.device_id === currentDeviceId;
      const name = d.user_agent ? shortUA(d.user_agent) : d.device_id;
      const lastSeen = d.last_seen ? new Date(d.last_seen).toLocaleString() : '—';
      return `
        <div class="mw-device-row">
          <div class="mw-device-info">
            <div class="mw-device-name">
              ${name}
              ${isCurrent ? `<span class="mw-badge-current">${t('當前裝置', 'Current')}</span>` : ''}
            </div>
            <div class="mw-device-meta">${t('上次使用', 'Last used')}: ${lastSeen}</div>
          </div>
          <button class="mw-btn-remove" data-device-id="${d.device_id}" data-is-current="${isCurrent}">
            ${t('移除', 'Remove')}
          </button>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.mw-btn-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const did = btn.getAttribute('data-device-id');
        const isCurrent = btn.getAttribute('data-is-current') === 'true';
        handleRemove(licenseKey, did, isCurrent);
      });
    });
  }

  function shortUA(ua) {
    if (/iPhone|Android/i.test(ua)) return ua.match(/iPhone|Android/i)[0] + ' device';
    if (/Mac/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows';
    return ua.slice(0, 40);
  }

  async function handleRemove(licenseKey, deviceId, isCurrent) {
    const warn = isCurrent
      ? t('呢個係你當前裝置，移除後會自動登出。繼續？', 'This is your current device. Removing will log you out. Continue?')
      : t('確定移除呢個裝置？', 'Remove this device?');
    if (!confirm(warn)) return;

    try {
      const res = await fetch(API.deactivate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey, device_id: deviceId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');

      toast(t('已移除裝置', 'Device removed'), 'success');

      if (isCurrent) {
        LICENSE_KEYS_TO_TRY.forEach((k) => localStorage.removeItem(k));
        setTimeout(() => { window.location.href = '/'; }, 1200);
      } else {
        loadDevices(licenseKey);
      }
    } catch (err) {
      toast(t('移除失敗', 'Remove failed') + ': ' + err.message, 'error');
    }
  }

  // ---------- Init ----------
  function init() {
    const gear = document.getElementById('deviceGearBtn');
    if (!gear) { console.warn('[MW] #deviceGearBtn not found'); return; }

    // ✅ Landing page 永遠 show gear（用戶 A 選項）
    gear.style.display = '';
    gear.removeAttribute('hidden');

    gear.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose
  window.MeetingWorkspaceDeviceManager = {
    open: openModal,
    close: closeModal,
    getLicenseKey,
    getDeviceId,
  };
})();