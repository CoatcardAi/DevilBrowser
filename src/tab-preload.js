const { webFrame, ipcRenderer } = require('electron');

// ----------------------------------------------------
// Secure HTML5 postMessage Communication Bridge
// ----------------------------------------------------
window.addEventListener('message', async (event) => {
  // Only accept messages from our own window context
  if (event.source !== window || !event.data || event.data.sender !== 'devil-browser-injected') return;
  
  if (event.data.type === 'GET_ROUTING_SETTINGS') {
    const settings = await ipcRenderer.invoke('get-active-tab-audio-settings');
    window.postMessage({
      sender: 'devil-browser-preload',
      replyTo: event.data.id,
      settings
    }, '*');
  } else if (event.data.type === 'GET_AUDIO_SOURCE_ID') {
    const sourceId = await ipcRenderer.invoke('get-desktop-audio-source-id');
    window.postMessage({
      sender: 'devil-browser-preload',
      replyTo: event.data.id,
      sourceId
    }, '*');
  }
});

// ----------------------------------------------------
// Main World Script Injection
// ----------------------------------------------------
const injectionCode = `
(function() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const pendingRequests = new Map();

  // Listen to messages from the preload script
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.sender !== 'devil-browser-preload') return;
    const resolve = pendingRequests.get(event.data.replyTo);
    if (resolve) {
      pendingRequests.delete(event.data.replyTo);
      resolve(event.data);
    }
  });

  // Send request helper to communicate with the preload script
  function sendRequest(type) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).substr(2, 9);
      pendingRequests.set(id, resolve);
      window.postMessage({
        sender: 'devil-browser-injected',
        id,
        type
      }, '*');
    });
  }

  // Intercept and override WebRTC getUserMedia
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    if (constraints && constraints.audio) {
      try {
        const res = await sendRequest('GET_ROUTING_SETTINGS');
        const settings = res.settings;

        if (settings && settings.enabled && settings.source !== 'mic') {
          // We need desktop/system capture loopback!
          const srcRes = await sendRequest('GET_AUDIO_SOURCE_ID');
          const sourceId = srcRes.sourceId;

          if (sourceId) {
            // 1. Capture system loopback stream (audio and video)
            const loopbackStream = await originalGetUserMedia({
              audio: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId
                }
              },
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId
                }
              }
            });

            // Clean up video track immediately to prevent screen capture visual feed
            loopbackStream.getVideoTracks().forEach(t => t.stop());
            const loopbackTrack = loopbackStream.getAudioTracks()[0];

            if (settings.source === 'system' || settings.source === 'browser') {
              // Replaced Mode
              if (loopbackTrack) {
                return new MediaStream([loopbackTrack]);
              }
            } else if (settings.source === 'combined') {
              // Mixed Mode (Mic + System Loopback) using Web Audio API
              try {
                // Request normal mic input
                const micStream = await originalGetUserMedia({ audio: true });
                const micTrack = micStream.getAudioTracks()[0];

                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const dest = audioCtx.createMediaStreamDestination();

                if (micTrack) {
                  const micSource = audioCtx.createMediaStreamSource(new MediaStream([micTrack]));
                  micSource.connect(dest);
                }
                if (loopbackTrack) {
                  const loopbackSource = audioCtx.createMediaStreamSource(new MediaStream([loopbackTrack]));
                  loopbackSource.connect(dest);
                }

                // Return the mixed node stream
                return dest.stream;
              } catch (mixErr) {
                console.error('Error combining mic and system loopback tracks:', mixErr);
                // Fallback to loopback only if mix fails
                if (loopbackTrack) {
                  return new MediaStream([loopbackTrack]);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('DevilBrowser audio routing injection failed:', err);
      }
    }
    // Default fallback
    return originalGetUserMedia(constraints);
  };
})();
`;

// Inject into the main world execution context
webFrame.executeJavaScript(injectionCode);

// ----------------------------------------------------
// AI Context Menu Injection
// ----------------------------------------------------

// Inject context menu handler into the page's main world
const aiContextCode = `
(function() {
  let _lastContextTarget = null;

  document.addEventListener('contextmenu', (e) => {
    _lastContextTarget = e.target;
  }, true);

  window.__getAIContextInfo = function() {
    const selected = window.getSelection().toString().trim();
    const target = _lastContextTarget;
    let imageData = null;
    let imageSrc  = null;
    let imageMime = 'image/png';

    if (target && (target.tagName === 'IMG' || target.closest('img'))) {
      const img = target.tagName === 'IMG' ? target : target.closest('img');
      imageSrc = img.src;
      imageMime = img.src.startsWith('data:') ? img.src.split(';')[0].split(':')[1] : 'image/png';
    }

    return { selected, imageSrc, imageMime };
  };

  window.__getImageAsBase64 = async function(src) {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  };
})();
`;

webFrame.executeJavaScript(aiContextCode);

// Listen for context menu trigger from main process
ipcRenderer.on('ai-context-menu-trigger', async (event, action) => {
  try {
    const info = await webFrame.executeJavaScript('window.__getAIContextInfo()');

    if (action === 'analyse-image' && info.imageSrc) {
      const base64 = await webFrame.executeJavaScript(
        `window.__getImageAsBase64(${JSON.stringify(info.imageSrc)})`
      );
      if (base64) {
        ipcRenderer.send('ai-tab-context-action', {
          action: 'analyse-image',
          imageData: base64,
          mimeType: info.imageMime
        });
      }
    } else if (info.selected) {
      ipcRenderer.send('ai-tab-context-action', {
        action,
        text: info.selected
      });
    }
  } catch(e) {
    console.error('AI context menu error:', e);
  }
});

// ----------------------------------------------------
// Page Indexing for Semantic Search (after navigation)
// ----------------------------------------------------
window.addEventListener('load', () => {
  // Small delay so page content has rendered
  setTimeout(async () => {
    try {
      const text = document.body ? document.body.innerText.slice(0, 4000) : '';
      if (text.length > 200) {
        ipcRenderer.send('ai-index-page-from-tab', {
          url: location.href,
          title: document.title,
          text
        });
      }
    } catch {}
  }, 2000);
});
