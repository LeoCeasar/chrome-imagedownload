// Simple pay/quota helper used by popup and sidepanel
// Requires (optional) global ExtPay loaded from src/extpay.js
(function () {
  const EXT_ID = 'od-image-downloader';
  const FREE_DAILY_LIMIT = 5; // 免费每天5张图片

  let _extpay = null;
  try {
    if (typeof ExtPay === 'function') {
      _extpay = ExtPay(EXT_ID);
    }
  } catch {}

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
    if (!_extpay) return { paid: false };
    try {
      const user = await _extpay.getUser();
      // user.paid indicates whether user has purchased/active subscription
      return user || { paid: false };
    } catch {
      return { paid: false };
    }
  }

  function openPaymentPage() {
    // If stub, open local info page to provide visible feedback
    if (_extpay && _extpay.__isStub) {
      const url = chrome.runtime.getURL('src/pay-info.html');
      try { chrome.tabs.create({ url }); } catch { /* ignore */ }
      return;
    }
    if (_extpay && _extpay.openPaymentPage) {
      try { _extpay.openPaymentPage(); } catch {}
      return;
    }
    alert('支付模块暂不可用，请稍后再试');
  }

  window.PAY = {
    getUser,
    openPaymentPage,
    getRemainingDailyQuota,
    consumeQuota,
    FREE_DAILY_LIMIT
  };
})();
