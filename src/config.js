// Global configuration for the extension.
// IMPORTANT: Set EXTPAY_ID to the project ID you configured in ExtensionPay.
// For development, ensure your extension ID is fixed (manifest.key) to match.
(function (root) {
  if (!root.APP_CONFIG) {
    root.APP_CONFIG = {
      // TODO: replace with your real ExtPay project ID
      EXTPAY_ID: 'od-image-downloader'
    };
  }
})(typeof self !== 'undefined' ? self : window);

