/**
 * Meeting Workspace — Device Manager
 * Patch 2026-05-07 (14:50): Fix modal backdrop blocking nav buttons
 */
(function () {
  'use strict';

  const API = {
    list:       '/.netlify/functions/list-devices',
    deactivate: '/.netlify/functions/deactivate-device',
  };

  const LICENSE_KEYS_TO_TRY = ['license_key', 'licenseKey', 'mw_license_key', 'lk'];
  const DEVICE_ID_KEY = 'device_id';

  function getLicenseKey() {
    for (const k of LICENSE_KEYS_TO_TRY) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }
    return null;
  }
  function getDeviceId() { return localStorage.getItem(DEVICE_ID_KEY) || null; }

  function t(zh, en) {
    const lang = (localStorage.getItem('lang') || 'en').startsWith('zh') ? 'zh' : 'en';
    return lang === 'zh' ? zh : en;
  }

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `mw-toast mw-toast-${type}`;
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'fixed', bottom: '24px', left: '50%',
      transform: 'translateX(-50%)', zIndex: 10001,
      background: type === 'error' ? '#dc2626' : '#111',
      color: '#fff', padding: '10px 18px', borderRadius: '8px',
      fontSize: '14px', opacity: '0', transition: 'opacity .2s',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = '1'));
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2800);
  }

  function showNoLicensePrompt() {
    const msg = t(
      '你仲未有 license key。請先購買 Pro / Max，或登入已有帳戶。',
      'No license key found. Please purchase Pro / Max, or sign in.'
    );
    if (confirm(msg + '\n\n' + t('前往 Pricing 頁？', 'Go to Pricing page?'))) {
      window.location.href = '/pricing.html';
    }
  }

  // ---------- Modal (lazy) ----------
  let modalEl = null;

  function buildModal() {
    if (modalEl) return modalEl;

    modalEl = document.createElement('div');
    modalEl.id = 'mwDeviceModal';
    modalEl.className = 'mw-modal-backdrop';

    // ⚠️ Inline safety：確保未 open 時絕對唔阻擋其他 button
    Object.assign(modalEl.style, {
      display: 'none',
      pointerEvents: 'none',
      position: 'fixed',
      inset: '0',
      zIndex: '9999',
      background: 'rgba(0,0,0,.5)',
      alignItems: 'center',
      justifyContent: 'center',
    });

    modalEl.innerHTML = `
      <div class="mw-modal" style="background:#fff;max-width:520px;width:92%;border-radius:12px;pointer-events:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;">
        <div class="mw-modal-header" style="padding:16px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:17px;">${t('裝置管理', 'Device Management')}</h3>
          <button class="mw-modal-close" aria-label="Close" style="background:none;border:0;font-size:24px;cursor:pointer;line-height:1;">&times;</button>
        </div>
        <div class="mw-modal-body" style="padding:16px 20px;max-height:60vh;overflow:auto;">
          <div id="mwDeviceList"><div class="mw-loading">${t('載入中…', 'Loading…')}</div></div>
        </div>
        <div class="mw-modal-footer" style="padding:12px 20px;border-top:1px solid #eee;text-align:right;">
          <small id="mwDeviceCount" style="color:#666;"></small>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector('.mw-modal-close').addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });

    return modalEl;
  }

  function openModal() {
    const licenseKey = getLicenseKey();
    if (!licenseKey) { showNoLicensePrompt(); return; }

    const m = buildModal();
    m.style.display = 'flex';
    m.style.pointerEvents = 'auto';
    m.classList.add('open');
    loadDevices(licenseKey);
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.style.display = 'none';
    modalEl.style.pointerEvents = 'none';
    modalEl.classList.remove('open');
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
      listEl.innerHTML = `<div class="mw-error" style="color:#dc2626;">${t('載入失敗', 'Failed to load')}: ${err.message}</div>`;
    }
  }

  function shortUA(ua) {
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    if (/Mac/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows';
    return (ua || '').slice(0, 40);
  }

  function renderDevices(devices, currentDeviceId, licenseKey) {
    const listEl = document.getElementById('mwDeviceList');
    if (!devices.length) {
      listEl.innerHTML = `<div class="mw-empty" style="color:#666;text-align:center;padding:20px;">${t('未有已啟用裝置', 'No active devices')}</div>`;
      return;
    }
    listEl.innerHTML = devices.map((d) => {
      const isCurrent = d.device_id === currentDeviceId;
      const name = shortUA(d.user_agent) || d.device_id;
      const lastSeen = d.last_seen ? new Date(d.last_seen).toLocaleString() : '—';
      return `
        <div class="mw-device-row" style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f0f0f0;">
          <div>
            <div style="font-weight:600;">
              ${name}
              ${isCurrent ? `<span style="margin-left:6px;background:linear-gradient(90deg,#6366f1,#a855f7);color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;">${t('當前裝置', 'Current')}</span>` : ''}
            </div>
            <div style="font-size:12px;color:#888;">${t('上次使用', 'Last used')}: ${lastSeen}</div>
          </div>
          <button class="mw-btn-remove" data-device-id="${d.device_id}" data-is-current="${isCurrent}"
            style="background:#fee2e2;color:#dc2626;border:0;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;">
            ${t('移除', 'Remove')}
          </button>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.mw-btn-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        handleRemove(licenseKey, btn.dataset.deviceId, btn.dataset.isCurrent === 'true');
      });
    });
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

    // Landing page 永遠 show gear
    gear.style.display = '';
    gear.removeAttribute('hidden');

    // ⚠️ 只 bind gear 自己，唔 touch 其他 button
    gear.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal();
    });

    // ⚠️ 唔喺 init 就 append modal，避免蓋住 UI
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MeetingWorkspaceDeviceManager = { open: openModal, close: closeModal, getLicenseKey, getDeviceId };
})();