const BASE_URL = 'http://127.0.0.1:3001';

// State
let authToken = null;
let isPremium = false;
let requestsToday = 0;
let totalApiCalls = 0;
let userEmail = null;
let isInitialized = false;
let initializationPromise = null;

// Initialize storage with proper async handling
async function initializeStorage() {
  if (isInitialized) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = new Promise((resolve) => {
    chrome.storage.local.get(
      ['authToken', 'isPremium', 'requestsToday', 'totalApiCalls', 'userEmail'],
      (res) => {
        if ('authToken' in res) authToken = res.authToken;
        if ('isPremium' in res) isPremium = res.isPremium;
        if ('requestsToday' in res) requestsToday = res.requestsToday;
        if ('totalApiCalls' in res) totalApiCalls = res.totalApiCalls;
        if ('userEmail' in res) userEmail = res.userEmail;
        isInitialized = true;
        resolve();
      },
    );
  });

  return initializationPromise;
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.authToken) authToken = changes.authToken.newValue || null;
    if (changes.isPremium) isPremium = changes.isPremium.newValue || false;
    if (changes.userEmail) userEmail = changes.userEmail.newValue || null;
  }
});

// --- SESSION MANAGEMENT ---

async function clearSessionData(reason = 'Session expired or revoked') {
  console.log(`[AUTH] Clearing session data: ${reason}`);
  authToken = null;
  isPremium = false;
  userEmail = null;

  await chrome.storage.local.set({
    authToken: null,
    isPremium: false,
    userEmail: null,
  });

  try {
    await chrome.runtime.sendMessage({ action: 'SESSION_REVOKED', reason });
  } catch (e) {
    // Ignore if no listeners
  }
}

// --- AUTHENTICATION & SYNC ---

async function refreshUserInfo() {
  if (!authToken) return;

  try {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    if (res.status === 401) {
      await clearSessionData('Token invalid or expired');
      return;
    }

    if (res.ok) {
      const data = await res.json();
      userEmail = data.email;
      isPremium = data.role === 'admin' || data.role === 'owner';
      await chrome.storage.local.set({ userEmail, isPremium });
    }
  } catch (e) {
    console.warn('[AUTH] Failed to refresh user info:', e);
  }
}

// --- API INTERACTION ---

function convertHistory(history) {
  // Convert from Gemini format { role, parts: [{ text }] } to backend format { role, text }
  return history.map((turn) => {
    if (turn.text !== undefined) return turn; // already in new format
    return {
      role: turn.role,
      text: (turn.parts && turn.parts[0] && turn.parts[0].text) || '',
    };
  });
}

async function generateContent(options = {}) {
  await initializeStorage();

  if (!authToken) {
    throw new Error('Not authenticated. Please login from the extension popup.');
  }

  const payload = {};
  if (options.prompt) payload.prompt = options.prompt;
  if (options.images && options.images.length > 0) payload.images = options.images;
  if (options.model) payload.model = options.model;
  if (options.temperature !== undefined) payload.temperature = options.temperature;
  if (options.maxOutputTokens) payload.maxOutputTokens = options.maxOutputTokens;
  if (options.systemInstruction) payload.systemInstruction = options.systemInstruction;
  if (options.history && options.history.length > 0) {
    payload.history = convertHistory(options.history);
  }
  if (options.thinkingBudget !== undefined) payload.thinkingBudget = options.thinkingBudget;

  const res = await fetch(`${BASE_URL}/v1/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 401) {
    await clearSessionData('Token expired or session invalidated');
    throw new Error('Session expired. Please login again.');
  }

  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Rate limit exceeded. Please wait before retrying.');
  }

  if (res.status === 503) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Service temporarily unavailable. Please try again.');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  }

  const result = await res.json();
  return result.text;
}

// --- CHAT STREAMING ---

async function startChatStream(tabId, prompt, history, imageData, systemInstruction) {
  await initializeStorage();

  if (!authToken) {
    chrome.tabs.sendMessage(tabId, { action: 'CHAT_ERROR', message: 'Not authenticated. Please login from the extension popup.' }).catch(() => {});
    return;
  }

  const payload = {};
  if (prompt) payload.prompt = prompt;
  if (systemInstruction) payload.systemInstruction = systemInstruction;
  if (imageData) {
    try {
      const split = imageData.split(',');
      if (split.length >= 2) {
        payload.images = [{ type: 'base64', mimeType: 'image/jpeg', data: split[1] }];
      }
    } catch (e) { /* ignore */ }
  }
  if (history && history.length > 0) {
    payload.history = convertHistory(history);
  }

  try {
    const res = await fetch(`${BASE_URL}/v1/generate/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      await clearSessionData('Token expired');
      chrome.tabs.sendMessage(tabId, { action: 'CHAT_ERROR', message: 'Session expired. Please login again.' }).catch(() => {});
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      chrome.tabs.sendMessage(tabId, { action: 'CHAT_ERROR', message: data.error || `Server error (${res.status})` }).catch(() => {});
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') {
          chrome.tabs.sendMessage(tabId, { action: 'CHAT_DONE', full: fullText }).catch(() => {});
          return;
        }
        try {
          const chunk = JSON.parse(raw);
          const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullText += text;
            chrome.tabs.sendMessage(tabId, { action: 'CHAT_CHUNK', chunk: text }).catch(() => {});
          }
        } catch (_) { /* ignore malformed SSE */ }
      }
    }

    chrome.tabs.sendMessage(tabId, { action: 'CHAT_DONE', full: fullText }).catch(() => {});
  } catch (e) {
    chrome.tabs.sendMessage(tabId, { action: 'CHAT_ERROR', message: e.message || 'Request failed.' }).catch(() => {});
  }
}

// Memory System (IndexedDB)
const DB_NAME = 'AiMagicDB';
const STORE_NAME = 'memory';

// Cache the DB promise — opening a new connection on every operation leaks memory
let _dbPromise = null;
function initDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      _dbPromise = null; // allow retry
      reject(request.error);
    };
  });
  return _dbPromise;
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
    console.warn('Invalid embedding vectors provided');
    return 0;
  }

  if (vecA.length !== vecB.length) {
    console.warn('Embedding vectors have different dimensions');
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    if (typeof vecA[i] !== 'number' || typeof vecB[i] !== 'number') {
      console.warn('Non-numeric values in embedding vectors');
      return 0;
    }
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

async function storeMemory(text, response, embedding) {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      id: Date.now().toString(),
      text,
      response,
      embedding,
      timestamp: Date.now(),
    });

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Failed to store memory:', e);
  }
}

async function cleanupMemory() {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.getAll();

    return new Promise((resolve, reject) => {
      getReq.onsuccess = () => {
        const records = getReq.result;
        const now = Date.now();
        const idsToDelete = [];

        for (const r of records) {
          if (now - r.timestamp > 30 * 60 * 1000) {
            idsToDelete.push(r.id);
          }
        }

        for (const id of idsToDelete) {
          store.delete(id);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (e) {
    console.error('Failed to cleanup memory:', e);
  }
}

async function clearAiMemory() {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log('AiMagic: AI Memory cleared successfully.');
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Failed to clear AI memory:', e);
    throw e;
  }
}

async function findMemory(embedding, threshold = 0.85) {
  try {
    const db = await initDB();

    const readTx = db.transaction(STORE_NAME, 'readonly');
    const readStore = readTx.objectStore(STORE_NAME);
    const getReq = readStore.getAll();

    return new Promise((resolve, reject) => {
      getReq.onsuccess = async () => {
        const records = getReq.result;
        const now = Date.now();
        let bestMatch = null;
        let highestSim = 0;
        const idsToDelete = [];

        for (const r of records) {
          if (now - r.timestamp > 30 * 60 * 1000) {
            idsToDelete.push(r.id);
            continue;
          }

          const sim = cosineSimilarity(embedding, r.embedding);
          if (!isNaN(sim) && sim > highestSim && sim > threshold) {
            highestSim = sim;
            bestMatch = r;
          }
        }

        if (idsToDelete.length > 0) {
          try {
            const cleanupTx = db.transaction(STORE_NAME, 'readwrite');
            const cleanupStore = cleanupTx.objectStore(STORE_NAME);
            for (const id of idsToDelete) {
              cleanupStore.delete(id);
            }
          } catch (e) {
            console.warn('Cleanup during find failed:', e);
          }
        }

        resolve(bestMatch);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (e) {
    console.error('Failed to find memory:', e);
    return null;
  }
}

// Embedding is not available through the new backend — memory cache is skipped gracefully
async function getEmbedding(text) {
  throw new Error('Embedding endpoint not available');
}

async function getCompletion(modelName, prompt, increment = 0) {
  return await generateContent({ model: modelName, prompt, temperature: 0.1 });
}

async function getMultimodalCompletion(modelName, prompt, imageData = null, increment = 0) {
  const options = { model: modelName, prompt, temperature: 0.1 };

  if (imageData) {
    try {
      const splitData = imageData.split(',');
      if (splitData.length >= 2) {
        options.images = [{ type: 'base64', mimeType: 'image/jpeg', data: splitData[1] }];
      }
    } catch (e) {
      console.warn('Failed to parse image data for multimodal completion:', e);
    }
  }

  return await generateContent(options);
}

async function streamCompletion(
  modelName,
  prompt,
  tabId,
  actionType,
  imageData = null,
  increment = 0,
  options = {},
) {
  const genOptions = {
    model: modelName,
    prompt,
    temperature: 0.2,
  };

  if (options.maxOutputTokens) genOptions.maxOutputTokens = options.maxOutputTokens;
  if (options.history && Array.isArray(options.history) && options.history.length > 0) {
    genOptions.history = options.history;
  }

  if (imageData) {
    try {
      const splitData = imageData.split(',');
      if (splitData.length >= 2) {
        genOptions.images = [{ type: 'base64', mimeType: 'image/jpeg', data: splitData[1] }];
      }
    } catch (e) {
      console.warn('Failed to parse image data:', e);
    }
  }

  try {
    const text = await generateContent(genOptions);

    chrome.tabs.sendMessage(tabId, {
      action: actionType,
      chunk: '',
      full: text,
      done: true,
    }).catch(() => {});

    return text;
  } catch (e) {
    const errMsg = e.message || 'Request failed.';
    chrome.tabs.sendMessage(tabId, {
      action: 'STREAM_ERROR',
      content: errMsg,
    }).catch(() => {});
    return null;
  }
}

// 8-Step Pipeline Orchestrator
async function executeAgenticPipeline(domContext) {
  await initializeStorage();

  if (!authToken) {
    return { type: 'ERROR', content: 'Please login to use AiMagic.' };
  }

  try {
    const rawText = domContext.text;
    const fullText = (domContext?.text || '').slice(0, 25000);

    // 2. Embedding memory check
    let emb = [];
    try {
      emb = await getEmbedding(fullText);
      const mem = await findMemory(emb, 0.85);
      if (mem) {
        console.log('AiMagic: Memory Hit!');
        try {
          return JSON.parse(mem.response);
        } catch (e) {
          console.warn('Failed to parse cached response:', e);
        }
      }
    } catch (e) {
      console.warn('Embedding check failed, skipping memory cache', e);
    }

    // 3. Task Classifier
    const classifyPrompt = `Analyze the context and classify the task into one of these exact types: "PARAGRAPH", "SINGLE_MCQ", "MULTIPLE_MCQS", "CODING".
Context: ${fullText}
Return ONLY the type word.`;

    let taskType = await getCompletion(
      'gemini-2.5-flash-lite',
      classifyPrompt,
      0,
    );

    taskType = taskType.trim().replace(/['"]/g, '').toUpperCase();

    if (taskType.includes('CODING')) {
      taskType = 'CODING';
    } else if (taskType.includes('MULTIPLE_MCQS') || taskType.includes('MULTIPLE_MCQ')) {
      taskType = 'MULTIPLE_MCQS';
    } else if (taskType.includes('SINGLE_MCQ')) {
      taskType = 'SINGLE_MCQ';
    } else if (taskType.includes('PARAGRAPH')) {
      taskType = 'PARAGRAPH';
    } else {
      taskType = 'PARAGRAPH';
    }

    // 4. Planner
    let selectedModel = 'gemini-2.5-flash-lite';
    let executionPrompt = '';

    if (taskType === 'CODING') {
      selectedModel = 'gemini-2.5-flash-lite';
      executionPrompt = `STRICT MODE: Solve the following coding problem. Return ONLY the functional execution code.
IMPORTANT:
1. DO NOT include any comments (no //, no /*, no #, no <!--).
2. DO NOT include any explanations or prose.
3. DO NOT wrap in markdown \`\`\`.
4. Output MUST be 100% valid code only.
Context:
${fullText}`;
    } else if (taskType === 'SINGLE_MCQ') {
      executionPrompt = `Read the question and options. Return ONLY the exactly correct option text (no explanations).
Important: Your output MUST be EXACTLY the same as the text found in the Context. Do not add quotes, do not add trailing periods, do not add "The answer is:".
If the context says "A) Paris", and the option is "Paris", return "Paris". If the context has "Paris.", return "Paris.". Use verbatim matching.
Context:
${fullText}`;
    } else if (taskType === 'MULTIPLE_MCQS') {
      executionPrompt = `Read the multiple choice questions. Return the correct answers as a JSON string array strictly ordered by question number. Example: ["Answer 1", "Answer 2"].
Important: The strings in the array MUST be EXACT substrings from the Context. Do not prepend option letters like A) or B) unless they actually literally exist in the Context. Output MUST be purely valid JSON array format. No prose.
Context:
${fullText}`;
    } else {
      executionPrompt = `Read the text/problem and answer it appropriately in prose (around 100-300 words).
Context: ${fullText}`;
    }

    // 5. Executor
    let responseText = await getMultimodalCompletion(
      selectedModel,
      executionPrompt,
      domContext.imageData,
      1,
    );

    // 6. Strip backticks if needed
    let finalResponse = responseText;
    if (taskType === 'MULTIPLE_MCQS' || taskType === 'CODING') {
      finalResponse = finalResponse
        .replace(/^```[a-zA-Z]*\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim();
    }

    const resultObj = { type: taskType, content: finalResponse };

    // 8. Store Memory
    if (emb.length > 0) {
      try {
        await storeMemory(fullText, JSON.stringify(resultObj), emb);
      } catch (e) {
        console.warn('Failed to store memory:', e);
      }
    }

    return resultObj;
  } catch (err) {
    console.error('Pipeline Error', err);
    return { type: 'ERROR', content: err.message };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_PIPELINE') {
    executeAgenticPipeline(request.domContext)
      .then((res) => {
        sendResponse(res);
      })
      .catch((err) => {
        sendResponse({ type: 'ERROR', content: err.message });
      });
    return true;
  } else if (request.action === 'FORCE_SYNC') {
    refreshUserInfo()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  } else if (request.action === 'SAVE_AUTH_TOKEN') {
    authToken = request.token;
    chrome.storage.local.set({ authToken: request.token });
    refreshUserInfo();
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'LOGOUT') {
    if (authToken) {
      fetch(`${BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      }).catch(() => {});
    }
    clearSessionData('User logged out')
      .then(() => { sendResponse({ success: true }); })
      .catch((err) => { sendResponse({ success: false, error: err.message }); });
    return true;
  } else if (request.action === 'START_CHAT') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    if (tabId) {
      startChatStream(tabId, request.prompt, request.history, request.imageData, request.systemInstruction);
    }
    sendResponse({ started: true });
    return true;
  } else if (request.action === 'CLEAR_MEMORY') {
    clearAiMemory()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  } else if (request.action === 'CAPTURE_SCREENSHOT') {
    try {
      chrome.tabs.captureVisibleTab(
        null,
        { format: 'jpeg', quality: 50 },
        function (dataUrl) {
          if (chrome.runtime.lastError) {
            console.error('Screenshot capture failed:', chrome.runtime.lastError);
            sendResponse({ error: chrome.runtime.lastError.message });
          } else if (dataUrl) {
            sendResponse({ dataUrl: dataUrl });
          } else {
            sendResponse({ error: 'Failed to capture screenshot' });
          }
        },
      );
    } catch (e) {
      sendResponse({ error: e.message });
    }
    return true;
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'reload_extension') {
    chrome.runtime.reload();
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      const messageMap = {
        'activate_solver': { action: 'TOGGLE_BTN' },
        'ghost_solve': { action: 'GHOST_SOLVE' },
        'trigger_autotype': { action: 'START_AUTOTYPE' },
        'open_chat': { action: 'TOGGLE_CHAT' },
      };

      const message = messageMap[command];
      if (message) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch((err) => {
          console.warn(`Failed to send ${command} message:`, err);
        });
      }
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
    for (const tab of tabs) {
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        })
        .catch(() => {});

      chrome.scripting
        .insertCSS({
          target: { tabId: tab.id },
          files: ['content.css'],
        })
        .catch(() => {});
    }
  });

  chrome.contextMenus.create({
    id: 'aiMagic-solve',
    title: 'Solve with AiMagic',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'aiMagic-solve' && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'EXECUTE_SOLVER',
      text: info.selectionText,
    }).catch((err) => {
      console.warn('Failed to send context menu message:', err);
    });
  }
});

// Initialization
(async () => {
  try {
    await initializeStorage();
    await refreshUserInfo();

    // Periodic memory cleanup every 15 minutes
    chrome.alarms.create('memoryCleanup', { periodInMinutes: 15 });

    try {
      await cleanupMemory();
    } catch (e) {
      /* silent */
    }
  } catch (e) {
    console.error('Initialization failed:', e);
  }
})();
