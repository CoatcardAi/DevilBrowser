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
  const btnAiToggle = document.getElementById('btn-ai-toggle');
  const modelSelect = document.getElementById('ai-model-select');
  const sysInstrArea = document.getElementById('ai-system-instruction');
  const quotaBar = document.getElementById('ai-quota-bar');
  const quotaText = document.getElementById('ai-quota-text');
  const userBadge = document.getElementById('ai-user-badge');
  const pageContext = document.getElementById('ai-page-context');
  const statusQuota = document.getElementById('status-quota');

  // ------- State -------
  let history = [];      // [{role, text}]
  let isStreaming = false;
  let thinkMode = false;
  let currentUser = null;
  let speechRec = null;
  let isListening = false;
  let aiMemory = {};      // Cross-tab memory object

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
    panel.classList.add('open');
    if (btnAiToggle) btnAiToggle.classList.add('active');
    updatePageContext();
    updateLayout();
    if (panelInput) panelInput.focus();
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
  function appendMessage(role, text, streaming = false) {
    if (!panelMessages) return null;
    const msg = document.createElement('div');
    msg.className = `ai-msg ai-msg-${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';

    if (role === 'model') {
      bubble.innerHTML = renderMarkdown(text);
      if (!streaming) {
        processCodeBlocks(bubble);
      }
    } else {
      bubble.textContent = text;
    }

    msg.appendChild(bubble);
    panelMessages.appendChild(msg);
    panelMessages.scrollTop = panelMessages.scrollHeight;
    return bubble;
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
    panelMessages.innerHTML = '';
    if (history.length === 0) {
      panelMessages.innerHTML = `
        <div class="ai-welcome">
          <div class="ai-welcome-icon">✨</div>
          <p>Hi! I'm your CoatcardAi.<br>I can help you understand, summarise, or discuss anything on the web.</p>
          <div class="ai-welcome-tips">
            <span>💡 Select text on any page → right-click → AI actions</span>
            <span>🖼️ Right-click images to analyse them</span>
            <span>📄 Type <code>ai:</code> in the address bar</span>
          </div>
        </div>`;
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

      let loadingBubble = null;
      if (displayPrompt) {
        appendMessage('user', displayPrompt);
        history.push({ role: 'user', text: displayPrompt });
      }

      loadingBubble = appendMessage('model', '⠋ Thinking…');
      if (loadingBubble) loadingBubble.classList.add('streaming');

      const model = modelSelect ? modelSelect.value : undefined;
      const thinking = thinkMode ? 8192 : 0;

      let fullText = '';

      const onChunk = (text) => {
        fullText += text;
        if (loadingBubble) {
          loadingBubble.innerHTML = renderMarkdown(fullText) + '<span class="ai-cursor">▍</span>';
          panelMessages.scrollTop = panelMessages.scrollHeight;
        }
      };

      const onDone = () => {
        isStreaming = false;
        if (loadingBubble) {
          loadingBubble.classList.remove('streaming');
          loadingBubble.innerHTML = renderMarkdown(fullText);
          processCodeBlocks(loadingBubble);
        }
        history.push({ role: 'model', text: fullText });
        window.aiQuota.refresh();

        window.electronAPI.offAiStream(onChunk, onDone, onError);
        resolve(fullText);
      };

      const onError = (err) => {
        isStreaming = false;
        if (loadingBubble) {
          loadingBubble.classList.remove('streaming');
          loadingBubble.innerHTML = `<span class="ai-error">⚠️ ${err || 'Generation failed'}</span>`;
        }
        if (displayPrompt) history.pop();
        window.electronAPI.offAiStream(onChunk, onDone, onError);

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
        images: imageData ? [{ type: 'base64', mimeType: imageMimeType, data: imageData }] : undefined
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

    let currentApiPrompt = userMessage;
    let currentDisplayPrompt = userMessage;
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
      "7. Final Synthesis: Only complete the loop when the user's high-level goal is fully achieved. Output a clean, structured summary of findings (do not output tool blocks in your final response).\n\n" +
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
      "       \"command\": \"list-tabs | switch-tab | new-tab | close-tab | navigate | go-back | go-forward | reload | read-page | search | write-file | save-state | restore-state | set-memory | get-memory | download-file | analyse-document\",\n" +
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
      "   - `analyse-document`: Read/analyze local documents (e.g. downloaded PDFs). Returns text content. Params: `{\"filePath\": \"<file_path_string>\", \"mimeType\": \"<optional_mime_type_string>\", \"name\": \"<optional_name_string>\"}`\n\n" +
      "Verify elements exist before interacting. If you have completed the task or cannot proceed further, simply respond with a plain text answer explaining the results to the user (do not include action blocks).";

    let sysInstr = (sysInstrArea ? sysInstrArea.value.trim() : '');
    sysInstr += defaultAutomationInstruction;

    while (step < maxSteps) {
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
          fullText = await getStreamResponse(currentDisplayPrompt, apiPrompt, sysInstr);

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
          retries++;
          if (retries >= maxRetries) {
            appendMessage('system', '⚠️ The AI generation failed due to a network/service error.');
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (!fullText || fullText.trim().length === 0) {
        appendMessage('system', '⚠️ The CoatcardAi returned empty responses. Stopping agent loop.');
        break;
      }

      // 4. Parse action from response
      const parsedAction = parseActionCommand(fullText);
      if (!parsedAction) {
        // No action block found, task complete!
        break;
      }

      const { action, action_input } = parsedAction;
      const thought = action_input.thought || '';
      
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
          } else if (command === 'set-memory') {
            const key = params?.key;
            const value = params?.value;
            if (!key) throw new Error("Missing key parameter");
            aiMemory[key] = value;
            executionResult = { success: true, result: `Stored key "${key}" in cross-tab memory` };
          } else if (command === 'get-memory') {
            const key = params?.key;
            if (!key) throw new Error("Missing key parameter");
            const val = aiMemory[key];
            executionResult = { success: true, result: { key, value: val !== undefined ? val : null } };
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
  }

  // ------- Send Message -------
  async function sendMessage() {
    if (!panelInput) return;
    const text = panelInput.value.trim();
    if (!text || isStreaming) return;

    panelInput.value = '';
    panelInput.style.height = 'auto';

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

  // ------- Voice Input -------
  function initVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      if (btnVoice) btnVoice.style.display = 'none';
      return;
    }
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRec = new SpeechRec();
    speechRec.lang = 'en-US';
    speechRec.continuous = false;
    speechRec.interimResults = true;

    speechRec.onresult = (e) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      if (panelInput) panelInput.value = transcript;
      if (e.results[e.results.length - 1].isFinal) {
        stopListening();
        sendMessage();
      }
    };

    speechRec.onend = () => {
      isListening = false;
      if (btnVoice) btnVoice.classList.remove('listening');
    };
  }

  function toggleListening() {
    if (!speechRec) return;
    if (isListening) {
      stopListening();
    } else {
      speechRec.start();
      isListening = true;
      if (btnVoice) btnVoice.classList.add('listening');
    }
  }

  function stopListening() {
    if (speechRec && isListening) {
      speechRec.stop();
      isListening = false;
      if (btnVoice) btnVoice.classList.remove('listening');
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
  if (btnClear) btnClear.addEventListener('click', () => { history = []; renderMessages(); });
  if (btnClose) btnClose.addEventListener('click', closePanel);
  if (btnSummarise) btnSummarise.addEventListener('click', summarisePage);
  if (btnVoice) btnVoice.addEventListener('click', toggleListening);
  if (btnThink) btnThink.addEventListener('click', toggleThink);
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
    });
  }

  // Listen to IPC events for context actions
  window.electronAPI.on('ai-context-action', (data) => {
    if (!data) return;
    if (data.action === 'analyse-image') {
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
  renderMessages();

})();
