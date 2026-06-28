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
  } else if (event.data.type === 'AI_SOCIAL_EVENT') {
    ipcRenderer.send('ai-tab-context-action', event.data.payload);
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

})();
`;

webFrame.executeJavaScript(aiContextCode);

// Listen for context menu trigger from main process
ipcRenderer.on('ai-context-menu-trigger', async (event, action) => {
  try {
    const info = await webFrame.executeJavaScript('window.__getAIContextInfo()');

    if (action === 'analyse-image' && info.imageSrc) {
      let base64 = null;
      if (info.imageSrc.startsWith('data:')) {
        base64 = info.imageSrc.split(',')[1];
      } else {
        const res = await ipcRenderer.invoke('ai-fetch-image-base64', info.imageSrc);
        if (res && res.success) {
          base64 = res.base64;
        }
      }
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

// ----------------------------------------------------
// Text Selection Quick Actions (In-Page Shadow DOM Popover)
// ----------------------------------------------------
(function() {
  let popoverContainer = null;
  let lastSelectedText = '';

  function showSelectionPopover(rect, text) {
    if (!popoverContainer) {
      popoverContainer = document.createElement('div');
      popoverContainer.id = 'devil-selection-popover-root';
      popoverContainer.style.position = 'absolute';
      popoverContainer.style.zIndex = '999999999';
      popoverContainer.style.pointerEvents = 'auto';
      
      const shadow = popoverContainer.attachShadow({ mode: 'open' });
      
      const style = document.createElement('style');
      style.textContent = `
        .popover {
          display: flex;
          align-items: center;
          background: #0b0d15;
          border: 1px solid rgba(139, 92, 246, 0.45);
          border-radius: 8px;
          padding: 4px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65), 0 0 15px rgba(139, 92, 246, 0.2);
          gap: 3px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 11px;
          color: #ffffff;
        }
        .action-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.85);
          padding: 5px 8px;
          cursor: pointer;
          border-radius: 4px;
          font-weight: 500;
          transition: all 0.2s ease;
          white-space: nowrap;
        }
        .action-btn:hover {
          background: rgba(139, 92, 246, 0.25);
          color: #ffffff;
        }
        .action-btn .icon {
          font-size: 13px;
        }
        .arrow {
          position: absolute;
          bottom: -5px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 6px solid #0b0d15;
        }
      `;
      
      const popoverEl = document.createElement('div');
      popoverEl.className = 'popover';
      
      const actions = [
        { id: 'explain', icon: '💡', label: 'Explain' },
        { id: 'shorten', icon: '📝', label: 'Summarise' },
        { id: 'translate', icon: '🌐', label: 'Translate' },
        { id: 'improve', icon: '✨', label: 'Improve' },
        { id: 'copy', icon: '📋', label: 'Copy' }
      ];
      
      actions.forEach(act => {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.innerHTML = `<span class="icon">${act.icon}</span><span>${act.label}</span>`;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (act.id === 'copy') {
            navigator.clipboard.writeText(lastSelectedText);
          } else {
            ipcRenderer.send('ai-tab-context-action', {
              action: act.id,
              text: lastSelectedText
            });
          }
          hideSelectionPopover();
        });
        popoverEl.appendChild(btn);
      });
      
      const arrow = document.createElement('div');
      arrow.className = 'arrow';
      
      shadow.appendChild(style);
      shadow.appendChild(popoverEl);
      shadow.appendChild(arrow);
      
      document.body.appendChild(popoverContainer);
    }
    
    lastSelectedText = text;
    popoverContainer.style.display = 'block';
    
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    
    const popoverWidth = 360; 
    const x = rect.left + rect.width / 2 + scrollX - (popoverWidth / 2);
    const y = rect.top + scrollY - 42; 
    
    popoverContainer.style.left = `${Math.max(10, x)}px`;
    popoverContainer.style.top = `${y}px`;
  }

  function hideSelectionPopover() {
    if (popoverContainer) {
      popoverContainer.style.display = 'none';
    }
  }

  document.addEventListener('mouseup', (e) => {
    if (popoverContainer && popoverContainer.contains(e.target)) return;
    
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      if (text.length > 5) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        showSelectionPopover(rect, text);
      } else {
        hideSelectionPopover();
      }
    }, 60);
  });

  document.addEventListener('mousedown', (e) => {
    if (popoverContainer && popoverContainer.contains(e.target)) return;
    hideSelectionPopover();
  });
})();

// Scroll progress tracker
window.addEventListener('scroll', () => {
  try {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    ipcRenderer.send('tab-scroll-progress', pct);
  } catch (err) {}
});

// Network online status tracker
const reportOnlineStatus = () => {
  try {
    ipcRenderer.send('tab-online-status', navigator.onLine);
  } catch (err) {}
};
window.addEventListener('online', reportOnlineStatus);
window.addEventListener('offline', reportOnlineStatus);
window.addEventListener('load', reportOnlineStatus);
reportOnlineStatus();
