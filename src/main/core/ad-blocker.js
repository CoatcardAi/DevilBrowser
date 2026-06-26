const { session } = require('electron');
const state = require('./state');

const AD_PATTERNS = [
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'adservice.google.com',
  'taboola.com',
  'outbrain.com',
  'adnxs.com',
  'amazon-adsystem.com',
  'popads.net',
  'adform.net',
  'scorecardresearch.com',
  'quantserve.com',
  'google-analytics.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.io'
];

function init() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (!state.adBlockerEnabled) {
      callback({ cancel: false });
      return;
    }

    try {
      const url = new URL(details.url);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.toLowerCase();

      // Check hosts
      const isAdHost = AD_PATTERNS.some(domain => host.includes(domain));
      // Check for common ad script patterns in path
      const isAdPath = path.includes('/ads.js') || 
                       path.includes('/adsbygoogle') || 
                       path.includes('/adframe') || 
                       path.includes('google-analytics');

      if (isAdHost || isAdPath) {
        console.log(`[AdBlocker] Blocked request to: ${details.url}`);
        state.adsBlockedToday++;
        state.broadcastStats();
        callback({ cancel: true });
        return;
      }
    } catch (e) {
      // ignore invalid URLs
    }

    callback({ cancel: false });
  });
}

module.exports = {
  init
};
