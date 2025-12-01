// Simple pay/quota helper used by popup and sidepanel
// Requires (optional) global ExtPay loaded from src/extpay.js
(function () {
  // Resolve ExtPay project ID strictly from config; do not silently fall back
  const EXT_ID = (typeof window !== 'undefined' && window.APP_CONFIG?.EXTPAY_ID)
    || (typeof self !== 'undefined' && self.APP_CONFIG?.EXTPAY_ID)
    || null;
  const FREE_DAILY_LIMIT = 5; // 免费每天5张图片

  let _extpay = null;
  try {
    const runtimeId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? chrome.runtime.id : '(unknown-runtime-id)';
    if (!EXT_ID) {
      console.error('[ExtPay] APP_CONFIG.EXTPAY_ID is missing; cannot initialize payments. runtime.id =', runtimeId);
    } else if (typeof ExtPay !== 'function') {
      console.warn('[ExtPay] library not available in this context; using stub if present. project =', EXT_ID, 'runtime.id =', runtimeId);
    } else {
      _extpay = ExtPay(EXT_ID);
      console.info('[ExtPay] initialized in UI context. project =', EXT_ID, 'runtime.id =', runtimeId);
    }
  } catch (e) {
    console.error('[ExtPay] failed to initialize ExtPay instance:', e);
  }

  function todayKey() {
    // Local date YYYY-MM-DD
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async function getUsage() {
    const { quotaDate, quotaCount } = await chrome.storage.local.get(['quotaDate', 'quotaCount']);
    const t = todayKey();
    if (quotaDate !== t) {
      return { date: t, count: 0 };
    }
    return { date: quotaDate || t, count: Number.isFinite(quotaCount) ? Number(quotaCount) : 0 };
  }

  async function saveUsage(date, count) {
    await chrome.storage.local.set({ quotaDate: date, quotaCount: count });
  }

  async function getRemainingDailyQuota() {
    const u = await getUsage();
    const remaining = Math.max(0, FREE_DAILY_LIMIT - (u.count || 0));
    return remaining;
  }

  async function consumeQuota(n = 1) {
    const u = await getUsage();
    const t = todayKey();
    const base = (u.date === t) ? (u.count || 0) : 0;
    const next = Math.max(0, base + n);
    await saveUsage(t, next);
    return Math.max(0, FREE_DAILY_LIMIT - next);
  }

  async function getUser() {
    if (!_extpay) {
      console.warn('[ExtPay] getUser() called but _extpay not initialized. project =', EXT_ID);
      return { paid: false, _error: 'extpay_not_initialized' };
    }
    try {
      const user = await _extpay.getUser();
      console.debug('[ExtPay] getUser() ->', user);
      // user.paid indicates whether user has purchased/active subscription
      return user || { paid: false, _error: 'user_null' };
    } catch (err) {
      console.error('[ExtPay] getUser() failed:', err);
      return { paid: false, _error: String(err && err.message || err) };
    }
  }

  async function broadcastLicenseChanged(user) {
    try { chrome.runtime?.sendMessage?.({ type: 'LICENSE_CHANGED', user: user || null }); } catch {}
    try { await chrome.storage?.local?.set?.({ licensePaid: !!(user && user.paid), licenseUpdatedAt: Date.now() }); } catch {}
  }

  async function pollForPayment(timeoutMs = 180000, intervalMs = 3000) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    console.info('[ExtPay] start pollForPayment: timeout =', timeoutMs, 'interval =', intervalMs);
    while (Date.now() < deadline) {
      try {
        const user = await getUser();
        if (user && user.paid) {
          console.info('[ExtPay] payment detected during polling; updating UI');
          await broadcastLicenseChanged(user);
          return true;
        }
      } catch {}
      await new Promise(r => setTimeout(r, Math.max(500, intervalMs)));
    }
    console.warn('[ExtPay] polling ended without detecting paid status');
    return false;
  }

  function openPaymentPage() {
    // If stub, open local info page to provide visible feedback
    if (_extpay && _extpay.__isStub) {
      const url = chrome.runtime.getURL('src/pay-info.html');
      try { chrome.tabs.create({ url }); } catch { /* ignore */ }
      return;
    }
    if (_extpay && _extpay.openPaymentPage) {
      try {
        console.info('[ExtPay] opening payment page for project =', EXT_ID);
        _extpay.openPaymentPage();
        // Start a background poll to detect paid status while user completes checkout
        // Fire and forget; UI can also click "刷新授权" to force immediate check
        pollForPayment().catch(()=>{});
      } catch (e) {
        console.error('[ExtPay] openPaymentPage failed:', e);
      }
      return;
    }
    alert('支付模块暂不可用，请稍后再试');
  }

  window.PAY = {
    getUser,
    openPaymentPage,
    pollForPayment,
    getRemainingDailyQuota,
    consumeQuota,
    FREE_DAILY_LIMIT
  };
})();
