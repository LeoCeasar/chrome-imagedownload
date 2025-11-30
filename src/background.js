// Background service worker for ExtPay (MV3)
// Loads config + ExtPay and starts background messaging channel.
try {
  // Ensure config is present first, then load extpay library (or stub)
  importScripts('config.js', 'extpay.js');
  if (typeof ExtPay === 'function' && self.APP_CONFIG && self.APP_CONFIG.EXTPAY_ID) {
    const extpay = ExtPay(self.APP_CONFIG.EXTPAY_ID);
    extpay.startBackground();
    console.info('[ExtPay] background started with project:', self.APP_CONFIG.EXTPAY_ID);
  } else {
    console.warn('[ExtPay] not initialized: library or config missing');
  }
} catch (e) {
  // Fallback: background will still run without ExtPay library present
  console.warn('ExtPay background init skipped:', e);
}
