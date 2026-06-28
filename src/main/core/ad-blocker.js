const { session, app } = require('electron');
const path = require('path');
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
  'segment.io',
  'clicky.com',
  'chartbeat.com'
];

const SOCIAL_PATTERNS = {
  facebook: ['connect.facebook.net', 'facebook.com/plugins'],
  twitter: ['platform.twitter.com', 'syndication.twitter.com'],
  google: ['accounts.google.com/gsi']
};

const PHISHING_BLACKLIST = [
  'phishingsite.com',
  'suspicious-login.xyz',
  'fake-bank-auth.com',
  'malware-download-center.net'
];

// Stats per WebContents ID
const tabBlockedStats = new Map();

function clearBlockedStats(webContentsId) {
  tabBlockedStats.delete(webContentsId);
}

function getBlockedStats(webContentsId) {
  return tabBlockedStats.get(webContentsId) || 0;
}

function getShieldsSettings(hostname) {
  if (!hostname) return { enabled: false };
  const domainKey = hostname.replace(/\./g, '_');
  const defaults = {
    jsEnabled: true,
    imagesEnabled: true,
    shieldsEnabled: true,
    blockTrackers: true,
    blockScripts: false,
    blockSocial: true,
    blockCookieBanners: true,
    forgetOnClose: false,
    fingerprinting: 'standard'
  };
  return Object.assign({}, defaults, state.store.get(`site_settings.${domainKey}`, {}));
}

function registerBlocker(ses) {
  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);
      const host = url.hostname.toLowerCase();
      const pathName = url.pathname.toLowerCase();

      // Phishing / Malware blocker
      const isPhishing = PHISHING_BLACKLIST.some(d => host === d || host.endsWith('.' + d));
      if (isPhishing && !details.url.includes('bypass=true')) {
        const warningUrl = `file:///${path.join(app.getAppPath(), 'src', 'renderer', 'security-warning.html').replace(/\\/g, '/')}?type=phishing&url=${encodeURIComponent(details.url)}`;
        callback({ redirectURL: warningUrl });
        return;
      }

      // AMP Link Redirector
      if (host.includes('google.com') && pathName.startsWith('/amp/')) {
        const parts = pathName.split('/');
        const canonicalHost = parts.slice(3).join('/');
        const isSsl = parts[2] === 's';
        if (canonicalHost) {
          const rebuilt = (isSsl ? 'https://' : 'http://') + canonicalHost + url.search + url.hash;
          callback({ redirectURL: rebuilt });
          return;
        }
      }

      // Check per-domain Shields settings
      const settings = getShieldsSettings(host);

      // HTTPS-Only Mode Upgrade
      if (url.protocol === 'http:' && !host.includes('localhost') && !host.includes('127.0.0.1') && !details.url.includes('bypass=true')) {
        // Upgrade to HTTPS
        const upgradedUrl = details.url.replace('http:', 'https:');
        callback({ redirectURL: upgradedUrl });
        return;
      }

      // Protocol warning intercept for HTTP form submissions (POST method)
      if (details.method === 'POST' && url.protocol === 'http:' && !host.includes('localhost') && !details.url.includes('bypass=true')) {
        const warningUrl = `file:///${path.join(app.getAppPath(), 'src', 'renderer', 'security-warning.html').replace(/\\/g, '/')}?type=http&url=${encodeURIComponent(details.url)}`;
        callback({ redirectURL: warningUrl });
        return;
      }

      if (settings.shieldsEnabled) {
        // Dynamic script and image blocking
        if (!settings.imagesEnabled && details.resourceType === 'image') {
          callback({ cancel: true });
          return;
        }
        if (settings.blockScripts && details.resourceType === 'script') {
          callback({ cancel: true });
          return;
        }

        // Social embedding blocking
        if (settings.blockSocial) {
          const isSocial = Object.values(SOCIAL_PATTERNS).some(patterns =>
            patterns.some(pattern => details.url.includes(pattern))
          );
          if (isSocial) {
            callback({ cancel: true });
            return;
          }
        }

        // Ads & trackers blocking
        if (settings.blockTrackers || state.adBlockerEnabled) {
          const isAdHost = AD_PATTERNS.some(domain => host.includes(domain));
          const isAdPath = pathName.includes('/ads.js') || 
                           pathName.includes('/adsbygoogle') || 
                           pathName.includes('/adframe') || 
                           pathName.includes('google-analytics');

          if (isAdHost || isAdPath) {
            // Increment blocked counters
            state.adsBlockedToday++;
            state.broadcastStats();
            
            const wId = details.webContentsId;
            const currentCount = (tabBlockedStats.get(wId) || 0) + 1;
            tabBlockedStats.set(wId, currentCount);

            // Broadcast stats to renderer
            for (const entry of state.windows.values()) {
              entry.win.webContents.send('shields-stats-updated', { webContentsId: wId, count: currentCount });
            }

            callback({ cancel: true });
            return;
          }
        }
      }
    } catch (e) {
      // ignore invalid URLs
    }

    callback({ cancel: false });
  });
}

function init() {
  registerBlocker(session.defaultSession);
  app.on('session-created', (ses) => {
    registerBlocker(ses);
  });
}

module.exports = {
  init,
  clearBlockedStats,
  getBlockedStats,
  getShieldsSettings
};
