const { execFile } = require('child_process');
const path = require('path');
const state = require('../../core/state');

function resolveAudioSettingsForTab(tab) {
  if (!tab) return { enabled: false, source: 'mic' };
  
  // 1. Check if global (All Tabs) routing is active
  if (state.globalAudioSettings && state.globalAudioSettings.enabled) {
    return { enabled: true, source: state.globalAudioSettings.source };
  }

  // 2. Check tab-specific configuration
  const tabSettings = state.tabAudioSettings.get(tab.id);
  if (tabSettings && tabSettings.enabled) {
    return { enabled: true, source: tabSettings.source };
  }

  // 3. Check domain-specific configuration
  try {
    if (tab.url && tab.url !== 'about:blank') {
      const hostname = new URL(tab.url).hostname;
      const domainSettingsStore = state.store.get('domainAudioSettings', {});
      const domainSettings = domainSettingsStore[hostname];
      if (domainSettings && domainSettings.enabled) {
        return { enabled: true, source: domainSettings.source };
      }
    }
  } catch (e) {
    console.error('Error parsing tab URL for audio settings:', e);
  }

  // Default fallback
  return { enabled: false, source: 'mic' };
}

function getAudioSettingsForTabId(tabId) {
  let tabEntry = null;
  for (const entry of state.windows.values()) {
    tabEntry = entry.tabs.find(t => t.id === tabId);
    if (tabEntry) break;
  }

  const tabSettings = state.tabAudioSettings.get(tabId);
  if (tabSettings) {
    return { ...tabSettings, resolved: resolveAudioSettingsForTab(tabEntry) };
  }

  if (tabEntry && tabEntry.url && tabEntry.url !== 'about:blank') {
    try {
      const hostname = new URL(tabEntry.url).hostname;
      const domainSettingsStore = state.store.get('domainAudioSettings', {});
      const domainSettings = domainSettingsStore[hostname];
      if (domainSettings) {
        return { ...domainSettings, resolved: resolveAudioSettingsForTab(tabEntry) };
      }
    } catch (e) {}
  }

  if (state.globalAudioSettings && state.globalAudioSettings.enabled) {
    return { enabled: true, source: state.globalAudioSettings.source, destination: 'all', resolved: state.globalAudioSettings };
  }

  return { enabled: false, source: 'mic', destination: 'tab', resolved: { enabled: false, source: 'mic' } };
}

function runAudioHelper(args) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'audio-helper.ps1');
    const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args];
    execFile('powershell.exe', psArgs, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: stderr || err.message });
      } else {
        resolve({ success: true, stdout: stdout.trim() });
      }
    });
  });
}

module.exports = {
  resolveAudioSettingsForTab,
  getAudioSettingsForTabId,
  runAudioHelper
};
