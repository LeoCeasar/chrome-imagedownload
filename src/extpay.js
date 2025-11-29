// Lightweight stub for ExtPay to avoid load errors during development.
// Replace this file with the official ExtPay library when deploying.
// Stub behavior:
// - getUser(): resolves to { paid: false }
// - openPaymentPage(): alerts a message
// - startBackground(): no-op
(function (global) {
  if (typeof global.ExtPay === 'function') {
    // Real library already present; do nothing.
    return;
  }
  function stubFactory(id) {
    const api = {
      getUser: async () => ({ paid: false }),
      openPaymentPage: () => {
        try { alert('支付模块未集成：请在 src/extpay.js 替换为官方 ExtPay 脚本'); } catch (e) { /* service worker */ }
        if (typeof console !== 'undefined') console.warn('[ExtPay stub]', 'openPaymentPage called');
      },
      startBackground: () => {
        if (typeof console !== 'undefined') console.info('[ExtPay stub] startBackground no-op for', id);
      },
      __isStub: true
    };
    return api;
  }
  global.ExtPay = stubFactory;
})(typeof self !== 'undefined' ? self : window);
