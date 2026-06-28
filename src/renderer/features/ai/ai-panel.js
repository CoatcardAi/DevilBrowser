// ============================================================
// AI Sidebar Panel — DevilBrowser
// ============================================================
// Full chat sidebar with: streaming, summarise, voice, think mode,
// text/image action results, quota display, model selector.

(function () {
  'use strict';

  const AI_BASE = 'https://aimagicbackend.onrender.com';

  // ------- DOM Refs -------
  const panel = document.getElementById('ai-panel');
  const panelMessages = document.getElementById('ai-panel-messages');
  const panelInput = document.getElementById('ai-panel-input');
  const btnSend = document.getElementById('ai-panel-send');
  const btnClear = document.getElementById('ai-panel-clear');
  const btnClose = document.getElementById('ai-panel-close');
  const btnSummarise = document.getElementById('ai-panel-summarise');
  const btnVoice = document.getElementById('ai-panel-voice');
  const btnThink = document.getElementById('ai-panel-think');
  const btnScreenshot = document.getElementById('ai-panel-screenshot');
  const btnAiToggle = document.getElementById('btn-ai-toggle');
  const modelSelect = document.getElementById('ai-model-select');
  const sysInstrArea = document.getElementById('ai-system-instruction');
  const quotaBar = document.getElementById('ai-quota-bar');
  const quotaText = document.getElementById('ai-quota-text');
  const userBadge = document.getElementById('ai-user-badge');
  const pageContext = document.getElementById('ai-page-context');
  const statusQuota = document.getElementById('status-quota');
  const btnSpeaker = document.getElementById('ai-panel-speaker');
  const speakerIcon = document.getElementById('ai-speaker-icon');

  // ------- State -------
  let history = [];      // [{role, text}]
  let isStreaming = false;
  let voiceOutputEnabled = localStorage.getItem('devilbrowser-voice-output') === 'true';
  let shouldResumeVoiceInput = false;
  let thinkMode = false;
  let currentUser = null;
  let speechRec = null;
  let isListening = false;
  let aiMemory = {};      // Cross-tab memory object
  let sessionFiles = [];  // File attachments state
  let agentPaused = false;
  let agentAborted = false;
  let resumeResolve = null;

  // Auto-Pilot State
  let isAutoPilotActive = false;
  let autoPilotInterval = null;
  let autoPilotMood = 'Friendly 💬';
  let autoPilotMode = 'semi';
  let autoPilotPlatform = 'auto';
  let pilotStyleText = "";
  let pilotStyleFileName = "";
  let lastRepliedMessageKey = "";

  // ------- Public API -------
  window.aiPanel = {
    open() { openPanel(); },
    close() { closePanel(); },
    toggle() { panel && panel.classList.contains('open') ? closePanel() : openPanel(); },
    updatePageContext() { updatePageContext(); },

    onAuthReady(me) {
      currentUser = me;
      if (userBadge) userBadge.textContent = `${me.email} · ${me.role}`;
      loadModels();
      window.aiQuota.refresh();
    },

    onLoggedOut() {
      currentUser = null;
      if (userBadge) userBadge.textContent = 'Not logged in';
      history = [];
      renderMessages();
    },

    /** Called from context menu / text action IPC */
    sendContextAction(action, content) {
      openPanel();
      const promptMap = {
        'explain': `Explain the following text in simple, clear terms:\n\n"${content}"`,
        'translate': `Translate the following text to Hindi (or detect the target language from context):\n\n"${content}"`,
        'improve': `Rewrite the following text to improve clarity, grammar, and style:\n\n"${content}"`,
        'shorten': `Summarise the following text in 1-2 concise sentences:\n\n"${content}"`,
        'chat': content,
        'analyse-image': null // handled separately
      };
      const prompt = promptMap[action];
      if (prompt) {
        panelInput.value = prompt;
        sendMessage();
      }
    },

    /** Analyse an image from context menu */
    async analyseImage(imageData, mimeType) {
      openPanel();
      appendMessage('user', `📷 Analysing image...`);
      await streamGenerate('Describe this image in detail. What is shown? Any text visible? Key elements?', null, imageData, mimeType);
    },

    /** Receive document analysis request after download */
    async analyseDocument(filePath, mimeType, name) {
      openPanel();
      appendMessage('user', `📄 Analysing document: ${name}`);
      try {
        const res = await window.electronAPI.aiAnalyseDocument(filePath, mimeType, name);
        if (res && res.text) {
          appendMessage('model', res.text);
          window.aiQuota.refresh();
        }
      } catch (e) {
        appendMessage('system', '⚠️ Document analysis failed: ' + e.message);
      }
    }
  };

  window.aiQuota = {
    async refresh() {
      try {
        const q = await window.electronAPI.aiGetQuota();
        renderQuota(q);
      } catch (e) { }
    }
  };

  // ------- Panel Open/Close -------
  async function openPanel() {
    const token = await window.electronAPI.aiGetToken();
    if (!token) {
      if (window.aiAuth) window.aiAuth.showModal();
      return;
    }
    if (!panel) return;

    if (window.closeAllSidePanels) {
      window.closeAllSidePanels('ai-panel');
    }

    panel.classList.add('open');
    if (btnAiToggle) btnAiToggle.classList.add('active');
    updatePageContext();
    updateLayout();
    if (panelInput) {
      // Small delay so the panel slide-in completes before focus
      setTimeout(() => panelInput.focus(), 200);
    }
    // Reset message entrance counter when panel opens
    msgIndex = 0;
  }

  function closePanel() {
    if (!panel) return;
    panel.classList.remove('open');
    if (btnAiToggle) btnAiToggle.classList.remove('active');
    updateLayout();
  }

  function updateLayout() {
    if (window.updateLayout) {
      window.updateLayout();
    }
  }

  function updatePageContext() {
    if (!pageContext) return;
    const tabs = window._tabs || [];
    const activeTabId = window._activeTabId;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab && tab.url && tab.url !== 'about:blank') {
      pageContext.textContent = `📄 ${tab.title || tab.url}`;
      pageContext.title = tab.url;
    } else {
      pageContext.textContent = '📄 New Tab';
      pageContext.title = '';
    }
  }

  // ------- Message Rendering -------
  let msgIndex = 0;

  function appendMessage(role, text, streaming = false) {
    if (!panelMessages) return null;
    const msg = document.createElement('div');
    msg.className = `ai-msg ai-msg-${role}`;
    // Staggered entrance delay for batched history renders
    const delay = Math.min(msgIndex * 40, 300);
    msg.style.animationDelay = `${delay}ms`;
    msg.style.opacity = '0';
    msgIndex++;

    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';

    if (role === 'model') {
      // Model avatar
      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'ai-msg-avatar';
      avatarWrap.innerHTML = `<span class="ai-avatar-icon">✨</span>`;
      msg.appendChild(avatarWrap);

      bubble.innerHTML = renderMarkdown(text);
      if (!streaming) {
        processCodeBlocks(bubble);
      }
    } else if (role === 'user') {
      bubble.textContent = text;
    } else {
      bubble.innerHTML = `<span>${text}</span>`;
    }

    msg.appendChild(bubble);

    // Timestamp
    if (role === 'user' || role === 'model') {
      const ts = document.createElement('span');
      ts.className = 'ai-msg-ts';
      const now = new Date();
      ts.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      msg.appendChild(ts);
    }

    panelMessages.appendChild(msg);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        msg.style.opacity = '';
        msg.classList.add('ai-msg-entered');
      });
    });

    smoothScrollToBottom();
    return bubble;
  }

  function smoothScrollToBottom() {
    if (!panelMessages) return;
    panelMessages.scrollTo({ top: panelMessages.scrollHeight, behavior: 'smooth' });
  }

  // Typing indicator (three bouncing dots)
  let typingIndicator = null;
  function showTypingIndicator() {
    if (typingIndicator) return;
    typingIndicator = document.createElement('div');
    typingIndicator.className = 'ai-msg ai-msg-model ai-typing-indicator-wrap';
    typingIndicator.innerHTML = `
      <div class="ai-msg-avatar"><span class="ai-avatar-icon">✨</span></div>
      <div class="ai-typing-indicator">
        <span></span><span></span><span></span>
      </div>`;
    panelMessages.appendChild(typingIndicator);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => typingIndicator.classList.add('ai-msg-entered'));
    });
    smoothScrollToBottom();
  }
  function hideTypingIndicator() {
    if (typingIndicator) {
      typingIndicator.remove();
      typingIndicator = null;
    }
  }

  function processCodeBlocks(bubble) {
    if (!bubble) return;
    const preElements = bubble.querySelectorAll('pre');
    preElements.forEach(pre => {
      // Check if already wrapped
      if (pre.parentElement.classList.contains('code-block-container')) {
        return;
      }

      const code = pre.querySelector('code');
      if (!code) return;

      const lang = pre.getAttribute('data-lang') || 'code';

      // Create code block wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-container';

      // Create header
      const header = document.createElement('div');
      header.className = 'code-block-header';

      // Language label
      const langSpan = document.createElement('span');
      langSpan.className = 'code-block-lang';
      langSpan.textContent = lang.toUpperCase();
      header.appendChild(langSpan);

      // Copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-block-copy-btn';
      copyBtn.innerHTML = `
        <svg class="copy-icon" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        <span class="copy-text">Copy</span>
      `;

      copyBtn.addEventListener('click', async () => {
        const rawCode = code.innerText;
        try {
          await navigator.clipboard.writeText(rawCode);
          copyBtn.classList.add('copied');
          copyBtn.querySelector('.copy-text').textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.querySelector('.copy-text').textContent = 'Copy';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy text: ', err);
        }
      });
      header.appendChild(copyBtn);

      // Wrap the pre element
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    });
  }

  function renderMessages() {
    if (!panelMessages) return;
    msgIndex = 0;
    panelMessages.innerHTML = '';
    if (history.length === 0) {
      panelMessages.innerHTML = `
        <div class="ai-welcome">
          <div class="ai-welcome-orb">
            <div class="ai-welcome-orb-inner">✨</div>
          </div>
          <div class="ai-welcome-text">
            <h3>CoatcardAi</h3>
            <p>Your intelligent browsing co-pilot. I can browse, research, automate, and assist — all without leaving this tab.</p>
          </div>
          <div class="ai-welcome-suggestions">
            <button class="ai-suggestion-card" data-prompt="Summarize this page for me">
              <span class="suggestion-icon">📄</span>
              <span class="suggestion-label">Summarize page</span>
            </button>
            <button class="ai-suggestion-card" data-prompt="What are the key points on this page?">
              <span class="suggestion-icon">🔑</span>
              <span class="suggestion-label">Key points</span>
            </button>
            <button class="ai-suggestion-card" data-prompt="Search Google for the latest AI news">
              <span class="suggestion-icon">🔍</span>
              <span class="suggestion-label">Web research</span>
            </button>
            <button class="ai-suggestion-card" data-prompt="Open YouTube and find a tutorial about React hooks">
              <span class="suggestion-icon">🤖</span>
              <span class="suggestion-label">Auto-browse</span>
            </button>
          </div>
          <div class="ai-welcome-tips">
            <span>⌨️ Press <code>Ctrl+K</code> for Command Palette</span>
            <span>💡 Select text → AI Quick Actions popover</span>
            <span>🖼️ Right-click images to analyse them</span>
          </div>
        </div>`;

      // Wire suggestion cards
      panelMessages.querySelectorAll('.ai-suggestion-card').forEach(btn => {
        btn.addEventListener('click', () => {
          if (panelInput) panelInput.value = btn.dataset.prompt;
          sendMessage();
        });
      });
      return;
    }
    history.forEach(h => appendMessage(h.role, h.text));
  }


  // Simple markdown → HTML (bold, code, lists, newlines)
  function renderMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre data-lang="${lang || ''}"><code>${code}</code></pre>`;
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>')
      .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      .replace(/\n/g, '<br>');
  }

  // ------- Quota Rendering -------
  function renderQuota(q) {
    if (!q) return;
    const isUnlimited = q.limit === null;

    if (quotaText) {
      if (isUnlimited) {
        quotaText.textContent = `${q.plan} · Unlimited`;
      } else {
        quotaText.textContent = `${q.used_today} / ${q.limit} requests today`;
      }
    }

    if (quotaBar) {
      if (isUnlimited) {
        quotaBar.style.width = '100%';
        quotaBar.className = 'ai-quota-fill unlimited';
      } else {
        const pct = Math.min(100, (q.used_today / q.limit) * 100);
        quotaBar.style.width = pct + '%';
        quotaBar.className = `ai-quota-fill ${pct > 80 ? 'danger' : pct > 50 ? 'warning' : 'ok'}`;
      }
    }

    // Status bar
    if (statusQuota) {
      statusQuota.textContent = isUnlimited
        ? `AI: ${q.plan}`
        : `AI: ${q.remaining ?? (q.limit - q.used_today)} left`;
    }
  }

  // ------- Load Models -------
  async function loadModels() {
    if (!modelSelect) return;
    try {
      const res = await window.electronAPI.aiGetModels();
      if (res && res.models && res.models.length > 0) {
        modelSelect.innerHTML = '';
        res.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          modelSelect.appendChild(opt);
        });
      }
    } catch (e) { }
  }

  function cleanAndParseJSON(jsonStr) {
    let clean = jsonStr.trim();
    // Remove comments
    clean = clean.replace(/(?:^|\s)\/\/.*$/gm, '');
    clean = clean.replace(/\/\*[\s\S]*?\*\//g, '');
    
    try {
      return JSON.parse(clean);
    } catch (e) {
      // Relaxed repairs
      try {
        let fixed = clean
          .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'(?=\s*:)/g, '"$1"') // keys
          .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"'); // values
        fixed = fixed.replace(/,\s*([\]}])/g, '$1'); // trailing comma
        return JSON.parse(fixed);
      } catch (e2) {
        try {
          const fn = new Function('return (' + clean + ');');
          const res = fn();
          if (res && typeof res === 'object') {
            return res;
          }
        } catch (e3) {}
      }
    }
    return null;
  }

  function parseActionCommand(text) {
    if (!text) return null;
    try {
      let jsonText = text.trim();

      // 1. Try markdown code block extraction
      const matchJson = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (matchJson) {
        jsonText = matchJson[1].trim();
      }

      // 2. Try parsing directly
      let parsed = cleanAndParseJSON(jsonText);
      if (parsed && (parsed.action === 'page-automation' || parsed.action === 'browser-action') && parsed.action_input) {
        return parsed;
      }

      // 3. Search for bracket bounds if direct parse fails
      const startIdx = jsonText.indexOf('{');
      const endIdx = jsonText.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const candidate = jsonText.slice(startIdx, endIdx + 1);
        parsed = cleanAndParseJSON(candidate);
        if (parsed && (parsed.action === 'page-automation' || parsed.action === 'browser-action') && parsed.action_input) {
          return parsed;
        }
      }
    } catch (e) { }
    return null;
  }

  function getStreamResponse(displayPrompt, apiPrompt, systemInstruction, imageData, imageMimeType) {
    return new Promise((resolve, reject) => {
      isStreaming = true;
      updateSendBtnState(true);

      let loadingBubble = null;
      if (displayPrompt) {
        appendMessage('user', displayPrompt);
        history.push({ role: 'user', text: displayPrompt });
      }

      // Show typing indicator first
      showTypingIndicator();

      const model = modelSelect ? modelSelect.value : undefined;
      const thinking = thinkMode ? 8192 : 0;

      let fullText = '';
      let firstChunk = true;

      const cleanupListeners = () => {
        if (removeCancelListener) removeCancelListener();
        window.electronAPI.offAiStream(onChunk, onDone, onError);
      };

      const onCancelTriggered = () => {
        isStreaming = false;
        updateSendBtnState(false);
        hideTypingIndicator();
        cleanupListeners();
        stopSpeaking();
        reject(new Error("Agent aborted by user"));
      };

      const removeCancelListener = window.electronAPI.on('hud-cancel-triggered', onCancelTriggered);

      const onChunk = (text) => {
        if (agentAborted) {
          onCancelTriggered();
          return;
        }
        fullText += text;
        if (firstChunk) {
          firstChunk = false;
          // Replace typing indicator with actual streaming bubble
          hideTypingIndicator();
          loadingBubble = appendMessage('model', '');
          if (loadingBubble) loadingBubble.classList.add('streaming');
        }
        if (loadingBubble) {
          loadingBubble.innerHTML = renderMarkdown(fullText) + '<span class="ai-cursor">▍</span>';
          smoothScrollToBottom();
        }
      };

      const onDone = () => {
        isStreaming = false;
        updateSendBtnState(false);
        hideTypingIndicator();
        if (loadingBubble) {
          loadingBubble.classList.remove('streaming');
          loadingBubble.innerHTML = renderMarkdown(fullText);
          processCodeBlocks(loadingBubble);
        } else if (!fullText) {
          // Empty response with no chunks at all
          appendMessage('system', '⚠️ Empty response received.');
        }
        history.push({ role: 'model', text: fullText });
        window.aiQuota.refresh();

        if (voiceOutputEnabled) {
          speakText(fullText);
        }

        cleanupListeners();
        resolve(fullText);
      };

      const onError = (err) => {
        isStreaming = false;
        updateSendBtnState(false);
        hideTypingIndicator();
        if (loadingBubble) {
          loadingBubble.classList.remove('streaming');
          loadingBubble.innerHTML = `<span class="ai-error">⚠️ ${err || 'Generation failed'}</span>`;
        } else {
          appendMessage('system', `⚠️ ${err || 'Generation failed'}`);
        }
        if (displayPrompt) history.pop();
        cleanupListeners();

        if (err && err.includes('401')) {
          window.dispatchEvent(new Event('ai-session-expired'));
        }
        reject(new Error(err));
      };

      window.electronAPI.onAiStream(onChunk, onDone, onError);

      // Prepare history for multi-turn with strict role alternation and non-empty text validation
      let list = history.map(h => ({ role: h.role, text: (h.text || '').trim() })).filter(h => h.text.length > 0);
      
      // If we pushed displayPrompt in this turn, it's already in history, so exclude it from sendHistory
      if (displayPrompt && list.length > 0 && list[list.length - 1].text === displayPrompt.trim()) {
        list.pop();
      }

      let sendHistory = [];
      for (let i = 0; i < list.length; i++) {
        if (sendHistory.length === 0) {
          if (list[i].role === 'user') {
            sendHistory.push(list[i]);
          }
        } else {
          const last = sendHistory[sendHistory.length - 1];
          if (list[i].role !== last.role) {
            sendHistory.push(list[i]);
          } else {
            sendHistory[sendHistory.length - 1] = list[i];
          }
        }
      }
      // Gemini API history must end with a model turn before appending the new user prompt
      if (sendHistory.length > 0 && sendHistory[sendHistory.length - 1].role === 'user') {
        sendHistory.pop();
      }

      window.electronAPI.aiGenerateStream({
        prompt: apiPrompt,
        model: model || undefined,
        systemInstruction: systemInstruction || undefined,
        history: sendHistory.length > 0 ? sendHistory : undefined,
        thinkingBudget: thinking > 0 ? thinking : undefined,
        images: imageData ? [{ type: 'base64', mimeType: imageMimeType, data: imageData }] : undefined,
        files: sessionFiles.length > 0 ? sessionFiles.slice(0, 5).map(f => ({
          path: f.path,
          name: f.name,
          mimeType: f.type,
          data: f.data
        })) : undefined
      }).catch(reject);
    });
  }

  // ------- Streaming Generation (Legacy Wrapper) -------
  async function streamGenerate(prompt, systemInstruction, imageData, imageMimeType) {
    let pageContext = "";
    try {
      const activeUrl = document.getElementById('address') ? document.getElementById('address').value : '';
      const pageDom = await window.electronAPI.aiGetPageDOM();
      if (pageDom && pageDom !== '[]') {
        pageContext = `[Current Page Context]\nURL: ${activeUrl}\nInteractive Elements (DOM):\n${pageDom}\n\n`;
      }
    } catch (e) { }

    return getStreamResponse(prompt, pageContext + prompt, systemInstruction, imageData, imageMimeType);
  }

  // Helper to dynamically wait for the active tab's loading state to clear
  async function waitForPageLoad() {
    const maxWait = 10000; // max 10 seconds
    const checkInterval = 200;
    let elapsed = 0;

    while (elapsed < maxWait) {
      const tabs = window._tabs || [];
      const activeTabId = window._activeTabId;
      const tab = tabs.find(t => t.id === activeTabId);

      if (!tab || !tab.loading) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
      elapsed += checkInterval;
    }
    // Add extra short delay for page rendering and settling
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // ------- Multi-Step Browsing Agent Orchestrator -------
  async function runAgentLoop(userMessage) {
    if (isStreaming) return;

    agentPaused = false;
    agentAborted = false;

    // Show AI Task HUD
    if (window.aiTaskHUD) {
      window.aiTaskHUD.start('AI Agent — Initializing...', () => {
        // Native Cancel triggers hud-cancel-triggered IPC
      });
      window.aiTaskHUD.addStep('Reading your request', 'running');
    }

    const removeCancel = window.electronAPI.on('hud-cancel-triggered', () => {
      agentAborted = true;
      isStreaming = false;
      if (resumeResolve) {
        resumeResolve();
        resumeResolve = null;
      }
    });

    const removePause = window.electronAPI.on('hud-pause-triggered', () => {
      agentPaused = true;
      if (window.aiTaskHUD) {
        window.aiTaskHUD.addStep('Agent Paused ⏸', 'skip');
      }
    });

    const removeResume = window.electronAPI.on('hud-resume-triggered', () => {
      agentPaused = false;
      if (resumeResolve) {
        resumeResolve();
        resumeResolve = null;
      }
    });

    const cleanupLoop = () => {
      removeCancel();
      removePause();
      removeResume();
      if (window.aiTaskHUD) {
        window.aiTaskHUD.clearRequestInput();
      }
      window.aiPanel.resolveUserPrompt = null;
    };

    let currentApiPrompt = userMessage;
    let currentDisplayPrompt = userMessage;
    let nextTurnScreenshot = null;
    let nextTurnScreenshotMime = null;
    let step = 0;
    const maxSteps = 15; // increased step budget to allow for multi-tab reasoning

    let lastScript = "";
    let lastScriptFailed = false;

    const defaultAutomationInstruction =
      "\n\n============================================================\n" +
      "ROLE: Autonomous Web Agent (DevilBrowser AI)\n" +
      "============================================================\n" +
      "You are an advanced, autonomous browsing and browser-level automation agent. " +
      "You do not simply iterate step-by-step blindly. You plan, reflect, self-correct, maintain state, and execute tasks across multiple tabs.\n\n" +
      "--- AGENT PROTOCOL RULES ---\n" +
      "1. Plan at Start: When a task is assigned, formulate a high-level multi-step plan. State it in your thought. Update the plan as you discover new info.\n" +
      "2. State Reflection & Observation: Before choosing your next action, observe the results of the previous step. Check the current active URL, list of tabs, and page DOM. Make sure you don't get stuck in loops.\n" +
      "3. Error Recovery & Self-Correction: If a page action or command fails, DO NOT repeat it. Analyze the failure: Is the element hidden? Did the page URL change? Is there a dynamic loader? Adjust your script, use alternative elements, or navigate elsewhere.\n" +
      "4. Click Accuracy: Always prioritize using the custom page automation helpers: `__aiClick(aiId)`, `__aiFill(aiId, value)`, and `__aiSelect(aiId, value)` over raw selector queries. These targets are pre-annotated on the DOM and are 100% accurate.\n" +
      "5. Memory Logging: Use the cross-tab memory (`set-memory` and `get-memory`) to save findings, tokens, links, and scraped text as you browse. This guarantees you do not lose information when tabs close or switch.\n" +
      "6. Tab Management: If you need to search or inspect multiple sources, manage tabs efficiently (`new-tab`, `switch-tab`, `close-tab`). Avoid clutter.\n" +
      "7. Final Synthesis: Only complete the loop when the user's high-level goal is fully achieved. Output a clean, structured summary of findings (do not output tool blocks in your final response).\n" +
      "8. Document Parsing: If a task requires reading or analyzing local documents (such as downloaded PDFs, Excel spreadsheets, Word files, or CSVs), ALWAYS use the `analyse-document` command which employs advanced AI parsing, rather than trying to write custom node/js text parsers.\n\n" +
      "--- Supported Tools ---\n" +
      "1. page-automation: Execute vanilla JS on a page (fill forms, click buttons, query elements, extract content).\n" +
      "   Format:\n" +
      "   ```json\n" +
      "   {\n" +
      "     \"action\": \"page-automation\",\n" +
      "     \"action_input\": {\n" +
      "       \"thought\": \"Detailed reasoning of what you are doing in this step, updating your plan/subtasks.\",\n" +
      "       \"tabId\": \"<optional_tabId_string>\",\n" +
      "       \"script\": \"__aiClick(\\\"5\\\");\"\n" +
      "     }\n" +
      "   }\n" +
      "   ```\n" +
      "   NOTE: Predefined helpers in script context:\n" +
      "   - `__aiClick(aiId)`: Click an element by its annotated aiId string (e.g. `__aiClick(\"4\")`).\n" +
      "   - `__aiFill(aiId, value)`: Set an input/textarea's value and trigger input/change events (e.g. `__aiFill(\"2\", \"gemini 3.5\")`).\n" +
      "   - `__aiSelect(aiId, value)`: Set a dropdown select value (e.g. `__aiSelect(\"7\", \"US\")`).\n" +
      "\n" +
      "2. browser-action: Perform browser-level management across tabs.\n" +
      "   Format:\n" +
      "   ```json\n" +
      "   {\n" +
      "     \"action\": \"browser-action\",\n" +
      "     \"action_input\": {\n" +
      "       \"thought\": \"Detailed reasoning of why you are performing this browser command.\",\n" +
      "       \"command\": \"list-tabs | switch-tab | new-tab | close-tab | navigate | go-back | go-forward | reload | read-page | search | write-file | save-state | restore-state | set-memory | get-memory | download-file | analyse-document | get-persona | search-credential | ask-user | scroll-page | screenshot-tab | zoom-page | mute-tab | duplicate-tab | pin-tab | print-page | save-page | find-in-page\",\n" +
      "       \"params\": { ... } // optional parameters matching the command\n" +
      "     }\n" +
      "   }\n" +
      "   ```\n" +
      "   Supported browser commands and parameters:\n" +
      "   - `list-tabs`: List all open tabs (IDs, titles, URLs, active state). No params.\n" +
      "   - `switch-tab`: Switch active tab. Params: `{\"tabId\": \"<tabId_string>\"}`\n" +
      "   - `new-tab`: Open a new tab. Params: `{\"url\": \"<url_string>\"}` (defaults to about:blank if not specified)\n" +
      "   - `close-tab`: Close a tab. Params: `{\"tabId\": \"<tabId_string>\"}`\n" +
      "   - `navigate`: Navigate a tab to a new URL. Params: `{\"url\": \"<url_string>\", \"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `go-back`: Go back in history. Params: `{\"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `go-forward`: Go forward in history. Params: `{\"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `reload`: Reload the tab. Params: `{\"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `read-page`: Extract page content (text and DOM) of a specific tab without switching to it. Params: `{\"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `search`: Search Google/web for a query. Params: `{\"query\": \"<search_query>\", \"newTab\": <optional_boolean>}`\n" +
      "   - `write-file`: Save text or structured data directly to the user's Downloads folder. Params: `{\"filename\": \"<filename>\", \"content\": \"<content>\"}`\n" +
      "   - `save-state`: Save the browser state (list of open tabs/urls) internally. No params.\n" +
      "   - `restore-state`: Restore the browser state to the last saved backup. No params.\n" +
      "   - `set-memory`: Store information persistently in a cross-tab memory store. Params: `{\"key\": \"<key>\", \"value\": \"<value>\"}`\n" +
      "   - `get-memory`: Get stored information from the cross-tab memory store. Params: `{\"key\": \"<key>\"}`\n" +
      "   - `download-file`: Download a file (e.g. PDF/ZIP) directly. Returns filePath. Params: `{\"url\": \"<url_string>\"}`\n" +
      "   - `analyse-document`: Read/analyze local documents (PDF, Excel, Word, CSV). Returns structured text or table contents. Params: `{\"filePath\": \"<file_path_string>\", \"mimeType\": \"<optional_mime_type_string>\", \"name\": \"<optional_name_string>\"}`\n" +
      "   - `get-persona`: Retrieve the user's full persona profile details (name, email, phone, location, skills, summary) for form-filling. No params.\n" +
      "   - `search-credential`: Retrieve the stored login username and decrypted password for a specific website domain. Params: `{\"domain\": \"<domain_name>\"}`\n" +
      "   - `ask-user`: Pause execution and ask the user a question or present multiple-choice options. Returns the user's response. Params: `{\"prompt\": \"<question_or_instructions_string>\", \"options\": [\"<opt1>\", \"<opt2>\"]}` (options is optional)\n" +
      "   - `scroll-page`: Scroll active page. Params: `{\"direction\": \"down | up | top | bottom\", \"amount\": <optional_pixels_number>, \"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `screenshot-tab`: Take PNG screenshot of tab. Params: `{\"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `zoom-page`: Adjust zoom. Params: `{\"level\": \"in | out | reset\", \"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `mute-tab`: Mute/unmute tab audio. Params: `{\"mute\": <boolean>, \"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `duplicate-tab`: Duplicate a tab. Params: `{\"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `pin-tab`: Toggle tab pin. Params: `{\"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `print-page`: Print tab page. Params: `{\"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `save-page`: Save tab page HTML. Params: `{\"tabId\": \"<optional_tabId_string>\"}`\n" +
      "   - `find-in-page`: Search text on page. Params: `{\"text\": \"<text_string>\", \"tabId\": \"<optional_tabId_string>\"}`\n\n" +
      "Verify elements exist before interacting. If you have completed the task or cannot proceed further, simply respond with a plain text answer explaining the results to the user (do not include action blocks).";

    let sysInstr = (sysInstrArea ? sysInstrArea.value.trim() : '');
    sysInstr += defaultAutomationInstruction;

    try {
      while (step < maxSteps) {
        if (agentAborted) {
          appendMessage('system', '❌ Agent execution aborted by user.');
          break;
        }

        if (agentPaused) {
          await new Promise(resolve => {
            resumeResolve = resolve;
          });
          if (agentAborted) {
            appendMessage('system', '❌ Agent execution aborted by user.');
            break;
          }
        }

        step++;

        // 1. Get browser tabs and memory context
        let tabsContext = "";
        try {
          const tabList = (window._tabs || []).map(t => ({
            id: t.id,
            title: t.title,
            url: t.url,
            active: t.id === window._activeTabId
          }));
          tabsContext = `[Browser Tabs]\n${JSON.stringify(tabList, null, 2)}\n\n`;
        } catch (e) {
          console.error("Failed to fetch tabs list", e);
        }

        let memoryContext = "";
        if (Object.keys(aiMemory).length > 0) {
          memoryContext = `[AI Cross-Tab Memory]\n${JSON.stringify(aiMemory, null, 2)}\n\n`;
        }

        // 2. Get live DOM and URL of active tab
        let pageContext = "";
        try {
          const activeUrl = document.getElementById('address') ? document.getElementById('address').value : '';
          const pageDom = await window.electronAPI.aiGetPageDOM();
          if (pageDom && pageDom !== '[]' && pageDom !== '{"error":"No active tab found"}') {
            pageContext = `[Current Active Page Context]\nURL: ${activeUrl}\nInteractive Elements (DOM):\n${pageDom}\n\n`;
          }
        } catch (e) {
          console.error("Failed to fetch DOM context", e);
        }

        // 3. Fetch AI response with dynamic retry logic for empty or failed generations
        let fullText = "";
        let retries = 0;
        const maxRetries = 3;
        let stepPrompt = currentApiPrompt;

        while (retries < maxRetries) {
          try {
            const apiPrompt = tabsContext + memoryContext + pageContext + stepPrompt;
            fullText = await getStreamResponse(currentDisplayPrompt, apiPrompt, sysInstr, nextTurnScreenshot, nextTurnScreenshotMime);

            if (fullText && fullText.trim().length > 0) {
              break; // Success
            }

            retries++;
            console.warn(`Empty response from AI, retry ${retries}/${maxRetries}...`);
            if (retries < maxRetries) {
              stepPrompt = currentApiPrompt + `\n\n[System Message: Your previous response was empty or blank. Please provide a plan/thought and the next action block, or your final text response to the user.]`;
              currentDisplayPrompt = null; // Do not render another user bubble
            }
          } catch (err) {
            if (agentAborted || err.message === 'Agent aborted by user') {
              return;
            }
            retries++;
            if (retries >= maxRetries) {
              appendMessage('system', '⚠️ The AI generation failed due to a network/service error.');
              return;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        // Reset screenshot variables so they don't persist on subsequent turns
        nextTurnScreenshot = null;
        nextTurnScreenshotMime = null;

        if (agentAborted) {
          appendMessage('system', '❌ Agent execution aborted by user.');
          break;
        }

        if (!fullText || fullText.trim().length === 0) {
          appendMessage('system', '⚠️ The CoatcardAi returned empty responses. Stopping agent loop.');
          break;
        }

      // 4. Parse action from response
      const parsedAction = parseActionCommand(fullText);
      if (!parsedAction) {
        // No action block found, task complete!
        if (window.aiTaskHUD) window.aiTaskHUD.done('Task completed ✓');
        break;
      }

      const { action, action_input } = parsedAction;
      const thought = action_input.thought || '';
      
      // Show HUD step for this action
      let hudStepId = null;
      if (window.aiTaskHUD) {
        if (step === 0) window.aiTaskHUD.start(`AI Task — Step ${step + 1}`);
        else if (hudStepId !== null) window.aiTaskHUD.updateStep(hudStepId, 'done');
        const actionLabel = action === 'browser-action' ? action_input.command : 'Page Script';
        hudStepId = window.aiTaskHUD.addStep(`Step ${step + 1}: ${actionLabel}`, 'running');
      }
      
      let executionResult = null;

      if (action === 'browser-action') {
        const { command, params } = action_input;
        appendMessage('model', `🤖 **Step ${step} Thought:** *${thought}*`);
        const execBubble = appendMessage('model', `⏳ **Executing browser command: ${command}...**`);
        if (execBubble) execBubble.classList.add('streaming');

        try {
          if (command === 'list-tabs') {
            const tabList = (window._tabs || []).map(t => ({
              id: t.id,
              title: t.title,
              url: t.url,
              active: t.id === window._activeTabId
            }));
            executionResult = { success: true, result: tabList };
          } else if (command === 'switch-tab') {
            const tabId = params?.tabId;
            if (!tabId) throw new Error("Missing tabId parameter");
            await window.electronAPI.setActiveTab(tabId);
            await new Promise(resolve => setTimeout(resolve, 500));
            executionResult = { success: true, result: `Switched active tab to ${tabId}` };
          } else if (command === 'new-tab') {
            const url = params?.url || 'about:blank';
            const res = await window.electronAPI.createTab(url);
            await waitForPageLoad();
            executionResult = { success: true, result: `Created new tab with ID ${res?.id}` };
          } else if (command === 'close-tab') {
            const tabId = params?.tabId;
            if (!tabId) throw new Error("Missing tabId parameter");
            await window.electronAPI.closeTab(tabId);
            await new Promise(resolve => setTimeout(resolve, 500));
            executionResult = { success: true, result: `Closed tab ${tabId}` };
          } else if (command === 'navigate') {
            const url = params?.url;
            const tabId = params?.tabId || window._activeTabId;
            if (!url) throw new Error("Missing url parameter");
            await window.electronAPI.navigateTab({ tabId, url });
            await waitForPageLoad();
            executionResult = { success: true, result: `Navigated tab ${tabId} to ${url}` };
          } else if (command === 'go-back') {
            const tabId = params?.tabId || window._activeTabId;
            await window.electronAPI.goBack(tabId);
            await new Promise(resolve => setTimeout(resolve, 500));
            executionResult = { success: true, result: `Navigated back on tab ${tabId}` };
          } else if (command === 'go-forward') {
            const tabId = params?.tabId || window._activeTabId;
            await window.electronAPI.goForward(tabId);
            await new Promise(resolve => setTimeout(resolve, 500));
            executionResult = { success: true, result: `Navigated forward on tab ${tabId}` };
          } else if (command === 'reload') {
            const tabId = params?.tabId || window._activeTabId;
            await window.electronAPI.reload(tabId);
            await waitForPageLoad();
            executionResult = { success: true, result: `Reloaded tab ${tabId}` };
          } else if (command === 'read-page') {
            const tabId = params?.tabId || window._activeTabId;
            if (!tabId) throw new Error("No active tab to read");
            const pageText = await window.electronAPI.aiGetPageText(tabId);
            const pageDom = await window.electronAPI.aiGetPageDOM(tabId);
            executionResult = {
              success: true,
              result: {
                url: (window._tabs || []).find(t => t.id === tabId)?.url,
                title: (window._tabs || []).find(t => t.id === tabId)?.title,
                innerText: pageText.slice(0, 15000),
                dom: JSON.parse(pageDom)
              }
            };
          } else if (command === 'search') {
            const query = params?.query;
            const newTab = params?.newTab !== false;
            if (!query) throw new Error("Missing query parameter");
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            if (newTab) {
              const res = await window.electronAPI.createTab(searchUrl);
              await waitForPageLoad();
              executionResult = { success: true, result: `Created new tab with ID ${res?.id} and searched for "${query}"` };
            } else {
              await window.electronAPI.navigateTab({ tabId: window._activeTabId, url: searchUrl });
              await waitForPageLoad();
              executionResult = { success: true, result: `Searched for "${query}" in active tab` };
            }
          } else if (command === 'write-file') {
            const filename = params?.filename;
            const content = params?.content;
            if (!filename) throw new Error("Missing filename parameter");
            if (content === undefined) throw new Error("Missing content parameter");
            const res = await window.electronAPI.aiSaveFile(filename, content);
            if (res.success) {
              executionResult = { success: true, result: `Saved file to ${res.filePath}` };
            } else {
              throw new Error(res.error);
            }
          } else if (command === 'download-file') {
            const url = params?.url;
            if (!url) throw new Error("Missing url parameter");
            const res = await window.electronAPI.aiDownloadFile(url);
            if (res.success) {
              executionResult = { success: true, result: { filePath: res.filePath, filename: res.filename } };
            } else {
              throw new Error(res.error);
            }
          } else if (command === 'analyse-document') {
            const filePath = params?.filePath;
            const mimeType = params?.mimeType || 'application/pdf';
            const name = params?.name || 'document';
            if (!filePath) throw new Error("Missing filePath parameter");
            const res = await window.electronAPI.aiAnalyseDocument(filePath, mimeType, name);
            if (res && res.text) {
              executionResult = { success: true, result: res.text };
            } else {
              throw new Error(res ? res.error : "Failed to analyze document");
            }
          } else if (command === 'save-state') {
            const res = await window.electronAPI.aiSaveState();
            if (res.success) {
              executionResult = { success: true, result: `Saved browser state with ${res.savedCount} tabs.` };
            } else {
              throw new Error(res.error);
            }
          } else if (command === 'restore-state') {
            const res = await window.electronAPI.aiRestoreState();
            if (res.success) {
              executionResult = { success: true, result: `Restored browser state with ${res.restoredCount} tabs.` };
            } else {
              throw new Error(res.error);
            }
          } else if (command === 'batch-generate') {
            const prompts = params?.prompts;
            const sysIns = params?.systemInstruction;
            if (!prompts || !Array.isArray(prompts)) throw new Error("Missing prompts array parameter");
            const res = await window.electronAPI.aiBatchGenerate({ prompts, systemInstruction: sysIns });
            if (res.error) throw new Error(res.error);
            executionResult = { success: true, result: res.results };
          } else if (command === 'set-memory') {
            const key = params?.key;
            const value = params?.value;
            if (!key) throw new Error("Missing key parameter");
            aiMemory[key] = value;
            renderWorkingMemory();
            executionResult = { success: true, result: `Stored key "${key}" in cross-tab memory` };
          } else if (command === 'get-memory') {
            const key = params?.key;
            if (!key) throw new Error("Missing key parameter");
            const val = aiMemory[key];
            executionResult = { success: true, result: { key, value: val !== undefined ? val : null } };
          } else if (command === 'get-persona') {
            const dataStr = localStorage.getItem('devilbrowser-persona');
            const data = dataStr ? JSON.parse(dataStr) : {};
            executionResult = { success: true, result: data };
          } else if (command === 'search-credential') {
            const targetDomain = params?.domain ? params.domain.toLowerCase() : '';
            if (!targetDomain) throw new Error("Missing domain parameter");
            
            const listRes = await window.electronAPI.listCredentials();
            if (listRes.success && listRes.list) {
              const matched = listRes.list.find(cred => cred.domain.includes(targetDomain) || targetDomain.includes(cred.domain));
              if (matched) {
                const getRes = await window.electronAPI.getCredential(matched.key);
                if (getRes.success && getRes.credential) {
                  executionResult = { success: true, result: getRes.credential };
                } else {
                  throw new Error(getRes.error || "Failed to retrieve decrypted credential details");
                }
              } else {
                executionResult = { success: true, result: null, message: `No credential match found for domain: ${targetDomain}` };
              }
            } else {
              throw new Error(listRes.error || "Failed to list credentials locker contents");
            }
          } else if (command === 'ask-user') {
            const prompt = params?.prompt;
            const options = params?.options;
            if (!prompt) throw new Error("Missing prompt parameter");

            // 1. Notify the HUD to show input request
            if (window.aiTaskHUD) {
              window.aiTaskHUD.requestInput(prompt, options);
            }

            // 2. Also append a message to the AI Panel chat asking the user
            appendMessage('model', `❓ **AI Question:** ${prompt}`);
            if (options && options.length > 0) {
              // Append option buttons inside the chat if they want to click there
              const optionsBubble = appendMessage('model', `Please select an option:`);
              if (optionsBubble) {
                optionsBubble.innerHTML = '';
                const btnContainer = document.createElement('div');
                btnContainer.className = 'ai-chat-options-container';
                btnContainer.style.cssText = 'display: flex; flex-direction: column; gap: 6px; margin-top: 8px;';
                options.forEach(opt => {
                  const btn = document.createElement('button');
                  btn.className = 'ai-chat-option-btn';
                  btn.style.cssText = 'padding: 6px 12px; background: rgba(139, 92, 246, 0.15); border: 1px solid var(--border); border-radius: 4px; color: var(--text); cursor: pointer; text-align: left; transition: background 0.2s;';
                  btn.textContent = opt;
                  btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(139, 92, 246, 0.3)');
                  btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(139, 92, 246, 0.15)');
                  btn.addEventListener('click', () => {
                    if (window.aiPanel.resolveUserPrompt) {
                      window.aiPanel.resolveUserPrompt(opt);
                    }
                  });
                  btnContainer.appendChild(btn);
                });
                optionsBubble.appendChild(btnContainer);
              }
            } else {
              appendMessage('model', `Please type your reply in the input field below.`);
            }

            // 3. Wait for the user response (either from HUD or from Chat)
            const userResponse = await new Promise((resolve, reject) => {
              const onResponse = (response) => {
                cleanup();
                resolve(response);
              };
              const onCancel = () => {
                cleanup();
                reject(new Error("Agent aborted by user while waiting for input"));
              };

              // Listen to HUD input response
              const removeResponseListener = window.electronAPI.on('hud-user-response', onResponse);
              const removeCancelListener = window.electronAPI.on('hud-cancel-triggered', onCancel);

              // Global callback for Chat resolve
              window.aiPanel.resolveUserPrompt = (response) => {
                onResponse(response);
              };

              function cleanup() {
                removeResponseListener();
                removeCancelListener();
                window.aiPanel.resolveUserPrompt = null;
                if (window.aiTaskHUD) {
                  window.aiTaskHUD.clearRequestInput();
                }
              }
            });

            appendMessage('user', `💬 **User Response:** ${userResponse}`);
            executionResult = { success: true, result: userResponse };
          } else if (command === 'scroll-page') {
            const direction = params?.direction || 'down';
            const amount = params?.amount || 400;
            const tabId = params?.tabId || window._activeTabId;
            let script = '';
            if (direction === 'down') script = `window.scrollBy({ top: ${amount}, behavior: 'smooth' });`;
            else if (direction === 'up') script = `window.scrollBy({ top: -${amount}, behavior: 'smooth' });`;
            else if (direction === 'top') script = `window.scrollTo({ top: 0, behavior: 'smooth' });`;
            else if (direction === 'bottom') script = `window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });`;
            
            await window.electronAPI.aiExecutePageAction(script, tabId);
            await new Promise(resolve => setTimeout(resolve, 800));
            executionResult = { success: true, result: `Scrolled page ${direction}` };
          } else if (command === 'screenshot-tab') {
            const tabId = params?.tabId || window._activeTabId;
            const res = await window.electronAPI.aiGetPageScreenshot(tabId);
            if (res && res.success && res.base64Data) {
              nextTurnScreenshot = res.base64Data;
              nextTurnScreenshotMime = "image/png";
              executionResult = { 
                success: true, 
                result: { 
                  message: "Screenshot captured successfully and attached to your visual field for the next step.",
                  mimeType: "image/png",
                  base64Length: res.base64Data.length
                } 
              };
            } else {
              throw new Error(res?.error || "Failed to capture screenshot");
            }
          } else if (command === 'zoom-page') {
            const level = params?.level || 'reset';
            const tabId = params?.tabId || window._activeTabId;
            let currentZoom = await window.electronAPI.getZoomLevel(tabId) || 1;
            let targetZoom = currentZoom;
            if (level === 'in') targetZoom = currentZoom + 0.1;
            else if (level === 'out') targetZoom = Math.max(0.2, currentZoom - 0.1);
            else if (level === 'reset') targetZoom = 1;
            
            await window.electronAPI.setZoomLevel(tabId, targetZoom);
            executionResult = { success: true, result: `Set zoom level to ${Math.round(targetZoom * 100)}%` };
          } else if (command === 'mute-tab') {
            const mute = !!params?.mute;
            const tabId = params?.tabId || window._activeTabId;
            await window.electronAPI.setTabMuted(tabId, mute);
            executionResult = { success: true, result: `Tab ${tabId} muted: ${mute}` };
          } else if (command === 'duplicate-tab') {
            const tabId = params?.tabId || window._activeTabId;
            await window.electronAPI.duplicateTab(tabId);
            await new Promise(resolve => setTimeout(resolve, 500));
            executionResult = { success: true, result: `Duplicated tab ${tabId}` };
          } else if (command === 'pin-tab') {
            const tabId = params?.tabId || window._activeTabId;
            await window.electronAPI.togglePinTab(tabId);
            executionResult = { success: true, result: `Toggled pin state of tab ${tabId}` };
          } else if (command === 'print-page') {
            const tabId = params?.tabId || window._activeTabId;
            await window.electronAPI.printPage(tabId);
            executionResult = { success: true, result: `Opened print dialog for tab ${tabId}` };
          } else if (command === 'save-page') {
            const tabId = params?.tabId || window._activeTabId;
            await window.electronAPI.savePage(tabId);
            executionResult = { success: true, result: `Triggered page saving sequence for tab ${tabId}` };
          } else if (command === 'find-in-page') {
            const text = params?.text;
            const tabId = params?.tabId || window._activeTabId;
            if (!text) throw new Error("Missing text parameter for search query");
            await window.electronAPI.findInPage(tabId, text);
            executionResult = { success: true, result: `Initiated find in page for text "${text}" on tab ${tabId}` };
          } else {
            throw new Error(`Unknown browser command: ${command}`);
          }
        } catch (err) {
          executionResult = { success: false, error: err.message };
        }

        if (execBubble) {
          execBubble.classList.remove('streaming');
        }

        if (executionResult.success) {
          if (execBubble) execBubble.innerHTML = renderMarkdown(`✅ **Success:** Command \`${command}\` executed.`);
        } else {
          if (execBubble) execBubble.innerHTML = renderMarkdown(`❌ **Error:** Command \`${command}\` failed: ${executionResult.error}`);
        }
      } else {
        // Standard page-automation
        const { script, tabId } = action_input;
        appendMessage('model', `🤖 **Step ${step} Thought:** *${thought}*`);
        const execBubble = appendMessage('model', `⏳ **Executing browser action...**`);
        if (execBubble) execBubble.classList.add('streaming');

        executionResult = await window.electronAPI.aiExecutePageAction(script, tabId);

        if (execBubble) {
          execBubble.classList.remove('streaming');
        }

        if (executionResult.success) {
          if (execBubble) execBubble.innerHTML = renderMarkdown(`✅ **Success:** Action executed successfully!`);
          await waitForPageLoad();
        } else {
          if (execBubble) execBubble.innerHTML = renderMarkdown(`❌ **Error:** Action failed: ${executionResult.error}`);
        }
      }

      // 5. Update prompt and history with feedback
      let feedbackText = "";
      if (executionResult.success) {
        feedbackText = `[Action Result of Step ${step}]\nSuccess: true\nResult returned: ${JSON.stringify(executionResult.result ?? executionResult)}\n\nReview the updated page context below and decide on your next action or provide the final response to the user.`;
        lastScriptFailed = false;
      } else {
        feedbackText = `[Action Result of Step ${step}]\nSuccess: false\nError: ${executionResult.error}\n\n`;
        if (action === 'page-automation') {
          const { script } = action_input;
          if (lastScript === script && lastScriptFailed) {
            feedbackText += `[System Warning: You repeated the exact same script that just failed. Please write a different script, use different selectors, or verify if the elements exist in the DOM context. Do not output the same failing script again.]\n\n`;
          }
          lastScript = script;
          lastScriptFailed = true;
        } else {
          lastScriptFailed = false; // Reset for browser actions
        }
        feedbackText += `Review the error and try a different script, command or selector, or explain the issue to the user.`;
      }

      // Push system update turn to history so the model knows it occurred
      history.push({ role: 'user', text: `[System Update] Browser action result: ${JSON.stringify(executionResult)}` });

        currentDisplayPrompt = null; // Don't append user bubble for next loop turn
        currentApiPrompt = feedbackText;
      }
    } finally {
      cleanupLoop();
    }
  }

  // ------- Send Button State -------
  function updateSendBtnState(loading) {
    if (!btnSend) return;
    if (loading) {
      btnSend.classList.add('loading');
      btnSend.disabled = true;
      btnSend.innerHTML = `<svg class="spin-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>`;
    } else {
      btnSend.classList.remove('loading');
      btnSend.disabled = false;
      btnSend.innerHTML = `➤`;
    }
  }

  // ------- Send Message -------
  async function sendMessage() {
    if (!panelInput) return;
    const text = panelInput.value.trim();
    if (!text) return;

    if (window.aiPanel.resolveUserPrompt) {
      panelInput.value = '';
      panelInput.style.height = 'auto';
      const charCount = document.getElementById('ai-input-char-count');
      if (charCount) charCount.textContent = '';
      window.aiPanel.resolveUserPrompt(text);
      return;
    }

    if (isStreaming) return;

    panelInput.value = '';
    panelInput.style.height = 'auto';
    // Update char counter
    const charCount = document.getElementById('ai-input-char-count');
    if (charCount) charCount.textContent = '';

    await runAgentLoop(text);
  }

  // ------- Summarise Page -------
  async function summarisePage() {
    if (isStreaming) return;
    try {
      const pageText = await window.electronAPI.aiGetPageText();
      if (!pageText || pageText.trim().length < 50) {
        appendMessage('system', '⚠️ Not enough content on this page to summarise.');
        return;
      }
      openPanel();
      const prompt = `Please summarise the following web page content in a clear, bullet-pointed format. Highlight the key points and main takeaways:\n\n${pageText.slice(0, 12000)}`;
      panelInput.value = '';
      appendMessage('user', '📄 Summarise this page');
      await streamGenerate(prompt, 'You are a concise web page summariser. Respond with clear bullet points.');
    } catch (e) {
      appendMessage('system', '⚠️ Could not extract page content: ' + e.message);
    }
  }

  // ------- Voice Input (Native MediaRecorder) -------
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecordingAudio = false;
  let audioStartTime = 0;

  function initVoice() {
    console.log("AI Voice recording system initialized.");
  }

  function selectAudioCapableModel() {
    if (!modelSelect) return;
    const audioModelsOrdered = [
      'Gemini 2.5 Flash Native Audio Dialog',
      'Gemini 3.1 Flash TTS',
      'Gemini 3.5 Live Translate',
      'Gemini 3.1 Flash Lite'
    ];
    
    for (const modelName of audioModelsOrdered) {
      const option = Array.from(modelSelect.options).find(opt => opt.value === modelName);
      if (option) {
        modelSelect.value = modelName;
        console.log(`Auto-selected audio-capable model: ${modelName}`);
        break;
      }
    }
  }

  async function startAudioRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/ogg';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/wav';
      }
      
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Data = reader.result.split(',')[1];
          const duration = Math.round((Date.now() - audioStartTime) / 1000);
          
          appendMessage('user', `🎙️ *Voice Message (${duration}s)*`);
          
          const voiceFile = {
            name: `voice-input-${Date.now()}.webm`,
            size: audioBlob.size,
            path: null,
            type: 'video/webm',
            data: base64Data
          };
          
          sessionFiles.push(voiceFile);
          
          selectAudioCapableModel();
          
          if (panelInput) panelInput.value = 'Attached voice message.';
          await sendMessage();
        };
        reader.readAsDataURL(audioBlob);
        
        stream.getTracks().forEach(track => track.stop());
      };
      
      audioStartTime = Date.now();
      mediaRecorder.start();
      isRecordingAudio = true;
      isListening = true;
      if (btnVoice) {
        btnVoice.classList.add('listening');
        btnVoice.title = 'Stop Recording Voice';
      }
      if (window.showToastNotification) {
        window.showToastNotification('Recording voice... Click mic again to send.');
      }
    } catch (err) {
      console.error("Microphone access failed:", err);
      isRecordingAudio = false;
      isListening = false;
      if (btnVoice) {
        btnVoice.classList.remove('listening');
      }
      if (window.showToastNotification) {
        window.showToastNotification('⚠️ Microphone access error: ' + err.message);
      }
    }
  }

  function stopAudioRecording() {
    if (mediaRecorder && isRecordingAudio) {
      try {
        mediaRecorder.stop();
      } catch (e) {}
      isRecordingAudio = false;
      isListening = false;
      if (btnVoice) {
        btnVoice.classList.remove('listening');
        btnVoice.title = 'Start Recording Voice';
      }
    }
  }

  function toggleListening() {
    if (isRecordingAudio) {
      shouldResumeVoiceInput = false;
      stopAudioRecording();
    } else {
      shouldResumeVoiceInput = true;
      startAudioRecording();
    }
  }

  function startListening() {
    if (!isRecordingAudio) {
      startAudioRecording();
    }
  }

  function stopListening() {
    if (isRecordingAudio) {
      stopAudioRecording();
    }
  }

  // ------- Voice Output (Text-to-Speech) -------
  function initVoiceOutput() {
    updateSpeakerButtonUI();
    if (btnSpeaker) {
      btnSpeaker.addEventListener('click', toggleVoiceOutput);
    }
  }

  function toggleVoiceOutput() {
    voiceOutputEnabled = !voiceOutputEnabled;
    localStorage.setItem('devilbrowser-voice-output', String(voiceOutputEnabled));
    updateSpeakerButtonUI();
    if (!voiceOutputEnabled) {
      stopSpeaking();
    }
  }

  function updateSpeakerButtonUI() {
    if (!btnSpeaker) return;
    btnSpeaker.classList.toggle('active', voiceOutputEnabled);
    btnSpeaker.title = voiceOutputEnabled ? 'Mute AI Voice Response' : 'Unmute AI Voice Response';
    
    if (speakerIcon) {
      if (voiceOutputEnabled) {
        speakerIcon.innerHTML = `<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>`;
      } else {
        speakerIcon.innerHTML = `<path fill="currentColor" d="M3.63 3.63L2.36 4.9 7.46 10H3v4h3l5 5v-6.17l5.3 5.3c-.76.56-1.6.99-2.3 1.25v2.07c1.23-.32 2.65-.98 3.73-1.85l3.22 3.22 1.27-1.27L3.63 3.63zM9 13H5v-2h2.46L9 12.54V13zm3-7.54v2.88l2 2V3.46L12 5.46zm4.5 6.54c0-.85-.35-1.61-.92-2.16l1.46-1.46c1.1.98 1.96 2.43 1.96 4.12 0 1.23-.46 2.37-1.21 3.25l-1.46-1.46c.46-.57.71-1.34.71-2.29zm2.5 0c0-2.37-.96-4.51-2.5-6.07l1.42-1.42C21.84 5.92 23 8.82 23 12c0 2.3-.61 4.46-1.68 6.32l-1.48-1.48c.73-1.35 1.16-2.91 1.16-4.84z"/>`;
      }
    }
  }

  function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      stopSpeaking();
      
      const cleanText = text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/🤖\s*\*\*Step\s*\d+\s*Thought:\*\*/g, '')
        .replace(/⏳\s*\*\*Executing[\s\S]*?\*\*/g, '')
        .trim();

      if (!cleanText) {
        if (voiceOutputEnabled && shouldResumeVoiceInput) {
          startListening();
        }
        return;
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'en-US';
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(v => v.name.includes('Google') || v.name.includes('Natural') || v.lang === 'en-US');
      if (preferredVoice) utterance.voice = preferredVoice;

      utterance.onstart = () => {
        stopListening();
      };

      utterance.onend = () => {
        if (voiceOutputEnabled && shouldResumeVoiceInput) {
          startListening();
        }
      };

      utterance.onerror = () => {
        if (voiceOutputEnabled && shouldResumeVoiceInput) {
          startListening();
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("Speech Synthesis error:", e);
      if (voiceOutputEnabled && shouldResumeVoiceInput) {
        startListening();
      }
    }
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        console.error("Failed to cancel speech synthesis:", e);
      }
    }
  }

  // ------- Think Mode -------
  function toggleThink() {
    thinkMode = !thinkMode;
    if (btnThink) {
      btnThink.classList.toggle('active', thinkMode);
      btnThink.title = thinkMode ? 'Deep Think: ON (click to disable)' : 'Enable Deep Think mode';
    }
  }

  // ------- Event Wiring -------
  if (btnSend) btnSend.addEventListener('click', sendMessage);
  if (btnClear) btnClear.addEventListener('click', () => { history = []; renderMessages(); sessionFiles = []; renderFilesList(); stopSpeaking(); });
  if (btnClose) btnClose.addEventListener('click', () => { closePanel(); stopSpeaking(); });
  if (btnSummarise) btnSummarise.addEventListener('click', summarisePage);
  if (btnVoice) btnVoice.addEventListener('click', toggleListening);
  if (btnThink) btnThink.addEventListener('click', toggleThink);
  if (btnScreenshot) {
    btnScreenshot.addEventListener('click', async () => {
      const token = await window.electronAPI.aiGetToken();
      if (!token) {
        if (window.aiAuth) window.aiAuth.showModal();
        return;
      }
      appendMessage('user', '📸 Capturing tab screenshot...');
      const res = await window.electronAPI.aiGetPageScreenshot();
      if (res && res.base64Data) {
        appendMessage('user', '📸 Screenshot captured! Analysing page content...');
        await streamGenerate('Analyze this screenshot. What visual elements or text are shown? Summarize the main message or information of this image.', null, res.base64Data, 'image/png');
      } else {
        appendMessage('system', '⚠️ Failed to capture screenshot: ' + (res.error || 'unknown error'));
      }
    });
  }
  if (btnAiToggle) btnAiToggle.addEventListener('click', () => window.aiPanel.toggle());

  if (panelInput) {
    panelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    panelInput.addEventListener('input', () => {
      panelInput.style.height = 'auto';
      panelInput.style.height = Math.min(panelInput.scrollHeight, 160) + 'px';
      // Character count display
      const charCount = document.getElementById('ai-input-char-count');
      const len = panelInput.value.length;
      if (charCount) {
        charCount.textContent = len > 20 ? `${len}` : '';
        charCount.classList.toggle('warn', len > 800);
      }
      // Show/hide send button based on content
      if (btnSend) {
        btnSend.style.opacity = len > 0 ? '1' : '0.5';
        btnSend.style.transform = len > 0 ? 'scale(1)' : 'scale(0.92)';
      }
    });
    panelInput.addEventListener('focus', () => {
      panelInput.closest('.ai-input-area')?.classList.add('focused');
    });
    panelInput.addEventListener('blur', () => {
      panelInput.closest('.ai-input-area')?.classList.remove('focused');
    });
  }

  // Listen to IPC events for context actions
  window.electronAPI.on('ai-context-action', (data) => {
    if (!data) return;
    if (data.action === 'social-pilot-new-msg') {
      runAutoPilotTick(data.tabId);
    } else if (data.action === 'analyse-image') {
      window.aiPanel.analyseImage(data.imageData, data.mimeType);
    } else {
      window.aiPanel.sendContextAction(data.action, data.text);
    }
  });

  // Listen to ai: address bar
  window.addEventListener('ai-address-query', (e) => {
    openPanel();
    if (panelInput) panelInput.value = e.detail;
    sendMessage();
  });

  // Listen to tab state updates to synchronize the AI page context title dynamically
  window.electronAPI.on('tab-activated', () => {
    updatePageContext();
  });
  window.electronAPI.on('tab-url-updated', (data) => {
    const activeTabId = window._activeTabId;
    if (data.id === activeTabId) updatePageContext();
  });
  window.electronAPI.on('tab-title-updated', (data) => {
    const activeTabId = window._activeTabId;
    if (data.id === activeTabId) updatePageContext();
  });
  window.electronAPI.on('tab-closed', () => {
    updatePageContext();
  });

  // Init on DOM ready
  initVoice();
  initVoiceOutput();
  renderMessages();

  // ── AI Panel Tab Layout Initialization ──
  function initTabs() {
    const tabs = document.querySelectorAll('.ai-tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.ai-tab-content').forEach(content => {
          const isTarget = content.id === `ai-tab-content-${targetTab}`;
          content.classList.toggle('hidden', !isTarget);
        });
        if (targetTab === 'tasks') {
          loadRecentTasks();
        } else if (targetTab === 'memory') {
          loadMemoryTab();
        } else if (targetTab === 'files') {
          loadFilesTab();
        } else if (targetTab === 'pilot') {
          updateAutoPilotUI();
        }
      });
    });

    const saveProfileBtn = document.getElementById('btn-save-ai-profile');
    if (saveProfileBtn) {
      saveProfileBtn.addEventListener('click', saveMemoryProfile);
    }

    const clearIndexBtn = document.getElementById('btn-clear-semantic-index');
    if (clearIndexBtn) {
      clearIndexBtn.addEventListener('click', clearSemanticIndex);
    }
  }

  async function loadRecentTasks() {
    const listEl = document.getElementById('tasks-history-list');
    if (!listEl) return;
    try {
      const res = await window.electronAPI.aiGetLogs({ limit: 10 });
      if (res && res.logs && res.logs.length > 0) {
        listEl.innerHTML = '';
        res.logs.forEach(log => {
          const item = document.createElement('div');
          item.style.cssText = 'padding: 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: rgba(255,255,255,0.02); display: flex; flex-direction: column; gap: 4px; font-size: 11px;';
          
          const header = document.createElement('div');
          header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
          
          const date = new Date(log.timestamp || Date.now()).toLocaleTimeString();
          const model = log.model || 'Unknown';
          const status = log.status === 'success' ? '🟢 Success' : (log.status === 'error' ? '🔴 Error' : '🟡 Active');
          
          header.innerHTML = `<span style="color: var(--text-muted);">${date} · ${model}</span><span>${status}</span>`;
          
          const prompt = document.createElement('div');
          prompt.style.cssText = 'color: var(--text-primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;';
          prompt.textContent = log.prompt || 'No prompt';
          prompt.title = log.prompt;
          prompt.addEventListener('click', () => {
            document.querySelector('.ai-tab-btn[data-tab="chat"]')?.click();
            if (panelInput) {
              panelInput.value = log.prompt;
              sendMessage();
            }
          });
          
          item.appendChild(header);
          item.appendChild(prompt);
          listEl.appendChild(item);
        });
      } else {
        listEl.innerHTML = '<div style="font-size: var(--text-xs); color: var(--text-muted); font-style: italic; text-align: center; padding: 12px;">No recent automations.</div>';
      }
    } catch (e) {
      listEl.innerHTML = '<div style="font-size: var(--text-xs); color: var(--rose); text-align: center; padding: 12px;">Failed to load recent tasks.</div>';
    }
  }

  async function loadMemoryTab() {
    try {
      const prefs = await window.electronAPI.getPreferences();
      const profile = prefs.aiProfile || { jobTitle: '', writingStyle: 'professional', persona: '' };
      
      const jobEl = document.getElementById('pref-job-title');
      const styleEl = document.getElementById('pref-writing-style');
      const personaEl = document.getElementById('pref-persona-desc');
      
      if (jobEl) jobEl.value = profile.jobTitle || '';
      if (styleEl) styleEl.value = profile.writingStyle || 'professional';
      if (personaEl) personaEl.value = profile.persona || '';
      
      updateSemanticIndexCount();
      renderWorkingMemory();
    } catch (e) {
      console.error('Failed to load memory tab preferences:', e);
    }
  }

  async function saveMemoryProfile() {
    const jobEl = document.getElementById('pref-job-title');
    const styleEl = document.getElementById('pref-writing-style');
    const personaEl = document.getElementById('pref-persona-desc');
    
    const profile = {
      jobTitle: jobEl ? jobEl.value.trim() : '',
      writingStyle: styleEl ? styleEl.value : 'professional',
      persona: personaEl ? personaEl.value.trim() : ''
    };
    
    try {
      await window.electronAPI.savePreferences({ aiProfile: profile });
      if (window.showToastNotification) {
        window.showToastNotification('🧠 Profile preferences saved!');
      }
    } catch (e) {
      console.error('Failed to save profile preferences:', e);
    }
  }

  async function updateSemanticIndexCount() {
    const countEl = document.getElementById('semantic-index-count');
    if (!countEl) return;
    try {
      const count = await window.electronAPI.aiGetIndexedCount();
      countEl.textContent = `${count} page${count === 1 ? '' : 's'} indexed`;
    } catch (e) {
      countEl.textContent = 'Error loading count';
    }
  }

  async function clearSemanticIndex() {
    try {
      const res = await window.electronAPI.aiClearIndexedPages();
      if (res && res.success) {
        updateSemanticIndexCount();
        if (window.showToastNotification) {
          window.showToastNotification('🗑️ Semantic index cleared!');
        }
      }
    } catch (e) {
      console.error('Failed to clear semantic index:', e);
    }
  }

  function renderWorkingMemory() {
    const listEl = document.getElementById('working-memory-list');
    if (!listEl) return;
    
    const keys = Object.keys(aiMemory);
    if (keys.length > 0) {
      listEl.innerHTML = '';
      keys.forEach(k => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; justify-content: space-between; font-size: 11px; padding: 4px; border-bottom: 1px solid rgba(255,255,255,0.02);';
        item.innerHTML = `<span style="color: var(--accent-bright); font-weight: 500;">${k}</span><span style="color: var(--text-primary); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;" title="${aiMemory[k]}">${aiMemory[k]}</span>`;
        listEl.appendChild(item);
      });
    } else {
      listEl.innerHTML = '<div style="font-size: var(--text-xs); color: var(--text-muted); font-style: italic; text-align: center; padding: 8px;">Working memory is currently empty.</div>';
    }
  }

  function loadFilesTab() {
    initFilesDropzone();
    renderFilesList();
  }

  function initFilesDropzone() {
    const dropzone = document.getElementById('files-dropzone');
    if (!dropzone || dropzone.dataset.initialized) return;
    dropzone.dataset.initialized = 'true';

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, () => dropzone.style.background = 'rgba(139, 92, 246, 0.1)', false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, () => dropzone.style.background = 'rgba(139, 92, 246, 0.02)', false);
    });

    dropzone.addEventListener('drop', handleDrop, false);

    dropzone.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.docx,.doc,.xlsx,.xls,.csv,.mp4,.webm,.mov';
      input.onchange = (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          handleDroppedFile(files[0], true);
        }
      };
      input.click();
    };
  }

  function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      handleDroppedFile(files[0], true);
    }
  }

  function handleDroppedFile(file, autoAnalyse = true) {
    const ext = file.name.split('.').pop().toLowerCase();
    const supportedExts = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'mp4', 'webm', 'mov'];
    if (!supportedExts.includes(ext)) {
      if (window.showToastNotification) {
        window.showToastNotification('⚠️ Unsupported file type! Drop PDF, Word, Excel, CSV, or Video.');
      }
      return;
    }
    
    const filePath = file.path;
    const mimeTypesMap = {
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc': 'application/msword',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls': 'application/vnd.ms-excel',
      'csv': 'text/csv',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mov': 'video/quicktime'
    };
    const fileType = file.type || mimeTypesMap[ext] || 'application/octet-stream';

    const newFile = {
      name: file.name,
      size: file.size,
      path: filePath,
      type: fileType
    };

    if (sessionFiles.some(f => f.path === filePath)) return;

    sessionFiles.push(newFile);
    renderFilesList();
    renderChatAttachedFiles();

    // Do not auto-analyse videos since they are natively processed multimodal parts,
    // not text content sheets.
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
    if (autoAnalyse && !isVideo) {
      window.aiPanel.analyseDocument(filePath, fileType, file.name);
    }
  }

  function renderFilesList() {
    const listEl = document.getElementById('files-context-list');
    if (!listEl) return;
    
    if (sessionFiles.length > 0) {
      listEl.innerHTML = '';
      sessionFiles.forEach((file, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'padding: 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: rgba(255,255,255,0.02); display: flex; flex-direction: column; gap: 4px; font-size: 11px;';
        
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
        
        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color: var(--text-primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;';
        nameSpan.textContent = file.name;
        nameSpan.title = file.path;
        
        const removeBtn = document.createElement('button');
        removeBtn.style.cssText = 'background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 10px;';
        removeBtn.innerHTML = '✕';
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          sessionFiles.splice(idx, 1);
          renderFilesList();
        };
        
        header.appendChild(nameSpan);
        header.appendChild(removeBtn);
        
        const footer = document.createElement('div');
        footer.style.cssText = 'display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted);';
        
        const sizeStr = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        footer.innerHTML = `<span>Size: ${sizeStr}</span><span style="color: var(--accent-bright); cursor: pointer;">Ask AI about this</span>`;
        
        footer.querySelector('span:last-child').addEventListener('click', () => {
          window.aiPanel.analyseDocument(file.path, file.type, file.name);
        });

        item.appendChild(header);
        item.appendChild(footer);
        listEl.appendChild(item);
      });
    } else {
      listEl.innerHTML = `
        <div class="no-files-hint" style="font-size: var(--text-xs); color: var(--text-muted); font-style: italic; text-align: center; padding: 16px; border: 1px dashed var(--border); border-radius: var(--r-md); background: rgba(0,0,0,0.1);">
          No documents attached to session. Drag a document to summarize or query it.
        </div>`;
    }
    renderChatAttachedFiles();
  }

  function renderChatAttachedFiles() {
    const previewEl = document.getElementById('ai-attached-files-preview');
    if (!previewEl) return;
    
    if (sessionFiles.length > 0) {
      previewEl.classList.remove('hidden');
      previewEl.innerHTML = '';
      sessionFiles.forEach((file, idx) => {
        const chip = document.createElement('div');
        chip.className = 'ai-file-chip';
        
        const ext = file.name.split('.').pop().toLowerCase();
        const icon = ext === 'pdf' ? '📄' : 
                     (ext === 'csv' || ext.includes('xls')) ? '📊' :
                     ['mp4', 'webm', 'mov'].includes(ext) ? '🎥' : '📄';
                     
        chip.innerHTML = `
          <span>${icon} ${file.name}</span>
          <button class="ai-file-chip-remove" title="Remove attachment">✕</button>
        `;
        
        chip.querySelector('.ai-file-chip-remove').onclick = (e) => {
          e.stopPropagation();
          sessionFiles.splice(idx, 1);
          renderChatAttachedFiles();
          renderFilesList();
        };
        
        previewEl.appendChild(chip);
      });
    } else {
      previewEl.classList.add('hidden');
      previewEl.innerHTML = '';
    }
  }

  function initChatAttachments() {
    const attachBtn = document.getElementById('ai-panel-attach');
    if (attachBtn) {
      attachBtn.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,.docx,.doc,.xlsx,.xls,.csv,.mp4,.webm,.mov';
        input.onchange = (e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            handleDroppedFile(files[0], false);
          }
        };
        input.click();
      };
    }
    
    const panelInputEl = document.getElementById('ai-panel-input');
    if (panelInputEl) {
      panelInputEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      panelInputEl.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          handleDroppedFile(files[0], false);
        }
      });
    }
  }

  // ------- Social Auto-Pilot Implementation -------
  function initAutoPilot() {
    const btnToggle = document.getElementById('btn-toggle-pilot');
    if (!btnToggle) return;

    btnToggle.addEventListener('click', () => {
      if (isAutoPilotActive) {
        stopAutoPilot();
      } else {
        startAutoPilot();
      }
    });

    const moodSelect = document.getElementById('pilot-mood');
    if (moodSelect) {
      moodSelect.addEventListener('change', () => {
        autoPilotMood = moodSelect.value;
      });
    }

    const platformSelect = document.getElementById('pilot-platform');
    if (platformSelect) {
      platformSelect.addEventListener('change', () => {
        autoPilotPlatform = platformSelect.value;
      });
    }

    const modeSelect = document.getElementById('pilot-mode');
    if (modeSelect) {
      modeSelect.addEventListener('change', () => {
        autoPilotMode = modeSelect.value;
      });
    }

    // Typing style file reader bindings
    const dropzone = document.getElementById('pilot-style-dropzone');
    const fileInput = document.getElementById('pilot-style-input');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          handleStyleFile(files[0]);
        }
      });

      // drag & drop
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.background = 'rgba(139, 92, 246, 0.08)';
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.style.background = 'rgba(139, 92, 246, 0.02)';
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.background = 'rgba(139, 92, 246, 0.02)';
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          handleStyleFile(files[0]);
        }
      });
    }
  }

  function handleStyleFile(file) {
    if (!file) return;
    const isText = file.name.endsWith('.txt') || file.name.endsWith('.json') || file.name.endsWith('.csv');
    if (!isText) {
      if (window.showToastNotification) window.showToastNotification('⚠️ Style file must be a text file (.txt, .json, .csv)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      pilotStyleText = e.target.result || "";
      pilotStyleFileName = file.name;
      updatePilotStyleUI();
      if (window.showToastNotification) window.showToastNotification('🧠 Mimicking style: ' + file.name);
    };
    reader.readAsText(file);
  }

  function updatePilotStyleUI() {
    const hint = document.getElementById('pilot-style-hint');
    if (hint) {
      if (pilotStyleFileName) {
        hint.innerHTML = `✅ <strong>Mimicking style:</strong> ${pilotStyleFileName}<br><span style="font-size: 8px; color: #f43f5e; cursor: pointer; text-decoration: underline;" id="btn-clear-pilot-style">Remove custom style</span>`;
        
        // Wait for element to render, then bind clear button
        setTimeout(() => {
          const btnClearStyle = document.getElementById('btn-clear-pilot-style');
          if (btnClearStyle) {
            btnClearStyle.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              pilotStyleText = "";
              pilotStyleFileName = "";
              updatePilotStyleUI();
              if (window.showToastNotification) window.showToastNotification('Cleared custom style.');
            });
          }
        }, 50);
      } else {
        hint.innerHTML = `📁 Click/Drop WhatsApp .txt export to mimic your style`;
      }
    }
  }

  function startAutoPilot() {
    isAutoPilotActive = true;
    updateAutoPilotUI();
    appendMessage('system', `🚀 **Social Auto-Pilot Enabled** (Mood: ${autoPilotMood}, Mode: ${autoPilotMode === 'fully' ? 'Auto-Send' : 'Draft & Approve'})`);

    // Run tick immediately, then schedule every 15 seconds
    runAutoPilotTick();
    autoPilotInterval = setInterval(runAutoPilotTick, 15000);
  }

  function stopAutoPilot() {
    isAutoPilotActive = false;
    if (autoPilotInterval) {
      clearInterval(autoPilotInterval);
      autoPilotInterval = null;
    }
    updateAutoPilotUI();
    appendMessage('system', '🛑 **Social Auto-Pilot Disabled**');
  }

  function updateAutoPilotUI() {
    const btnToggle = document.getElementById('btn-toggle-pilot');
    const statusDot = document.getElementById('pilot-status-dot');
    const statusText = document.getElementById('pilot-status-text');

    if (!btnToggle) return;

    if (isAutoPilotActive) {
      btnToggle.textContent = '🛑 Stop Auto-Pilot';
      btnToggle.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      btnToggle.style.boxShadow = '0 4px 14px rgba(239, 68, 68, 0.4)';
      if (statusDot) statusDot.style.background = '#10b981'; // Green active
      if (statusText) statusText.textContent = `Auto-Responding on ${autoPilotPlatform === 'auto' ? 'social tabs' : autoPilotPlatform}...`;
    } else {
      btnToggle.textContent = '🚀 Start Auto-Pilot';
      btnToggle.style.background = '';
      btnToggle.style.boxShadow = '';
      if (statusDot) statusDot.style.background = '#9ca3af'; // Grey inactive
      if (statusText) statusText.textContent = 'Auto-Pilot not active';
    }
  }

  async function runAutoPilotTick(forcedTabId) {
    if (!isAutoPilotActive || isStreaming) return;

    // 1. Scan active/inactive tabs to find target chat page
    const tabs = window._tabs || [];
    let targetTab = null;

    if (forcedTabId) {
      targetTab = tabs.find(t => t.id === forcedTabId);
    }

    if (!targetTab) {
      for (const tab of tabs) {
        const url = tab.url ? tab.url.toLowerCase() : '';
        if (autoPilotPlatform === 'instagram' || autoPilotPlatform === 'auto') {
          if (url.includes('instagram.com')) {
            targetTab = tab;
            break;
          }
        }
        if (autoPilotPlatform === 'whatsapp' || autoPilotPlatform === 'auto') {
          if (url.includes('whatsapp.com') || url.includes('web.whatsapp')) {
            targetTab = tab;
            break;
          }
        }
        if (autoPilotPlatform === 'linkedin' || autoPilotPlatform === 'auto') {
          if (url.includes('linkedin.com')) {
            targetTab = tab;
            break;
          }
        }
      }
    }

    if (!targetTab) {
      console.log("Auto-Pilot: No open target social tab matching selection.");
      const statusText = document.getElementById('pilot-status-text');
      if (statusText) statusText.textContent = 'Waiting for social tab...';
      return;
    }

    const platformName = targetTab.url.includes('instagram.com') ? 'Instagram' :
                         targetTab.url.includes('whatsapp.com') || targetTab.url.includes('web.whatsapp') ? 'WhatsApp' : 'LinkedIn';

    // Verify if we are on the DMs / Messaging page path
    const isDMPage = targetTab.url.includes('instagram.com/direct/') || 
                     targetTab.url.includes('web.whatsapp.com') || 
                     targetTab.url.includes('linkedin.com/messaging') ||
                     targetTab.url.includes('linkedin.com/pm');

    if (!isDMPage) {
      console.log(`Auto-Pilot: Connected to ${platformName} but not on active DMs subpage.`);
      const statusText = document.getElementById('pilot-status-text');
      if (statusText) statusText.textContent = `Connected! Go to DMs on ${platformName}`;
      return;
    }

    const statusText = document.getElementById('pilot-status-text');
    if (statusText) statusText.textContent = `Active: ${platformName} (${targetTab.title || 'chat'})`;

    // Inject MutationObserver dynamically
    try {
      const tabId = targetTab.id;
      const observerScript = `
        (function() {
          if (window.__devilAutoPilotObserver) return;
          console.log("Auto-Pilot: MutationObserver active.");
          let lastCount = 0;
          let lastTextLength = document.body ? document.body.innerText.length : 0;
          
          function check() {
            const selectors = [
              'div[role="none"] > div[style*="align-items: flex-end"]',
              'div[role="none"] > div[style*="align-items: flex-start"]',
              '.message-in',
              '.message-out',
              '.msg-s-message-list-item',
              'div[role="row"]',
              'div[class*="message"]'
            ];
            let msgs = [];
            for (const sel of selectors) {
              const found = document.querySelectorAll(sel);
              if (found.length > msgs.length) msgs = found;
            }
            
            const currentTextLength = document.body ? document.body.innerText.length : 0;
            
            if (msgs.length > lastCount) {
              if (lastCount > 0) {
                console.log("Auto-Pilot: New message bubble!");
                window.postMessage({
                  sender: 'devil-browser-injected',
                  type: 'AI_SOCIAL_EVENT',
                  payload: {
                    action: 'social-pilot-new-msg',
                    tabId: ${tabId}
                  }
                }, '*');
              }
              lastCount = msgs.length;
              lastTextLength = currentTextLength;
            } else if (msgs.length < lastCount) {
              lastCount = msgs.length;
              lastTextLength = currentTextLength;
            } else if (msgs.length === 0 && currentTextLength > lastTextLength + 6) {
              // Fallback: Text length changed substantially without matching classes
              console.log("Auto-Pilot: Substantial page text length increase detected!");
              window.postMessage({
                sender: 'devil-browser-injected',
                type: 'AI_SOCIAL_EVENT',
                payload: {
                  action: 'social-pilot-new-msg',
                  tabId: ${tabId}
                }
              }, '*');
              lastTextLength = currentTextLength;
            } else {
              lastTextLength = currentTextLength;
            }
          }
          const observer = new MutationObserver(check);
          observer.observe(document.body, { childList: true, subtree: true });
          window.__devilAutoPilotObserver = observer;
          check();
        })();
      `;
      window.electronAPI.aiExecutePageAction(observerScript, tabId).catch(() => {});
    } catch (e) {
      console.warn("Failed to inject MutationObserver:", e);
    }

    // Show HUD background tick status
    if (window.aiTaskHUD) {
      window.aiTaskHUD.start(`Auto-Pilot: Reading ${platformName} DMs...`);
    }

    try {
      const tabId = targetTab.id;

      // 1. Edge Case: Check if user is actively typing a draft
      const checkUserTypingScript = `
        (function() {
          const active = document.activeElement;
          if (active && (active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true' || active.role === 'textbox')) {
            const text = active.innerText || active.value || '';
            if (text.trim().length > 0) return true;
          }
          return false;
        })()
      `;
      const userTypingRes = await window.electronAPI.aiExecutePageAction(checkUserTypingScript, tabId);
      if (userTypingRes && userTypingRes.result) {
        console.log("Auto-Pilot: Skipping check because owner is actively typing in the chat field.");
        const statusText = document.getElementById('pilot-status-text');
        if (statusText) statusText.textContent = `Active: ${platformName} (User typing...)`;
        return;
      }

      // 2. Fetch structured chat transcript using a universal dynamic midpoint layout check
      const transcriptScript = `
        (function() {
          const transcript = [];
          const scrollContainer = document.querySelector('div[style*="overflow-y: auto"], div[role="presentation"] > div, .copyable-area, div[role="region"], .message-list, .chat-history, .chat-box, [aria-label="Message list"], .im-chat-list') || document.body;
          if (!scrollContainer) return [];

          const parentRect = scrollContainer.getBoundingClientRect();
          const containerMid = parentRect.left + (parentRect.width / 2);

          const elements = Array.from(scrollContainer.querySelectorAll('span[dir="auto"], div[dir="auto"], .copyable-text span, .msg-s-event-listitem__body'));
          
          elements.forEach(el => {
            const text = el.innerText.trim();
            if (!text || text.length > 500) return;
            if (text.includes('\\n')) return;

            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            if (rect.top < parentRect.top - 10 || rect.bottom > parentRect.bottom + 10) return;

            const isRight = rect.left > containerMid;
            const sender = isRight ? 'me' : 'them';
            
            transcript.push({ sender, text });
          });

          const clean = [];
          transcript.forEach(t => {
            if (clean.length > 0 && clean[clean.length - 1].text === t.text && clean[clean.length - 1].sender === t.sender) {
              return;
            }
            clean.push(t);
          });

          return clean.slice(-25);
        })()
      `;

      const transcriptResult = await window.electronAPI.aiExecutePageAction(transcriptScript, tabId);
      const transcript = transcriptResult && transcriptResult.result ? transcriptResult.result : [];
      
      let lastMsgText = "";
      let lastMsgSender = "";
      if (transcript && transcript.length > 0) {
        const lastMsg = transcript[transcript.length - 1];
        lastMsgText = lastMsg.text;
        lastMsgSender = lastMsg.sender;
      }

      // 3. Edge Case: Last message is from me/us
      if (lastMsgSender === 'me') {
        console.log("Auto-Pilot: Last message is from us. Skipping response generation.");
        const statusText = document.getElementById('pilot-status-text');
        if (statusText) statusText.textContent = `Active: ${platformName} (Up to date)`;
        return;
      }

      // 4. Edge Case: Duplicate reply guard check
      const currentGuardKey = targetTab.url + "::" + lastMsgText;
      if (lastMsgText && currentGuardKey === lastRepliedMessageKey) {
        console.log("Auto-Pilot: Already replied to the latest message. Skipping.");
        const statusText = document.getElementById('pilot-status-text');
        if (statusText) statusText.textContent = `Active: ${platformName} (Replied)`;
        return;
      }

      // Show HUD check status
      if (window.aiTaskHUD) {
        window.aiTaskHUD.start(`Auto-Pilot: Evaluating ${platformName} DMs...`);
      }

      // Fetch fallback DOM and page text in case scraper is empty
      const pageText = await window.electronAPI.aiGetPageText(tabId);
      const pageDom = await window.electronAPI.aiGetPageDOM(tabId);

      // Capture page screenshot for visual context
      let screenshotPayload = undefined;
      try {
        const screenshotRes = await window.electronAPI.aiGetPageScreenshot(tabId);
        const base64 = screenshotRes ? (screenshotRes.base64Data || screenshotRes.base64) : null;
        if (base64) {
          screenshotPayload = [{
            type: 'base64',
            mimeType: 'image/png',
            data: base64
          }];
        }
      } catch (e) {
        console.warn("Auto-Pilot: Failed to capture page screenshot:", e);
      }

      // Retrieve owner profile context
      let profileStyle = "";
      try {
        const prefs = await window.electronAPI.getPreferences();
        const profile = prefs.aiProfile || { jobTitle: '', writingStyle: 'casual', persona: '' };
        profileStyle = `Owner Persona context:\n- Job Field: ${profile.jobTitle || 'N/A'}\n- Style preference: ${profile.writingStyle || 'casual'}\n- Personal info: ${profile.persona || 'N/A'}\n\n`;
      } catch (e) {}

      // Retrieve uploaded sample style context
      let sampleStyle = "";
      if (pilotStyleText) {
        sampleStyle = `Owner's typing pattern sample (MIMIC THIS EXACT TYPING STYLE/EMOJI/GRAMMAR):\n${pilotStyleText.slice(0, 15000)}\n\n`;
      }

      // Resolve dynamic mood details
      let moodDetail = `Draft the message in a "${autoPilotMood}" mood.`;
      if (autoPilotMood.includes("GenZ")) {
        moodDetail = `Draft the message in a GenZ mood. This means typing strictly in all-lowercase, using occasional modern text abbreviations and slang (tbh, real, bruh, slay, delulu, or crying 😭 / skull 💀 emojis), and maintaining a dry, casual, or sarcastic tone. 

CRITICAL CONSTRAINT: Do NOT overuse any single slang word or abbreviation like "fr" or "fr fr" repeatedly or multiple times in the same turn. Use them extremely sparingly (at most once in the response, or not at all). Vary vocabulary so it reads like a natural human, not a robotic generator.`;
      }

      // Generate context block
      const systemInstruction = 
        `You are the DevilBrowser Social DM Auto-Pilot Agent responding for the user on ${platformName}.\n` +
        `Your task is to analyze the DM text history, element DOM, and the attached screenshot of the DM page, determine if there is a new message from the other person that requires a reply, and if so, draft the message in a "${autoPilotMood}" mood mimicking the owner's typing style.\n\n` +
        `Mood instructions:\n${moodDetail}\n\n` +
        profileStyle +
        sampleStyle +
        `RULES:\n` +
        `1. Inspect the chat history (last 50 messages) and the attached screenshot. Look at the timestamps, sender bubbles, and any shared reels, memes, stories, or images.\n` +
        `2. Mimic the owner's typing patterns, sentence structure, punctuation (e.g. no caps, specific slangs, lack of full stops), and emoji usage exactly as observed in the sample logs above.\n` +
        `3. If the last message is an image, reel, or media attachment, analyze the screenshot to see the image content and generate a highly contextual response fitting the mood: ${autoPilotMood}.\n` +
        `4. If the last message in the thread is from the OTHER user (not the owner), you MUST formulate a response.\n` +
        `5. If the last message is already from us/owner, DO NOT do anything. Respond with: "No reply needed."\n\n` +
        `FORMAT SPECIFICATION:\n` +
        `Your response MUST contain a single JSON block representing the reply to send:\n` +
        `\`\`\`json\n` +
        `{\n` +
        `  "replyText": "Your reply text here",\n` +
        `  "thought": "Reasoning for the reply text based on text history, profile context, and typing sample under the ${autoPilotMood} mood"\n` +
        `}\n` +
        `\`\`\`\n\n` +
        `If no reply is needed, output exactly: "No reply needed."`;

      // Formulate formatted transcript representation for evaluation
      const transcriptFormatted = transcript.length > 0
        ? transcript.map(m => `${m.sender}: ${m.text}`).join('\n')
        : pageText.slice(0, 15000);

      // Ask the AI to evaluate DMs
      const evaluationPrompt = 
        `[Page Context - ${platformName} DMs]\n` +
        `URL: ${targetTab.url}\n` +
        `DOM: ${pageDom}\n\n` +
        `Chat history transcript:\n${transcriptFormatted}\n\n` +
        `Analyze the messages. If the other person ('them') sent the last message, return the reply JSON block. If not, output "No reply needed."`;

      isStreaming = true;
      const response = await window.electronAPI.aiGenerate({
        prompt: evaluationPrompt,
        systemInstruction: systemInstruction,
        model: modelSelect ? modelSelect.value : undefined,
        images: screenshotPayload
      });
      isStreaming = false;

      if (response && response.error) {
        appendMessage('system', `⚠️ Auto-Pilot generation error: ${response.error}`);
        return;
      }

      if (response && response.text) {
        const text = response.text.trim();
        let replyText = null;
        let thought = "";

        try {
          let jsonText = text;
          const matchJson = text.match(/```json\s*([\s\S]*?)\s*```/i);
          if (matchJson) {
            jsonText = matchJson[1].trim();
          }
          const parsed = JSON.parse(jsonText);
          if (parsed && parsed.replyText) {
            replyText = parsed.replyText;
            thought = parsed.thought || '';
          }
        } catch (e) {
          if (text.toLowerCase().includes("no reply needed")) {
            replyText = null;
          }
        }

        if (replyText) {
          if (window.aiTaskHUD) {
            window.aiTaskHUD.addStep(`Formulated ${autoPilotMood} reply`, 'done');
          }

          // Focus the input element on the page
          const focusScript = `
            (function() {
              const selectors = [
                'div[contenteditable="true"]',
                'textarea',
                'input[type="text"]',
                '[role="textbox"]',
                'p[placeholder*="Message"]'
              ];
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                  el.focus();
                  return true;
                }
              }
              return false;
            })()
          `;
          const focusResult = await window.electronAPI.aiExecutePageAction(focusScript, tabId);

          if (focusResult.result) {
            // 5. Edge Case: Simulate random human reading/thinking delay (3 - 6 seconds)
            const delayMs = 3000 + Math.random() * 3000;
            console.log(`Auto-Pilot: Simulating human thinking delay of ${Math.round(delayMs / 1000)}s...`);
            if (window.aiTaskHUD) {
              window.aiTaskHUD.start(`Auto-Pilot: Simulating typing...`);
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));

            // Type the response using native CDP key simulation
            await window.electronAPI.aiCDPType({ tabId, text: replyText });

            // Trigger frameworks (like React) to register the value change
            const triggerInputEventScript = `
              (function() {
                const el = document.activeElement;
                if (el) {
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }
                return false;
              })()
            `;
            await window.electronAPI.aiExecutePageAction(triggerInputEventScript, tabId);

            appendMessage('model', `🤖 **Auto-Pilot Event on ${platformName}:** *${thought}*\n\nDrafted reply: "${replyText}"`);

            // Record this key to guard against duplicate replies
            if (lastMsgText) {
              lastRepliedMessageKey = currentGuardKey;
            }

            if (autoPilotMode === 'semi') {
              // Semi-Automatic: Ask user to confirm sending in HUD
              if (window.aiTaskHUD) {
                window.aiTaskHUD.requestInput(`Auto-Pilot drafted a ${autoPilotMood} reply for ${targetTab.title || 'chat'}. Choose an option:`, ['Send Message', 'Discard Draft']);
              }

              const userChoice = await new Promise((resolve) => {
                const onResponse = (r) => {
                  removeResponseListener();
                  resolve(r);
                };
                const removeResponseListener = window.electronAPI.on('hud-user-response', onResponse);
              });

              if (userChoice === 'Send Message') {
                const clicked = await sendSocialMessage(tabId);
                if (clicked) {
                  appendMessage('system', '✅ Auto-Pilot draft sent successfully.');
                }
              } else {
                appendMessage('system', '🗑️ Auto-Pilot draft discarded.');
              }
            } else {
              // Fully Automatic: Automatically trigger send
              const clicked = await sendSocialMessage(tabId);
              if (clicked) {
                appendMessage('system', '✅ Auto-Pilot sent message automatically.');
              }
            }
          } else {
            console.error("Auto-Pilot: Could not find or focus message input textbox.");
          }
        } else {
          // No action needed, print observation reasoning to chat feed
          appendMessage('model', `🤖 **Auto-Pilot Observation:** *${text.slice(0, 300)}*`);
        }
      }

      if (window.aiTaskHUD) {
        window.aiTaskHUD.done('Auto-Pilot check complete');
      }
    } catch (err) {
      console.error("Auto-Pilot Tick failed: ", err);
      if (window.aiTaskHUD) {
        window.aiTaskHUD.error('Auto-Pilot error');
      }
    } finally {
      isStreaming = false;
    }
  }

  async function sendSocialMessage(tabId) {
    const sendScript = `
      (function() {
        const btns = Array.from(document.querySelectorAll('button, div[role="button"], span'));
        const sendBtn = btns.find(b => {
          const txt = (b.innerText || b.textContent || '').toLowerCase();
          return txt === 'send' || txt === 'publish' || b.querySelector('svg[aria-label="Send"]');
        });
        if (sendBtn) {
          sendBtn.click();
          return true;
        }
        return false;
      })()
    `;
    const res = await window.electronAPI.aiExecutePageAction(sendScript, tabId);
    if (!res.result) {
      await window.electronAPI.aiCDPPressKey({ tabId, key: 'Enter' });
      return true;
    }
    return res.result;
  }

  initAutoPilot();
  initTabs();
  initChatAttachments();

})();
