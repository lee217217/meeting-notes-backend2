/**
 * Meeting Workspace — Device Manager
 * Patch 2026-05-07 (15:00): ZERO side-effects — no document/window listeners
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

  function toast(msg, type) {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'fixed', bottom: '24px', left: '50%',
      transform: 'translateX(-50%)', zIndex: '2147483647',
      background: type === 'error' ? '#dc2626' : '#111',
      color: '#fff', padding: '10px 18px', borderRadius: '8px',
      fontSize: '14px', pointerEvents: 'none',
      boxShadow: '0 4px 20px rgba(0,0,0,.3)',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function showNoLicensePrompt() {
    const msg = t(
      '你仲未有 license key。請先購買 Pro / Max。',
      'No license key found. Please purchase Pro / Max.'
    );
    if (confirm(msg + '\n\n' + t('前往 Pricing？', 'Go to Pricing?'))) {
      window.location.href = '/pricing.html';
    }
  }

  // ---------- Modal (lazy, scoped) ----------
  let modalEl = null;

  function buildModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'mwDeviceModal';
    Object.assign(modalEl.style, {
      display: 'none', position: 'fixed', inset: '0',
      zIndex: '2147483000', background: 'rgba(0,0,0,.55)',
      alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    });
    modalEl.innerHTML = `
      <div style="background:#fff;color:#111;max-width:520px;width:92%;border-radius:12px;pointer-events:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;font-family:Inter,-apple-system,sans-serif;">
        <div style="padding:16px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:17px;color:#111;">${t('裝置管理', 'Device Management')}</h3>
          <button id="mwModalClose" aria-label="Close" style="background:none;border:0;font-size:24px;cursor:pointer;line-height:1;color:#111;">&times;</button>
        </div>
        <div style="padding:16px 20px;max-height:60vh;overflow:auto;">
          <div id="mwDeviceList">${t('載入中…', 'Loading…')}</div>
        </div>
        <div style="padding:12px 20px;border-top:1px solid #eee;text-align:right;">
          <small id="mwDeviceCount" style="color:#666;"></small>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    // ✅ 只 bind 呢 2 個 element，絕對唔 touch document
    modalEl.querySelector('#mwModalClose').addEventListener('click', closeModal);
    modalEl.addEventListener('click', function (e) {
      if (e.target === modalEl) closeModal();
    });
    return modalEl;
  }

  function openModal() {
    const licenseKey = getLicenseKey();
    if (!licenseKey) { showNoLicensePrompt(); return; }
    const m = buildModal();
    m.style.display = 'flex';
    m.style.pointerEvents = 'auto';
    loadDevices(licenseKey);
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.style.display = 'none';
    modalEl.style.pointerEvents = 'none';
  }

  async function loadDevices(licenseKey) {
    const listEl = document.getElementById('mwDeviceList');
    const countEl = document.getElementById('mwDeviceCount');
    const currentDeviceId = getDeviceId();
    listEl.innerHTML = t('載入中…', 'Loading…');
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
      listEl.innerHTML = `<div style="color:#dc2626;">${t('載入失敗', 'Failed')}: ${err.message}</div>`;
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
      listEl.innerHTML = `<div style="color:#666;text-align:center;padding:20px;">${t('未有已啟用裝置', 'No active devices')}</div>`;
      return;
    }
    listEl.innerHTML = devices.map(function (d) {
      const isCurrent = d.device_id === currentDeviceId;
      const name = shortUA(d.user_agent) || d.device_id;
      const lastSeen = d.last_seen ? new Date(d.last_seen).toLocaleString() : '—';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f0f0f0;">
          <div>
            <div style="font-weight:600;color:#111;">
              ${name}
              ${isCurrent ? `<span style="margin-left:6px;background:linear-gradient(90deg,#6366f1,#a855f7);color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;">${t('當前裝置', 'Current')}</span>` : ''}
            </div>
            <div style="font-size:12px;color:#888;">${t('上次使用', 'Last used')}: ${lastSeen}</div>
          </div>
          <button class="mw-remove-btn" data-did="${d.device_id}" data-cur="${isCurrent}"
            style="background:#fee2e2;color:#dc2626;border:0;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;">
            ${t('移除', 'Remove')}
          </button>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.mw-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleRemove(licenseKey, btn.dataset.did, btn.dataset.cur === 'true');
      });
    });
  }

  async function handleRemove(licenseKey, deviceId, isCurrent) {
    const warn = isCurrent
      ? t('呢個係當前裝置，移除後會登出。繼續？', 'This is current device. Continue?')
      : t('確定移除？', 'Remove this device?');
    if (!confirm(warn)) return;
    try {
      const res = await fetch(API.deactivate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey, device_id: deviceId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');
      toast(t('已移除', 'Removed'));
      if (isCurrent) {
        LICENSE_KEYS_TO_TRY.forEach(function (k) { localStorage.removeItem(k); });
        setTimeout(function () { window.location.href = '/'; }, 1200);
      } else {
        loadDevices(licenseKey);
      }
    } catch (err) {
      toast(t('失敗', 'Failed') + ': ' + err.message, 'error');
    }
  }

  // ---------- Init (ZERO side-effects) ----------
  function init() {
    const gear = document.getElementById('deviceGearBtn');
    if (!gear) {
      console.warn('[MW] #deviceGearBtn not found');
      return;
    }

    // ✅ 只 bind gear 自己一個，完全冇 document / window listener
    gear.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });

    console.log('[MW] Device Manager ready — zero side-effects init');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MeetingWorkspaceDeviceManager = {
    open: openModal, close: closeModal,
    getLicenseKey: getLicenseKey, getDeviceId: getDeviceId,
  };
})();