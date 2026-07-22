(function initializeDeviceLayout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BPWebDeviceLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDeviceLayout() {
  'use strict';

  function shouldUsePhoneLayout(signals = {}) {
    const reportedMobile = signals.reportedMobile;
    const userAgent = String(signals.userAgent || '');
    if (reportedMobile === true) return true;
    if (/Android|iPhone|iPad|iPod|Windows Phone/i.test(userAgent)) return true;
    if (reportedMobile === false || /Windows NT|Macintosh|X11|Linux x86_64/i.test(userAgent)) return false;
    return signals.coarsePointer === true && signals.narrowViewport === true;
  }

  return { shouldUsePhoneLayout };
});
