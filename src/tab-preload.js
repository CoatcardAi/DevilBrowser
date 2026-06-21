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
