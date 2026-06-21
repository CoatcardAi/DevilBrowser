"use strict";

(function () {
  let uiInjected = false;

  function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand("copy");
  } catch (err) {
    console.warn("Fallback copy failed:", err);
  }
  document.body.removeChild(textArea);
}

function makeDraggable(element, handle, storageKey, clickCallback = null) {
  let pos1 = 0,
    pos2 = 0,
    pos3 = 0,
    pos4 = 0;
  let dragDistance = 0;
  let isMouseDown = false;

  // Load last position
  if (chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([storageKey], function (result) {
      if (result[storageKey]) {
        element.style.top = result[storageKey].top;
        element.style.left = result[storageKey].left;
        element.style.bottom = "auto";
        element.style.right = "auto";
        element.style.transform = "none";
      }
    });
  }

  // Remove old listeners if any
  if (handle._aiMagicDragHandler) {
    handle.removeEventListener("mousedown", handle._aiMagicDragHandler);
  }
  handle._aiMagicDragHandler = dragMouseDown;
  handle.addEventListener("mousedown", dragMouseDown);

  function dragMouseDown(e) {
    if (
      !e.target.closest("#aiMagic-solver-btn") &&
      (e.target.tagName === "BUTTON" ||
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.closest(".chat-action-btn") ||
        e.target.closest(".aiMagic-btn-icon"))
    )
      return;

    e = e || window.event;
    pos3 = e.clientX;
    pos4 = e.clientY;
    dragDistance = 0;
    isMouseDown = true;

    document.addEventListener("mouseup", closeDragElement);
    document.addEventListener("mousemove", elementDrag);
  }

  function elementDrag(e) {
    if (!isMouseDown) return;
    e = e || window.event;
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;

    const moveX = Math.abs(pos1);
    const moveY = Math.abs(pos2);
    dragDistance += moveX + moveY;

    element.style.top = element.offsetTop - pos2 + "px";
    element.style.left = element.offsetLeft - pos1 + "px";
    element.style.bottom = "auto";
    element.style.right = "auto";
    element.style.transform = "none";

    if (dragDistance > 10) {
      element.classList.add("aiMagic-dragging");
    }
  }

  function closeDragElement() {
    isMouseDown = false;
    document.removeEventListener("mouseup", closeDragElement);
    document.removeEventListener("mousemove", elementDrag);

    // Distinguish between a click and a drag
    if (dragDistance <= 10 && clickCallback) {
      clickCallback();
    }

    // Remove the dragging class after a tiny timeout to let the click event pass
    setTimeout(() => {
      element.classList.remove("aiMagic-dragging");
    }, 50);

    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        [storageKey]: {
          top: element.style.top,
          left: element.style.left,
        },
      });
    }
  }
}

const captureScreenWithoutUI = (callback) => {
  document.body.classList.add("aiMagic-capturing");
  // Tiny timeout to ensure the browser has repainted and hidden the UI
  setTimeout(() => {
    chrome.runtime.sendMessage({ action: "CAPTURE_SCREENSHOT" }, (res) => {
      document.body.classList.remove("aiMagic-capturing");

      if (chrome.runtime.lastError) {
        console.error("Screenshot capture failed:", chrome.runtime.lastError);
        callback({ dataUrl: null, error: chrome.runtime.lastError.message });
        return;
      }

      if (res && res.error) {
        console.warn("Screenshot failed:", res.error);
        callback({ dataUrl: null, error: res.error });
      } else {
        callback(res || { dataUrl: null });
      }
    });
  }, 100);
};

// Store event listeners to prevent duplicates
const eventListeners = new Map();

// ===== CHAT STATE =====
let chatHistory = [];          // [{ role:'user'|'model', text:'...' }]
let chatAttachedImage = null;  // base64 dataUrl of screenshot to send
let chatContextEnabled = false;
let chatStreaming = false;
let chatStreamBuffer = '';
let chatStreamEl = null;       // DOM element of the current AI streaming bubble

const CHAT_SYSTEM_INSTRUCTION =
  'Be concise and direct. Give the answer only — no preamble, no filler, no "Great question!", no restating the question, no closing remarks. ' +
  'Do not over-explain unless the user explicitly asks for an explanation. ' +
  'STRICT RULE — CODE BLOCKS: Never write comments inside code blocks under any circumstance. ' +
  'No //, no /*, no #, no --, no <!-- --> style comments. Zero exceptions. ' +
  'If explanation is needed, write it as plain text OUTSIDE the code block, never inside. ' +
  'Code blocks must contain only executable code with zero comments.';

const CHAT_DEFAULT_PROMPT =
  'Analyze the visible content and provide the answer. ' +
  'Coding problem → output only the working code, absolutely no comments inside the code block. ' +
  'Single MCQ → option letter (A/B/C/D) + answer text. ' +
  'Multiple MCQs → list as Q1: A - answer, Q2: B - answer, etc. ' +
  'Paragraph/essay → clear concise answer (100-300 words).';

const injectUI = () => {
  // Prevent multiple injections
  if (uiInjected) return;
  uiInjected = true;

  chrome.storage.local.get(["preferredTheme"], (result) => {
    const theme = result.preferredTheme || "dark";
    const themeClass = theme === "light" ? "" : `aiMagic-theme-${theme}`;

    // Destroy old UI components and their event listeners
    ["aiMagic-solver-btn", "aiMagic-solver-popup", "aiMagic-toast"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        // Remove all stored event listeners
        const listeners = eventListeners.get(id);
        if (listeners) {
          listeners.forEach(({ event, handler, target }) => {
            target.removeEventListener(event, handler);
          });
          eventListeners.delete(id);
        }
        el.remove();
      }
    });

    const btn = document.createElement("button");
    btn.id = "aiMagic-solver-btn";
    if (themeClass) btn.classList.add(themeClass);
    btn.innerHTML = `
    <svg width="800px" height="800px" viewBox="0 0 1024 1024" class="icon"  version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M512 301.2m-10 0a10 10 0 1 0 20 0 10 10 0 1 0-20 0Z" fill="white" /><path d="M400.3 744.5c2.1-0.7 4.1-1.4 6.2-2-2 0.6-4.1 1.3-6.2 2z m0 0c2.1-0.7 4.1-1.4 6.2-2-2 0.6-4.1 1.3-6.2 2z" fill="white" /><path d="M511.8 256.6c24.4 0 44.2 19.8 44.2 44.2S536.2 345 511.8 345s-44.2-19.8-44.2-44.2 19.9-44.2 44.2-44.2m0-20c-35.5 0-64.2 28.7-64.2 64.2s28.7 64.2 64.2 64.2 64.2-28.7 64.2-64.2-28.7-64.2-64.2-64.2z" fill="white" /><path d="M730.7 529.5c0.4-8.7 0.6-17.4 0.6-26.2 0-179.6-86.1-339.1-219.3-439.5-133.1 100.4-219.2 259.9-219.2 439.5 0 8.8 0.2 17.5 0.6 26.1-56 56-90.6 133.3-90.6 218.7 0 61.7 18 119.1 49.1 167.3 30.3-49.8 74.7-90.1 127.7-115.3 39-18.6 82.7-29 128.8-29 48.3 0 93.9 11.4 134.3 31.7 52.5 26.3 96.3 67.7 125.6 118.4 33.4-49.4 52.9-108.9 52.9-173.1 0-85.4-34.6-162.6-90.5-218.6zM351.1 383.4c9.2-37.9 22.9-74.7 40.6-109.5a502.1 502.1 0 0 1 63.6-95.9c17.4-20.6 36.4-39.9 56.8-57.5 20.4 17.6 39.4 36.9 56.8 57.5 24.8 29.5 46.2 61.8 63.6 95.9 17.7 34.8 31.4 71.6 40.6 109.5 8.7 35.8 13.5 72.7 14.2 109.9C637.4 459 577 438.9 512 438.9c-65 0-125.3 20.1-175.1 54.4 0.7-37.2 5.5-74.1 14.2-109.9z m-90.6 449.2c-9.1-27-13.7-55.5-13.7-84.4 0-35.8 7-70.6 20.8-103.2 8.4-19.8 19-38.4 31.9-55.5 9.7 61.5 29.5 119.7 57.8 172.6-36.4 17.8-69 41.6-96.8 70.5z m364.2-85.3c-0.7-0.3-1.5-0.5-2.2-0.8-0.4-0.2-0.9-0.3-1.3-0.5-0.6-0.2-1.3-0.5-1.9-0.7-0.8-0.3-1.5-0.5-2.3-0.8-0.8-0.3-1.5-0.5-2.3-0.7l-0.9-0.3c-1-0.3-2.1-0.7-3.1-1-1.2-0.4-2.4-0.7-3.5-1.1l-3-0.9c-0.2-0.1-0.4-0.1-0.7-0.2-1.1-0.3-2.3-0.7-3.4-1-1.2-0.3-2.4-0.6-3.5-0.9l-3.6-0.9-3.6-0.9c-1-0.3-2.1-0.5-3.1-0.7-1.2-0.3-2.4-0.5-3.6-0.8-1.3-0.3-2.5-0.6-3.8-0.8h-0.3c-0.9-0.2-1.9-0.4-2.8-0.6-0.4-0.1-0.7-0.1-1.1-0.2-1.1-0.2-2.2-0.4-3.4-0.6-1.2-0.2-2.4-0.4-3.6-0.7l-5.4-0.9c-0.9-0.1-1.9-0.3-2.8-0.4-0.8-0.1-1.6-0.3-2.5-0.4-2.6-0.4-5.1-0.7-7.7-1-1.2-0.1-2.3-0.3-3.5-0.4h-0.4c-0.9-0.1-1.8-0.2-2.8-0.3-1.1-0.1-2.1-0.2-3.2-0.3-1.7-0.2-3.4-0.3-5.1-0.4-0.8-0.1-1.5-0.1-2.3-0.2-0.9-0.1-1.9-0.1-2.8-0.2-0.4 0-0.8 0-1.2-0.1-1.1-0.1-2.1-0.1-3.2-0.2-0.5 0-1-0.1-1.5-0.1-1.3-0.1-2.6-0.1-3.9-0.1-0.8 0-1.5-0.1-2.3-0.1-1.2 0-2.4 0-3.5-0.1h-13.9c-2.3 0-4.6 0.1-6.9 0.2-0.9 0-1.9 0.1-2.8 0.1-0.8 0-1.5 0.1-2.3 0.1-1.4 0.1-2.8 0.2-4.1 0.3-1.4 0.1-2.7 0.2-4.1 0.3-1.4 0.1-2.7 0.2-4.1 0.4-0.6 0-1.2 0.1-1.8 0.2l-7.8 0.9c-1.1 0.1-2.1 0.3-3.2 0.4-1 0.1-2.1 0.3-3.1 0.4-3.2 0.5-6.4 0.9-9.5 1.5-0.7 0.1-1.4 0.2-2.1 0.4-0.9 0.1-1.7 0.3-2.6 0.5-1.1 0.2-2.3 0.4-3.4 0.6-0.9 0.2-1.7 0.3-2.6 0.5-0.4 0.1-0.8 0.1-1.1 0.2-0.7 0.1-1.4 0.3-2.1 0.4-1.2 0.3-2.4 0.5-3.6 0.8-1.2 0.3-2.4 0.5-3.6 0.8-0.2 0-0.4 0.1-0.6 0.1-0.5 0.1-1 0.2-1.5 0.4-1.1 0.3-2.3 0.6-3.5 0.9-1.3 0.3-2.5 0.6-3.8 1-0.4 0.1-0.9 0.2-1.4 0.4-1.3 0.4-2.7 0.7-4 1.1-1.5 0.4-3 0.9-4.6 1.3-1 0.3-2.1 0.6-3.1 1-2.1 0.6-4.1 1.3-6.2 2-0.7 0.2-1.4 0.5-2.1 0.7-15-27.5-27.4-56.4-37-86.2-11.7-36.1-19.2-73.6-22.5-111.6-0.6-6.7-1-13.3-1.3-20-0.1-1.2-0.1-2.4-0.1-3.6-0.1-1.2-0.1-2.4-0.1-3.6 0-1.2-0.1-2.4-0.1-3.6 0-1.2-0.1-2.4-0.1-3.7 18.8-14 39.2-25.8 61-35 36.1-15.3 74.5-23 114.1-23 39.6 0 78 7.8 114.1 23 21.8 9.2 42.2 20.9 61 35v0.1c0 1 0 1.9-0.1 2.9 0 1.4-0.1 2.8-0.1 4.3 0 0.7 0 1.3-0.1 2-0.1 1.8-0.1 3.5-0.2 5.3-0.3 6.7-0.8 13.3-1.3 20-3.3 38.5-11 76.5-23 113-9.7 30.3-22.3 59.4-37.6 87.1z m136.8 90.9a342.27 342.27 0 0 0-96.3-73.2c29.1-53.7 49.5-112.8 59.4-175.5 12.8 17.1 23.4 35.6 31.8 55.5 13.8 32.7 20.8 67.4 20.8 103.2 0 31-5.3 61.3-15.7 90z" fill="white" /><path d="M512 819.3c8.7 0 24.7 22.9 24.7 60.4s-16 60.4-24.7 60.4-24.7-22.9-24.7-60.4 16-60.4 24.7-60.4m0-20c-24.7 0-44.7 36-44.7 80.4 0 44.4 20 80.4 44.7 80.4s44.7-36 44.7-80.4c0-44.4-20-80.4-44.7-80.4z" fill="white" /></svg>
    `;
    btn.style.display = "none"; // Hidden by default, unhide via Alt+S
    document.body.appendChild(btn);

    const popup = document.createElement("div");
    popup.classList.add("aiMagic-panel");
    if (themeClass) popup.classList.add(themeClass);
    popup.id = "aiMagic-solver-popup";
    popup.innerHTML = `
            <div class="aiMagic-panel-header">
                <span>AiMagic Solver</span>
                <button class="aiMagic-btn-icon aiMagic-close-btn"><svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg></button>
            </div>
            <div class="aiMagic-panel-content" id="aiMagic-solver-content">
               Click 'Solve' to analyze DOM.
            </div>
        `;
    document.body.appendChild(popup);

    // Add close button handler
    const closeBtn = popup.querySelector(".aiMagic-close-btn");
    const closeBtnHandler = () => {
      popup.classList.remove("aiMagic-open");
    };
    closeBtn.addEventListener("click", closeBtnHandler);

    // Store listener for cleanup
    if (!eventListeners.has("aiMagic-solver-popup")) {
      eventListeners.set("aiMagic-solver-popup", []);
    }
    eventListeners.get("aiMagic-solver-popup").push({
      event: "click",
      handler: closeBtnHandler,
      target: closeBtn
    });

    const toast = document.createElement("div");
    toast.id = "aiMagic-toast";
    toast.className = "aiMagic-toast";
    if (themeClass) toast.classList.add(themeClass);
    document.body.appendChild(toast);

    // Attach Draggable capability
    const popupEl = document.getElementById("aiMagic-solver-popup");
    if (popupEl && !popupEl.dataset.draggable) {
      popupEl.dataset.draggable = "true";
      const popupHeader = popupEl.querySelector(".aiMagic-panel-header");
      makeDraggable(popupEl, popupHeader, "aiMagic_popup_pos");
    }

    const btnEl = document.getElementById("aiMagic-solver-btn");
    if (btnEl && !btnEl.dataset.draggable) {
      btnEl.dataset.draggable = "true";
      makeDraggable(btnEl, btnEl, "aiMagic_btn_pos", () => {
        const popup = document.getElementById("aiMagic-solver-popup");
        if (popup && popup.classList.contains("aiMagic-open")) {
          popup.classList.remove("aiMagic-open");
        }
        executeSolve();
      });
    }

    // Unified Event delegation for all copy buttons (Chat and Solver)
    // Remove old listener if exists
    const oldCopyHandler = eventListeners.get("copy-handler");
    if (oldCopyHandler) {
      document.body.removeEventListener("click", oldCopyHandler);
    }

    const copyHandler = (e) => {
      const btn = e.target.closest(".aiMagic-copy-btn");
      if (!btn) return;

      try {
        // Use TextDecoder instead of deprecated escape/unescape
        const b64Data = btn.dataset.code;
        const binaryString = atob(b64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const rawCode = new TextDecoder().decode(bytes);

        copyToClipboard(rawCode);

        const origHTML = btn.innerHTML;
        btn.innerHTML = `✓ Copied!`;
        setTimeout(() => (btn.innerHTML = origHTML), 2000);
      } catch (e) {
        console.error("Failed to decode copy data:", e);
        showToast("Copy failed");
      }
    };

    document.body.addEventListener("click", copyHandler);
    eventListeners.set("copy-handler", copyHandler);

    // Inject Chat Panel (same theme)
    injectChatPanel(themeClass);
  }); // Close chrome.storage.local.get
};

// ===== CHAT PANEL =====

function injectChatPanel(themeClass) {
  const old = document.getElementById("aiMagic-chat-panel");
  if (old) old.remove();

  const panel = document.createElement("div");
  panel.id = "aiMagic-chat-panel";
  panel.className = `aiMagic-panel${themeClass ? " " + themeClass : ""}`;

  panel.innerHTML = `
    <div class="aiMagic-panel-header aiMagic-chat-header" id="aiMagic-chat-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>AiMagic Chat</span>
      </div>
      <div style="display:flex;align-items:center;gap:2px;">
        <button class="aiMagic-btn-icon" id="aiMagic-chat-ctx-btn" title="Toggle page context">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </button>
        <button class="aiMagic-btn-icon" id="aiMagic-chat-clear-btn" title="Clear chat">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
        <button class="aiMagic-btn-icon" id="aiMagic-chat-close-btn" title="Close (Alt+X)">
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div id="aiMagic-chat-screenshot-preview" class="aiMagic-chat-screenshot-preview" style="display:none;">
      <img id="aiMagic-chat-preview-img" alt="Screenshot">
      <span class="aiMagic-chat-preview-label">Screenshot attached</span>
      <button class="aiMagic-btn-icon aiMagic-chat-preview-remove" id="aiMagic-chat-preview-remove" title="Remove screenshot">
        <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div id="aiMagic-chat-messages" class="aiMagic-panel-content aiMagic-chat-messages">
      <div class="aiMagic-chat-welcome">
        <div style="font-size:28px;margin-bottom:8px;">💬</div>
        <div>Ask anything, or press <kbd>📷</kbd> to capture the screen and auto-solve.</div>
        <div style="margin-top:6px;font-size:11px;opacity:0.7;">Shift+Enter for new line · Enter to send</div>
      </div>
    </div>

    <div class="aiMagic-chat-input-area">
      <button class="aiMagic-btn-icon" id="aiMagic-chat-camera-btn" title="Capture screenshot (attach to chat)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </button>
      <textarea id="aiMagic-chat-input" class="aiMagic-chat-input" placeholder="Ask anything..." rows="1"></textarea>
      <button class="aiMagic-btn-primary aiMagic-chat-send-btn" id="aiMagic-chat-send-btn" title="Send">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>

    <div class="aiMagic-resize-handle" id="aiMagic-chat-resize"></div>
  `;

  document.body.appendChild(panel);

  // Restore saved size
  chrome.storage.local.get(["aiMagic_chat_size", "aiMagic_chat_history"], (r) => {
    if (r.aiMagic_chat_size) {
      panel.style.width  = r.aiMagic_chat_size.width;
      panel.style.height = r.aiMagic_chat_size.height;
    }
    if (r.aiMagic_chat_history && Array.isArray(r.aiMagic_chat_history) && r.aiMagic_chat_history.length > 0) {
      chatHistory = r.aiMagic_chat_history;
      const msgsEl = document.getElementById("aiMagic-chat-messages");
      if (msgsEl) {
        msgsEl.innerHTML = "";
        chatHistory.forEach(m => chatAppendBubble(m.role, m.text));
      }
    }
  });

  // Draggable header
  const header = document.getElementById("aiMagic-chat-header");
  makeDraggable(panel, header, "aiMagic_chat_pos");

  // Resizable handle
  chatSetupResize(panel);

  // Close
  document.getElementById("aiMagic-chat-close-btn").addEventListener("click", () => {
    panel.classList.remove("aiMagic-chat-open");
  });

  // Clear
  document.getElementById("aiMagic-chat-clear-btn").addEventListener("click", chatClear);

  // Context toggle
  const ctxBtn = document.getElementById("aiMagic-chat-ctx-btn");
  ctxBtn.addEventListener("click", () => {
    chatContextEnabled = !chatContextEnabled;
    ctxBtn.classList.toggle("aiMagic-chat-ctx-active", chatContextEnabled);
    showToast(chatContextEnabled ? "Page context: ON" : "Page context: OFF");
  });

  // Camera
  document.getElementById("aiMagic-chat-camera-btn").addEventListener("click", chatCaptureScreen);

  // Remove screenshot preview
  document.getElementById("aiMagic-chat-preview-remove").addEventListener("click", () => {
    chatAttachedImage = null;
    document.getElementById("aiMagic-chat-screenshot-preview").style.display = "none";
  });

  // Send button
  document.getElementById("aiMagic-chat-send-btn").addEventListener("click", chatSend);

  // Input: Enter sends, Shift+Enter = newline; auto-resize
  const inputEl = document.getElementById("aiMagic-chat-input");
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); }
  });
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  });
}

function chatSetupResize(panel) {
  const handle = document.getElementById("aiMagic-chat-resize");
  if (!handle) return;
  let resizing = false, sx, sy, sw, sh;

  handle.addEventListener("mousedown", (e) => {
    resizing = true; sx = e.clientX; sy = e.clientY;
    sw = panel.offsetWidth; sh = panel.offsetHeight;
    e.preventDefault(); e.stopPropagation();
  });
  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    panel.style.width  = Math.max(300, sw + (e.clientX - sx)) + "px";
    panel.style.height = Math.max(380, sh + (e.clientY - sy)) + "px";
  });
  document.addEventListener("mouseup", () => {
    if (!resizing) return;
    resizing = false;
    chrome.storage.local.set({ aiMagic_chat_size: { width: panel.style.width, height: panel.style.height } });
  });
}

function chatToggle() {
  const panel = document.getElementById("aiMagic-chat-panel");
  if (!panel) return;
  const opening = !panel.classList.contains("aiMagic-chat-open");
  panel.classList.toggle("aiMagic-chat-open", opening);
  if (opening) {
    setTimeout(() => {
      const inp = document.getElementById("aiMagic-chat-input");
      if (inp) inp.focus();
    }, 80);
  }
}

function chatCaptureScreen() {
  document.body.classList.add("aiMagic-capturing");
  setTimeout(() => {
    chrome.runtime.sendMessage({ action: "CAPTURE_SCREENSHOT" }, (res) => {
      document.body.classList.remove("aiMagic-capturing");
      if (res && res.dataUrl) {
        chatAttachedImage = res.dataUrl;
        const previewEl = document.getElementById("aiMagic-chat-screenshot-preview");
        const imgEl     = document.getElementById("aiMagic-chat-preview-img");
        if (previewEl && imgEl) { imgEl.src = res.dataUrl; previewEl.style.display = "flex"; }
        // Open the chat panel if not already open
        const panel = document.getElementById("aiMagic-chat-panel");
        if (panel && !panel.classList.contains("aiMagic-chat-open")) panel.classList.add("aiMagic-chat-open");
      } else {
        showToast("Screenshot failed");
      }
    });
  }, 100);
}

function chatSend() {
  if (chatStreaming) return;

  const inputEl = document.getElementById("aiMagic-chat-input");
  const rawPrompt = inputEl ? inputEl.value.trim() : "";
  const hasImage  = !!chatAttachedImage;

  // Need at least a prompt or an image
  if (!rawPrompt && !hasImage) return;

  // Displayed user message
  const displayText = rawPrompt || "(Solve this)";

  // Build final prompt with optional page context
  let finalPrompt = rawPrompt || CHAT_DEFAULT_PROMPT;
  if (chatContextEnabled) {
    finalPrompt += "\n\n[Page Context]:\n" + document.body.innerText.slice(0, 5000);
  }

  // Show user bubble
  chatAppendBubble("user", displayText);

  // Clear input
  if (inputEl) { inputEl.value = ""; inputEl.style.height = "auto"; }

  // Build history to send (exclude current user turn — it's in prompt)
  const historyToSend = chatHistory.length > 0 ? chatHistory.slice() : undefined;

  // Add user turn to local history
  chatHistory.push({ role: "user", text: displayText });

  // Streaming state
  chatStreaming = true;
  chatStreamBuffer = "";
  chatStreamEl = chatAppendBubble("ai", "", true); // streaming=true → shows cursor

  // Dispatch to background
  chrome.runtime.sendMessage({
    action: "START_CHAT",
    prompt: finalPrompt,
    systemInstruction: CHAT_SYSTEM_INSTRUCTION,
    history: historyToSend,
    imageData: chatAttachedImage,
  });

  // Reset attached image
  chatAttachedImage = null;
  const previewEl = document.getElementById("aiMagic-chat-screenshot-preview");
  if (previewEl) previewEl.style.display = "none";
}

/**
 * Append a message bubble to the chat.
 * Returns the content <div> so streaming can update it.
 */
function chatAppendBubble(role, text, streaming = false) {
  const msgsEl = document.getElementById("aiMagic-chat-messages");
  if (!msgsEl) return null;

  // Remove welcome placeholder on first message
  const welcome = msgsEl.querySelector(".aiMagic-chat-welcome");
  if (welcome) welcome.remove();

  const row = document.createElement("div");
  row.className = `aiMagic-chat-message ${role === "user" ? "user" : "ai"}`;

  const bubble = document.createElement("div");
  bubble.className = "aiMagic-chat-message-content";

  if (streaming) {
    bubble.innerHTML = '<span class="aiMagic-chat-cursor"></span>';
  } else if (role === "user") {
    bubble.innerHTML = `<div style="white-space:pre-wrap;">${escapeHtml(text)}</div>`;
  } else {
    bubble.innerHTML = chatRenderMarkdown(text);
  }

  row.appendChild(bubble);
  msgsEl.appendChild(row);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  return bubble;
}

function chatChunkReceived(chunk) {
  if (!chatStreamEl) return;
  chatStreamBuffer += chunk;
  chatStreamEl.innerHTML =
    `<div style="white-space:pre-wrap;">${escapeHtml(chatStreamBuffer)}</div>` +
    '<span class="aiMagic-chat-cursor"></span>';
  const msgsEl = document.getElementById("aiMagic-chat-messages");
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
}

function chatStreamDone(fullText) {
  chatStreaming = false;
  const finalText = fullText || chatStreamBuffer;

  if (chatStreamEl) {
    chatStreamEl.innerHTML = chatRenderMarkdown(finalText);
    chatStreamEl = null;
  }

  chatHistory.push({ role: "model", text: finalText });
  chatStreamBuffer = "";

  // Persist last 20 turns (no images)
  chrome.storage.local.set({ aiMagic_chat_history: chatHistory.slice(-20) });

  const msgsEl = document.getElementById("aiMagic-chat-messages");
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
}

function chatStreamError(message) {
  chatStreaming = false;
  if (chatStreamEl) {
    chatStreamEl.innerHTML = `<div class="aiMagic-error">${escapeHtml(message)}</div>`;
    chatStreamEl = null;
  } else {
    const msgsEl = document.getElementById("aiMagic-chat-messages");
    if (msgsEl) {
      const errRow = document.createElement("div");
      errRow.className = "aiMagic-chat-message ai";
      errRow.innerHTML = `<div class="aiMagic-chat-message-content"><div class="aiMagic-error">${escapeHtml(message)}</div></div>`;
      msgsEl.appendChild(errRow);
    }
  }
  chatStreamBuffer = "";
}

function chatClear() {
  chatHistory = [];
  chatAttachedImage = null;
  chatStreaming = false;
  chatStreamBuffer = "";
  chatStreamEl = null;
  const msgsEl = document.getElementById("aiMagic-chat-messages");
  if (msgsEl) {
    msgsEl.innerHTML = `
      <div class="aiMagic-chat-welcome">
        <div style="font-size:28px;margin-bottom:8px;">💬</div>
        <div>Ask anything, or press 📷 to capture the screen and auto-solve.</div>
        <div style="margin-top:6px;font-size:11px;opacity:0.7;">Shift+Enter for new line · Enter to send</div>
      </div>`;
  }
  chrome.storage.local.remove("aiMagic_chat_history");
  const previewEl = document.getElementById("aiMagic-chat-screenshot-preview");
  if (previewEl) previewEl.style.display = "none";
}

// ── Markdown renderer ────────────────────────────────────────────────────────

function chatRenderMarkdown(raw) {
  if (!raw) return "";
  const codeBlocks = [];
  // Extract fenced code blocks first
  const withPlaceholders = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || "code", code: code.trim() });
    return `\x00CB${idx}\x00`;
  });

  const parts = withPlaceholders.split(/(\x00CB\d+\x00)/);
  return parts.map(part => {
    const m = part.match(/\x00CB(\d+)\x00/);
    if (m) {
      const { lang, code } = codeBlocks[parseInt(m[1])];
      return generateCodeBlockHtml((lang ? lang + "\n" : "") + code);
    }
    return chatRenderText(part);
  }).join("");
}

function chatRenderText(text) {
  const lines = text.split("\n");
  let html = "";
  let inUl = false, inOl = false;

  for (const line of lines) {
    const bm = line.match(/^[ \t]*[-*]\s+(.+)/);
    const nm = line.match(/^[ \t]*(\d+)\.\s+(.+)/);
    const hm = line.match(/^(#{1,4})\s+(.+)/);

    if (bm) {
      if (inOl) { html += "</ol>"; inOl = false; }
      if (!inUl) { html += '<ul class="aiMagic-list">'; inUl = true; }
      html += `<li>${chatInline(bm[1])}</li>`;
    } else if (nm) {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (!inOl) { html += '<ol class="aiMagic-list">'; inOl = true; }
      html += `<li>${chatInline(nm[2])}</li>`;
    } else {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (inOl) { html += "</ol>"; inOl = false; }
      if (hm) {
        const lvl = Math.min(hm[1].length + 2, 6);
        const sz  = [15, 14, 13, 13][hm[1].length - 1] || 13;
        html += `<h${lvl} style="margin:8px 0 3px;font-size:${sz}px;font-weight:700;">${chatInline(hm[2])}</h${lvl}>`;
      } else if (line.trim() === "") {
        if (html) html += '<div style="height:5px"></div>';
      } else {
        html += `<div style="margin:1px 0;line-height:1.65;">${chatInline(line)}</div>`;
      }
    }
  }
  if (inUl) html += "</ul>";
  if (inOl) html += "</ol>";
  return html;
}

function chatInline(t) {
  const e = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return e
    .replace(/`([^`]+)`/g, '<code class="aiMagic-code-inline">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

// ===== END CHAT PANEL =====

const openSolverPopup = () => {
  const popup = document.getElementById("aiMagic-solver-popup");
  if (popup) popup.classList.add("aiMagic-open");
};

const executeSolve = () => {
  // Hidden until response comes
  const popup = document.getElementById("aiMagic-solver-popup");

  showToast("AI is thinking...", true);

  captureScreenWithoutUI((resp) => {
    const bodyText = document.body.innerText;
    chrome.runtime.sendMessage(
      {
        action: "START_PIPELINE",
        domContext: {
          text: bodyText.substring(0, 12000),
          imageData: resp && resp.dataUrl ? resp.dataUrl : null,
        },
      },
      (res) => {
        if (chrome.runtime.lastError) {
          console.error("Pipeline message failed:", chrome.runtime.lastError);
          showToast("Extension connection lost. Please reload the page.");
          return;
        }

        if (res && res.type === "ERROR" && res.content === "Buy Premium to use AiMagic.") {
          hideToast();
          showToast(res.content);
          return;
        }

        renderResponse(res);
      },
    );
  });
};

function generateCodeBlockHtml(rawCode) {
  const lines = rawCode.trim().split("\n");
  let lang = "code";
  let code = rawCode.trim();

  // Heuristic: if first line is one word and not too long
  if (lines.length > 1 && lines[0].trim() && lines[0].trim().split(" ").length === 1 && lines[0].length < 15) {
    lang = lines[0].trim();
    code = lines.slice(1).join("\n").trim();
  }

  const escapedCode = escapeHtml(code);

  // Use TextEncoder for proper UTF-8 encoding
  const encoder = new TextEncoder();
  const bytes = encoder.encode(code);
  const binaryString = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  const b64Code = btoa(binaryString);

  return `
      <div class="aiMagic-code-container">
          <div class="aiMagic-code-header">
              <span class="aiMagic-code-lang">${lang}</span>
              <button class="aiMagic-copy-btn" data-code="${b64Code}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> 
                  Copy
              </button>
          </div>
          <pre>${escapedCode}</pre>
      </div>
    `;
}

const highlightPossibleAnswers = (res) => {
  if (!res || (res.type !== "SINGLE_MCQ" && res.type !== "MULTIPLE_MCQS")) return 0;

  let answers = [];
  const cleanAnswer = (s) => {
    if (!s) return "";
    return s
      .trim()
      .replace(/^["']|["']$/g, "") // remove wrapping quotes
      .replace(
        /^(The correct answer is|The answer is|Correct choice is|Answer|Option)[:\s]*/i,
        "",
      ) // remove common prefixes
      .replace(/^([A-Da-d])[\)\.]\s*/, "") // remove option letters like A) or 1. if AI hallucinated them
      .trim();
  };

  if (res.type === "SINGLE_MCQ") {
    answers.push(cleanAnswer(res.content));
  } else {
    try {
      const parsed = JSON.parse(res.content);
      answers = Array.isArray(parsed)
        ? parsed.map(cleanAnswer)
        : [cleanAnswer(res.content)];
    } catch (e) {
      answers.push(cleanAnswer(res.content));
    }
  }

  let foundCount = 0;
  answers.forEach((ans) => {
    if (ans && highlightExactTextNodes(document.body, ans)) foundCount++;
  });
  return foundCount;
};

const renderResponse = (res) => {
  hideToast();
  const popup = document.getElementById("aiMagic-solver-popup");
  const contentBox = document.getElementById("aiMagic-solver-content");
  if (popup) {
    popup.classList.remove("aiMagic-thinking");
    popup.classList.add("aiMagic-open");
  }
  if (!res || res.type === "ERROR") {
    contentBox.innerHTML = `<div class="aiMagic-error">Oops, Error: ${escapeHtml(res ? res.content : "Unknown error")}</div>`;
    return;
  }

  // Automatically highlight MCQ answers on page
  highlightPossibleAnswers(res);

  // 7. Response Formatter with enhanced UI
  let html = `<div><span class="aiMagic-tag">${res.type.replace("_", " ")}</span></div>`;

  if (res.type === "CODING") {
    html += generateCodeBlockHtml(res.content);
    contentBox.innerHTML = html;
  } else if (res.type === "MULTIPLE_MCQS") {
    try {
      const arr = JSON.parse(res.content);
      html += `<div class="aiMagic-mcq-list">`;
      arr.forEach((ans, idx) => {
        html += `
                <div class="aiMagic-mcq-card">
                    <div class="aiMagic-mcq-index">${idx + 1}</div>
                    <div class="aiMagic-mcq-text">${escapeHtml(ans)}</div>
                </div>`;
      });
      html += `</div>`;
    } catch (e) {
      html += `<div class="aiMagic-mcq-card">${escapeHtml(res.content)}</div>`;
    }
    contentBox.innerHTML = html;
  } else if (res.type === "SINGLE_MCQ") {
    html += `
            <div class="aiMagic-mcq-single">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>${escapeHtml(res.content)}</span>
            </div>`;
    contentBox.innerHTML = html;
  } else {
    // PARAGRAPH
    html += `<div style="margin-top: 10px; line-height: 1.6;">${escapeHtml(res.content)}</div>`;
    contentBox.innerHTML = html;
  }
};

let toastTimeout;
let currentToastPersistent = false;

function showToast(msg, spinning = false, persistent = false) {
  const toast = document.getElementById("aiMagic-toast");
  if (!toast) return;

  toast.innerHTML = spinning
    ? `<div class="aiMagic-toast-spinner"></div> ${msg}`
    : msg;
  toast.classList.add("aiMagic-show");

  clearTimeout(toastTimeout);
  currentToastPersistent = persistent;

  if (!persistent) {
    toastTimeout = setTimeout(() => {
      if (!currentToastPersistent) {
        toast.classList.remove("aiMagic-show");
      }
    }, 2000);
  }
}

function hideToast() {
  const toast = document.getElementById("aiMagic-toast");
  if (toast) toast.classList.remove("aiMagic-show");
  clearTimeout(toastTimeout);
  currentToastPersistent = false;
}

// === Verbatim AutoTyper Logic (from simulate_typing.js) ===
(function () {
  if (window.handleTypingCommand) return;

  let baseTypingDelay = 60; // 200ms default (for 60WPM)
  const JITTER = 25;
  const MISTAKE_CHANCE = 0.008;
  const THINKING_CHANCE = 0.005;

  function getDelayFromWPM(wpm) {
    if (!wpm) return 200;
    // WPM = (Chars/5) / Min => Min = (Chars/5) / WPM => ms = (60000 * Chars) / (WPM * 5)
    // Delay per char = 60000 / (WPM * 5)
    return 60000 / (parseInt(wpm) * 5);
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get("typerWPM", (result) => {
      if (result.typerWPM) {
        baseTypingDelay = getDelayFromWPM(result.typerWPM);
      } else {
        baseTypingDelay = getDelayFromWPM(60); // Default 60 WPM
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.typerWPM) {
        baseTypingDelay = getDelayFromWPM(changes.typerWPM.newValue);
      }
    });
  }

  let typingState = {
    fullText: "",
    currentIndex: 0,
    isPaused: false,
    isTyping: false,
    lastCharTimestamp: 0,
    animationFrameId: null,
    target: null,
    wasTypingBeforeInterruption: false,
  };

  const qwertyNeighbors = {
    q: "wa",
    w: "qase",
    e: "wsdr",
    r: "edft",
    t: "rfgy",
    y: "tghu",
    u: "yhji",
    i: "ujko",
    o: "iklp",
    p: "ol;",
    a: "qwsz",
    s: "awedx",
    d: "serfc",
    f: "drtgv",
    g: "ftyhb",
    h: "gyujn",
    j: "huikm",
    k: "jiol,",
    l: "kop;.",
    z: "asx",
    x: "zsdc",
    c: "xdfv",
    v: "cfgb",
    b: "vghn",
    n: "bhjm",
    m: "njk,",
  };

  function getNearbyKey(char) {
    const lowerChar = char.toLowerCase();
    const neighbors = qwertyNeighbors[lowerChar];
    return neighbors
      ? neighbors[Math.floor(Math.random() * neighbors.length)]
      : char;
  }

  function typingLoop(timestamp) {
    if (!typingState.isTyping) {
      typingState.animationFrameId = null;
      return;
    }
    if (typingState.isPaused) {
      // Don't spin rAF at 60fps while paused — resume paths restart the loop
      typingState.animationFrameId = null;
      return;
    }

    if (
      !typingState.target ||
      typingState.target !== document.activeElement
    ) {
      typingState.isPaused = true;
      typingState.animationFrameId = null;
      unblockKeyboardEvents();
      showToast("Typer paused (Focus lost)");
      return;
    }

    if (!typingState.lastCharTimestamp)
      typingState.lastCharTimestamp = timestamp;
    const elapsed = timestamp - typingState.lastCharTimestamp;
    const delay = baseTypingDelay + Math.random() * JITTER;

    if (elapsed >= delay) {
      let char = typingState.fullText[typingState.currentIndex];

      if (Math.random() < THINKING_CHANCE) {
        typingState.lastCharTimestamp =
          timestamp + 900 + Math.random() * 1200;
      } else if (
        Math.random() < MISTAKE_CHANCE &&
        char.trim() !== "" &&
        char !== "\n"
      ) {
        const typo = getNearbyKey(char);
        if (typeChar(typo, typingState.target)) {
          // Set timestamp far enough ahead to allow delete + re-type
          const mistakeDelay = baseTypingDelay * 2 + JITTER + 100;
          typingState.lastCharTimestamp = timestamp + mistakeDelay;
          setTimeout(
            () => deleteChar(typingState.target),
            baseTypingDelay + 10,
          );
          // currentIndex stays the same - correct char will be typed on next cycle
        }
      } else {
        if (typeChar(char, typingState.target)) {
          typingState.lastCharTimestamp = timestamp;
          if (char === "\n") handleNewline(typingState.target);
          typingState.currentIndex++;
        }
      }
    }

    if (typingState.currentIndex < typingState.fullText.length) {
      typingState.animationFrameId = requestAnimationFrame(typingLoop);
    } else {
      typingState.isTyping = false;
      typingState.isPaused = false;
      typingState.animationFrameId = null;
      unblockKeyboardEvents();
      if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.sendMessage
      ) {
        chrome.runtime
          .sendMessage({ type: "CONTENT_SCRIPT_READY" })
          .catch(() => { });
      }
      showToast("Typing completed!");
    }
  }

  function handleNewline(el) {
    let text = "";
    let cursorPos = 0;
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel.rangeCount) {
        cursorPos = sel.focusOffset;
        text = el.innerText;
      }
    } else if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      text = el.value;
      cursorPos = el.selectionStart;
    }
    const lineStart = text.lastIndexOf("\n", cursorPos - 2) + 1;
    const lineEnd = text.indexOf("\n", cursorPos);
    const currentLine = text.substring(
      lineStart,
      lineEnd === -1 ? text.length : lineEnd,
    );
    if (currentLine.trim() === "" && currentLine.length > 0) {
      for (let j = 0; j < currentLine.length; j++) deleteChar(el);
    }
  }

  async function handleTypingCommand(clipboardText = null) {
    if (typingState.isTyping && typingState.isPaused) {
      if (typingState.wasTypingBeforeInterruption) {
        typingState.wasTypingBeforeInterruption = false;
        return;
      }
      try {
        const currentClipboardText =
          clipboardText || (await navigator.clipboard.readText());
        if (
          currentClipboardText &&
          currentClipboardText !== typingState.fullText
        ) {
          typingState.fullText = currentClipboardText;
          typingState.currentIndex = 0;
          typingState.isPaused = false;
          typingState.lastCharTimestamp = performance.now();
          blockKeyboardEvents();
          if (!typingState.animationFrameId) {
            typingState.animationFrameId = requestAnimationFrame(typingLoop);
          }
        } else {
          typingState.isPaused = false;
          typingState.lastCharTimestamp = performance.now();
          blockKeyboardEvents();
          if (!typingState.animationFrameId) {
            typingState.animationFrameId = requestAnimationFrame(typingLoop);
          }
        }
        showToast("Typing resumed...", true);
      } catch (err) {
        typingState.isPaused = false;
        blockKeyboardEvents();
        if (!typingState.animationFrameId) {
          typingState.animationFrameId = requestAnimationFrame(typingLoop);
        }
        showToast("Clipboard error. Allow clipboard access.");
      }
    } else if (typingState.isTyping && !typingState.isPaused) {
      typingState.isPaused = true;
      unblockKeyboardEvents();
      showToast("Typing paused.");
    } else {
      const activeEl = document.activeElement;
      if (
        !activeEl ||
        (activeEl.tagName !== "TEXTAREA" &&
          activeEl.tagName !== "INPUT" &&
          !activeEl.isContentEditable)
      ) {
        showToast("Please click inside a text box first.");
        return;
      }
      try {
        const text = clipboardText || (await navigator.clipboard.readText());
        if (!text) {
          showToast("Clipboard is empty.");
          return;
        }
        typingState = {
          fullText: text,
          currentIndex: 0,
          isPaused: false,
          isTyping: true,
          lastCharTimestamp: 0,
          animationFrameId: null,
          target: activeEl,
          wasTypingBeforeInterruption: false,
        };
        blockKeyboardEvents();
        showToast("Typing started...", true);
        typingState.animationFrameId = requestAnimationFrame(typingLoop);
      } catch (err) { }
    }
  }

  function typeChar(char, el) {
    if (el !== document.activeElement) return false;
    try {
      if (el.isContentEditable) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return false;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(char));
        range.collapse(false);
        return true;
      } else if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const start = el.selectionStart;
        el.value =
          el.value.substring(0, start) +
          char +
          el.value.substring(el.selectionEnd);
        el.selectionStart = el.selectionEnd = start + 1;
        el.dispatchEvent(
          new Event("input", { bubbles: true, cancelable: true }),
        );
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  function deleteChar(el) {
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (range.collapsed && range.startOffset > 0) {
        const deleteRange = document.createRange();
        deleteRange.setStart(range.startContainer, range.startOffset - 1);
        deleteRange.setEnd(range.startContainer, range.startOffset);
        deleteRange.deleteContents();
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "deleteContentBackward",
          }),
        );
      } else if (!range.collapsed) {
        range.deleteContents();
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "deleteContentBackward",
          }),
        );
      }
    } else if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const start = el.selectionStart;
      if (start > 0) {
        el.value =
          el.value.substring(0, start - 1) +
          el.value.substring(el.selectionEnd);
        el.selectionStart = el.selectionEnd = start - 1;
        el.dispatchEvent(
          new Event("input", { bubbles: true, cancelable: true }),
        );
      }
    }
  }

  function blockHandler(e) {
    if (e.key === "Escape") {
      typingState.isTyping = false;
      typingState.isPaused = false;
      if (typingState.animationFrameId)
        cancelAnimationFrame(typingState.animationFrameId);
      typingState.animationFrameId = null;
      unblockKeyboardEvents();
      showToast("Typing aborted.");
      return;
    }
    if (e.ctrlKey && e.shiftKey) return true;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  }

  function blockKeyboardEvents() {
    window.addEventListener("keydown", blockHandler, true);
    window.addEventListener("keypress", blockHandler, true);
    window.addEventListener("keyup", blockHandler, true);
  }
  function unblockKeyboardEvents() {
    window.removeEventListener("keydown", blockHandler, true);
    window.removeEventListener("keypress", blockHandler, true);
    window.removeEventListener("keyup", blockHandler, true);
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      if (typingState.isTyping && !typingState.isPaused) {
        typingState.isPaused = true;
        typingState.wasTypingBeforeInterruption = true;
        unblockKeyboardEvents();
        showToast("Typing paused");
      }
    } else if (typingState.wasTypingBeforeInterruption) {
      typingState.isPaused = false;
      typingState.wasTypingBeforeInterruption = false;
      typingState.lastCharTimestamp = performance.now();
      blockKeyboardEvents();
      if (!typingState.animationFrameId)
        typingState.animationFrameId = requestAnimationFrame(typingLoop);
      showToast("Typing resumed...", true);
    }
  }

  function handleWindowBlur() {
    if (typingState.isTyping && !typingState.isPaused) {
      typingState.isPaused = true;
      typingState.wasTypingBeforeInterruption = true;
      unblockKeyboardEvents();
      showToast("Typing paused");
    }
  }

  function handleWindowFocus() {
    if (typingState.wasTypingBeforeInterruption) {
      typingState.isPaused = false;
      typingState.wasTypingBeforeInterruption = false;
      typingState.lastCharTimestamp = performance.now();
      blockKeyboardEvents();
      if (!typingState.animationFrameId)
        typingState.animationFrameId = requestAnimationFrame(typingLoop);
      showToast("Typing resumed...", true);
    }
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("blur", handleWindowBlur);
  window.addEventListener("focus", handleWindowFocus);
  window.handleTypingCommand = handleTypingCommand;
})();

function escapeRegexString(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightExactTextNodes(root, textToMatch) {
  if (!textToMatch || textToMatch.length < 1) return false;

  // Normalize text for detection - preserve original for matching
  const normalize = (s) => s.replace(/\s+/g, " ").trim();
  const normalizedTarget = normalize(textToMatch);

  // Quick check: If root doesn't contain the normalized text, skip expensive walking
  const rootText = normalize(root.textContent);
  if (!rootText.toLowerCase().includes(normalizedTarget.toLowerCase())) {
    return false;
  }

  let found = false;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );
  const nodesToReplace = [];

  // Create a regex that is flexible with whitespace
  // Fixed: Use proper whitespace handling
  const escapedMatch = escapeRegexString(normalizedTarget)
    .replace(/\s+/g, "\\s+"); // Allow flexible whitespace

  // We use a boundary check that allows punctuation like colons, brackets, etc.
  const regex = new RegExp(
    `(?<![a-zA-Z0-9])(${escapedMatch})(?![a-zA-Z0-9])`,
    "i",
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    // We also normalize the node value for matching
    const nodeText = normalize(node.nodeValue);
    if (nodeText.match(regex) || node.nodeValue.match(regex)) {
      const parent = node.parentElement;
      if (
        parent &&
        !["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName) &&
        !parent.closest(".aiMagic-panel") &&
        !parent.closest("#aiMagic-solver-btn")
      ) {
        nodesToReplace.push(node);
      }
    }
  }

  nodesToReplace.forEach((node) => {
    const parent = node.parentElement;
    const style = window.getComputedStyle(parent);
    const isBold =
      style.fontWeight === "700" ||
      style.fontWeight === "bold" ||
      parseInt(style.fontWeight) >= 600;

    const wrapper = document.createElement("span");
    // wrapper.className = "aiMagic-highlight-node";
    if (isBold) {
      wrapper.style.color = "#8b4513"; // Turn brown if already bold
    } else {
      wrapper.style.fontWeight = "bold"; // Get bold if not already
    }

    // Split the node value while preserving the original whitespace/case of the match
    const parts = node.nodeValue.split(new RegExp(`(${escapedMatch})`, "i"));
    const frag = document.createDocumentFragment();

    let nodeFound = false;
    parts.forEach((part) => {
      // We match by normalized comparison
      if (normalize(part).toLowerCase() === normalizedTarget.toLowerCase()) {
        const clone = wrapper.cloneNode();
        clone.textContent = part; // Keep original case/whitespace from DOM
        frag.appendChild(clone);
        nodeFound = true;
        found = true;
      } else if (part.length > 0) {
        frag.appendChild(document.createTextNode(part));
      }
    });

    if (nodeFound) {
      parent.replaceChild(frag, node);
    }
  });

  return found;
}

function handleGhostResponse(res) {
  if (!res || res.type === "ERROR") {
    showToast(`Ghost Msg: ${res ? res.content : "Unknown failure"}`);
    return;
  }

  if (res.type === "CODING") {
    copyToClipboard(res.content);
    showToast(`Copied!`);
  } else if (res.type === "SINGLE_MCQ" || res.type === "MULTIPLE_MCQS") {
    const foundCount = highlightPossibleAnswers(res);

    if (foundCount > 0) {
      showToast(`Highlighted!!`);
    } else {
      // Show the answer in toast as requested if highlighting fails
      showToast(`Ans: ${res.content}`, false);
    }
  } else {
    copyToClipboard(res.content);
    showToast(`${res.content}`);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "TOGGLE_BTN") {
    const btn = document.getElementById("aiMagic-solver-btn");
    const popup = document.getElementById("aiMagic-solver-popup");
    if (btn) {
      const isHidden =
        window.getComputedStyle(btn).display === "none" ||
        btn.style.display === "none";
      if (isHidden) {
        btn.style.display = "flex";
        if (popup) popup.style.display = ""; // Revert to CSS class display state
      } else {
        btn.style.display = "none";
        if (popup) popup.style.display = "none"; // Force hide
      }
    }
  } else if (request.action === "GHOST_SOLVE") {
    showToast("Processing...", true);
    captureScreenWithoutUI((resp) => {
      const bodyText = document.body.innerText;
      chrome.runtime.sendMessage(
        {
          action: "START_PIPELINE",
          domContext: {
            text: bodyText.substring(0, 12000),
            imageData: resp && resp.dataUrl ? resp.dataUrl : null,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("Ghost solve failed:", chrome.runtime.lastError);
            showToast("Extension connection lost");
            return;
          }
          handleGhostResponse(response);
        },
      ).catch(() => { });
    });
    return true;
  } else if (request.action === "EXECUTE_SOLVER") {
    const popup = document.getElementById("aiMagic-solver-popup");
    if (popup && popup.classList.contains("aiMagic-open")) {
      popup.classList.remove("aiMagic-open");
    }

    if (request.text) {
      captureScreenWithoutUI((resp) => {
        chrome.runtime.sendMessage(
          {
            action: "START_PIPELINE",
            domContext: {
              text: request.text,
              imageData: resp && resp.dataUrl ? resp.dataUrl : null,
            },
          },
          (res) => {
            if (chrome.runtime.lastError) {
              console.error("Execute solver failed:", chrome.runtime.lastError);
              showToast("Extension connection lost");
              return;
            }

            if (res && res.type === "ERROR" && res.content === "Buy Premium to use AiMagic.") {
              hideToast();
              showToast(res.content);
              return;
            }

            renderResponse(res);
          },
        );
      });
      return true;
    } else {
      executeSolve();
      return true; // Fixed: Added return true for async
    }
  } else if (request.action === "START_AUTOTYPE") {
    handleTypingCommand();
  } else if (request.action === "TOGGLE_CHAT") {
    chatToggle();
  } else if (request.action === "CHAT_CHUNK") {
    chatChunkReceived(request.chunk || "");
  } else if (request.action === "CHAT_DONE") {
    chatStreamDone(request.full || "");
  } else if (request.action === "CHAT_ERROR") {
    chatStreamError(request.message || "Unknown error");
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    if (changes.preferredTheme) {
      const theme = changes.preferredTheme.newValue || "dark";
      const themeClasses = ["aiMagic-theme-dark", "aiMagic-theme-ocean", "aiMagic-theme-contrast"];
      const ids = ["aiMagic-solver-btn", "aiMagic-solver-popup", "aiMagic-toast", "aiMagic-chat-panel"];
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          themeClasses.forEach((cls) => el.classList.remove(cls));
          if (theme !== "light") el.classList.add(`aiMagic-theme-${theme}`);
        }
      });
    }
    if (changes.uiOpacity) {
      document.documentElement.style.setProperty("--aiMagic-ui-opacity", changes.uiOpacity.newValue / 100);
    }
    if (changes.toastOpacity) {
      document.documentElement.style.setProperty("--aiMagic-toast-opacity", changes.toastOpacity.newValue / 100);
    }
  }
});

// Initial load
chrome.storage.local.get(["uiOpacity", "toastOpacity"], (res) => {
  if (res.uiOpacity) {
    document.documentElement.style.setProperty("--aiMagic-ui-opacity", res.uiOpacity / 100);
  }
  if (res.toastOpacity) {
    document.documentElement.style.setProperty("--aiMagic-toast-opacity", res.toastOpacity / 100);
  }
});

  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    injectUI();
  } else {
    window.addEventListener("DOMContentLoaded", injectUI);
  }
})();
