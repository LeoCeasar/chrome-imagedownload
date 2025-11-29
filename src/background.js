// Background service worker for ExtPay (MV3)
// Note: extpay.js must be available at src/extpay.js
try {
  // importScripts is supported in MV3 service worker when not using type:module
  // Path is relative to this file (src/background.js)
  // So we load sibling file as 'extpay.js', not 'src/extpay.js'
  importScripts('extpay.js');
  if (typeof ExtPay === 'function') {
    const extpay = ExtPay('od-image-downloader');
    // Initializes messaging required by ExtPay across extension contexts
    extpay.startBackground();
  }
} catch (e) {
  // Fallback: background will still run without ExtPay library present
  console.warn('ExtPay background init skipped:', e);
}
