(function () {
    if (window.handleTypingCommand) {
        // console.log("Typing script already loaded.");
        return;
    }

    // === Configuration ===
    let baseTypingDelay = 60;
    const JITTER = 40;
    const MISTAKE_CHANCE = 0.01;
    const THINKING_CHANCE = 0.009;

    // Load saved speed
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get('typingSpeed', (result) => {
            if (result.typingSpeed) {
                baseTypingDelay = result.typingSpeed;
            }
        });

        // Listen for changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.typingSpeed) {
                baseTypingDelay = changes.typingSpeed.newValue;
            }
        });
    }

    // === State ===
    let typingState = {
        fullText: '',
        currentIndex: 0,
        isPaused: false,
        isTyping: false,
        lastCharTimestamp: 0,
        animationFrameId: null,
        target: null,
        wasTypingBeforeInterruption: false,
    };

    // === Helpers ===
    const qwertyNeighbors = {
        'q': 'wa', 'w': 'qase', 'e': 'wsdr', 'r': 'edft', 't': 'rfgy', 'y': 'tghu',
        'u': 'yhji', 'i': 'ujko', 'o': 'iklp', 'p': 'ol;', 'a': 'qwsz', 's': 'awedx',
        'd': 'serfc', 'f': 'drtgv', 'g': 'ftyhb', 'h': 'gyujn', 'j': 'huikm', 'k': 'jiol,',
        'l': 'kop;.', 'z': 'asx', 'x': 'zsdc', 'c': 'xdfv', 'v': 'cfgb', 'b': 'vghn',
        'n': 'bhjm', 'm': 'njk,',
    };

    function getNearbyKey(char) {
        const lowerChar = char.toLowerCase();
        const neighbors = qwertyNeighbors[lowerChar];
        return neighbors ? neighbors[Math.floor(Math.random() * neighbors.length)] : char;
    }

    // === Core Typing Loop ===
    function typingLoop(timestamp) {
        if (typingState.isPaused || !typingState.isTyping) {
            typingState.animationFrameId = requestAnimationFrame(typingLoop);
            return;
        }

        if (!typingState.target || typingState.target !== document.activeElement) {
            // console.warn("Focus lost. Pausing typing.");
            typingState.isPaused = true;
            unblockKeyboardEvents();
            typingState.animationFrameId = requestAnimationFrame(typingLoop);
            return;
        }

        if (!typingState.lastCharTimestamp) {
            typingState.lastCharTimestamp = timestamp;
        }

        const elapsed = timestamp - typingState.lastCharTimestamp;
        const delay = baseTypingDelay + Math.random() * JITTER;

        if (elapsed >= delay) {
            let char = typingState.fullText[typingState.currentIndex];

            if (Math.random() < THINKING_CHANCE) {
                typingState.lastCharTimestamp = timestamp + 900 + Math.random() * 1200;
            } else if (Math.random() < MISTAKE_CHANCE && char.trim() !== '' && char !== '\n') {
                const typo = getNearbyKey(char);
                if (typeChar(typo, typingState.target)) {
                    typingState.lastCharTimestamp = timestamp + baseTypingDelay + JITTER + 50;
                    setTimeout(() => deleteChar(typingState.target), baseTypingDelay + 10);
                }
            } else {
                if (typeChar(char, typingState.target)) {
                    typingState.lastCharTimestamp = timestamp;

                    if (char === '\n') {
                        handleNewline(typingState.target);
                    }

                    typingState.currentIndex++;
                } else {
                    // Typing failed (likely lost focus), don't advance index.
                    // The loop will retry or pause on next iteration.
                    // console.warn("Failed to type char, retrying...");
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

            // Notify background script that content script is still responsive
            // This ensures shortcuts work again immediately after typing completes
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" }).catch(() => { });
            }
            // console.log("Typing finished.");
        }
    }

    // === Newline Cleanup ===
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

        // get current line
        const lineStart = text.lastIndexOf("\n", cursorPos - 2) + 1;
        const lineEnd = text.indexOf("\n", cursorPos);
        const currentLine = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);

        // if line only spaces/tabs, delete them
        if (currentLine.trim() === "" && currentLine.length > 0) {
            for (let j = 0; j < currentLine.length; j++) {
                deleteChar(el);
            }
        }
    }

    // === Event Handler ===
    async function handleTypingCommand(clipboardText = null) {
        // CASE 1: Session is active and currently PAUSED. This is a RESUME attempt.
        if (typingState.isTyping && typingState.isPaused) {
            // SPECIAL CASE: If we are auto-paused (due to blur), and user triggers command,
            // they likely intended to PAUSE the running session (not resume).
            if (typingState.wasTypingBeforeInterruption) {
                // console.log("User manually paused during auto-pause. Disabling auto-resume.");
                typingState.wasTypingBeforeInterruption = false;
                // We remain paused.
                return;
            }

            // console.log("Attempting to resume typing...");
            try {
                const currentClipboardText = clipboardText || await navigator.clipboard.readText();

                // If clipboard content is different from what we were typing, start over.
                if (currentClipboardText && currentClipboardText !== typingState.fullText) {
                    // console.log("Clipboard has new content. Starting over.");

                    // Reset state for a new session with the new text
                    typingState.fullText = currentClipboardText;
                    typingState.currentIndex = 0;
                    typingState.isPaused = false;
                    typingState.lastCharTimestamp = performance.now();

                    blockKeyboardEvents(); // Re-block events

                } else {
                    // Otherwise, just resume the existing session.
                    // console.log("Resuming previous typing session.");
                    typingState.isPaused = false;
                    typingState.lastCharTimestamp = performance.now(); // Reset timer to avoid jump
                    blockKeyboardEvents(); // Re-block events
                }
            } catch (err) {
                // console.error("Failed to read clipboard on resume:", err);
                // On error, just resume the old session to be safe.
                typingState.isPaused = false;
                blockKeyboardEvents();
            }
        }
        // CASE 2: Session is active and RUNNING. This is a PAUSE attempt.
        else if (typingState.isTyping && !typingState.isPaused) {
            // console.log("Typing paused.");
            typingState.isPaused = true;
            unblockKeyboardEvents(); // Allow interaction while paused
        }
        // CASE 3: No session is active. START a new one.
        else { // !typingState.isTyping
            // console.log("Starting new typing session.");
            const activeEl = document.activeElement;
            if (!activeEl || (activeEl.tagName !== 'TEXTAREA' && activeEl.tagName !== 'INPUT' && !activeEl.isContentEditable)) {
                // console.warn("No active textarea or contentEditable element found.");
                return;
            }
            try {
                const text = clipboardText || await navigator.clipboard.readText();
                if (!text) {
                    // console.warn("Clipboard is empty. Nothing to type.");
                    return;
                }

                typingState = {
                    fullText: text, // Store the initial text
                    currentIndex: 0,
                    isPaused: false,
                    isTyping: true,
                    lastCharTimestamp: 0,
                    animationFrameId: null,
                    target: activeEl,
                    wasTypingBeforeInterruption: false,
                };

                blockKeyboardEvents();
                typingState.animationFrameId = requestAnimationFrame(typingLoop);
            } catch (err) {
                // console.error("Failed to read clipboard on start:", err);
            }
        }
    }

    // === Low-level Typing Actions ===
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
                el.value = el.value.substring(0, start) + char + el.value.substring(el.selectionEnd);
                el.selectionStart = el.selectionEnd = start + 1;
                el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                return true;
            }
        } catch (e) {
            // console.error("typeChar failed:", e);
            return false;
        }
        return false;
    }

    function deleteChar(el) {
        if (el.isContentEditable) {
            // MODERN APPROACH: Use Range API instead of deprecated execCommand
            const sel = window.getSelection();
            if (!sel.rangeCount) return;

            const range = sel.getRangeAt(0);

            // If no selection and cursor is not at start, delete previous character
            if (range.collapsed && range.startOffset > 0) {
                // Create a range that selects the previous character
                const deleteRange = document.createRange();
                deleteRange.setStart(range.startContainer, range.startOffset - 1);
                deleteRange.setEnd(range.startContainer, range.startOffset);
                deleteRange.deleteContents();

                // Dispatch InputEvent for framework compatibility (React, Vue, etc.)
                const inputEvent = new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'deleteContentBackward',
                    data: null
                });
                el.dispatchEvent(inputEvent);
            } else if (!range.collapsed) {
                // If there's a selection, delete it
                range.deleteContents();

                const inputEvent = new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'deleteContentBackward',
                    data: null
                });
                el.dispatchEvent(inputEvent);
            }
        } else if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
            const start = el.selectionStart;
            if (start > 0) {
                el.value = el.value.substring(0, start - 1) + el.value.substring(el.selectionEnd);
                el.selectionStart = el.selectionEnd = start - 1;
                el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }
        }
    }

    // === Keyboard Blocking (Capturing Listeners) ===
    function blockHandler(e) {
        // Allow extension shortcuts (Ctrl+Shift combinations) to pass through
        // This enables refresh (Ctrl+Shift+R) and pause (Ctrl+Shift+.) during typing
        if (e.ctrlKey && e.shiftKey) {
            return true; // Let the extension handle this
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return false;
    }

    function blockKeyboardEvents() {
        window.addEventListener('keydown', blockHandler, true);
        window.addEventListener('keypress', blockHandler, true);
        window.addEventListener('keyup', blockHandler, true);
    }

    function unblockKeyboardEvents() {
        window.removeEventListener('keydown', blockHandler, true);
        window.removeEventListener('keypress', blockHandler, true);
        window.removeEventListener('keyup', blockHandler, true);
    }

    // === Focus Management ===
    function handleVisibilityChange() {
        if (document.hidden) {
            // Page hidden
            if (typingState.isTyping && !typingState.isPaused) {
                // console.log("Page hidden. Auto-pausing typing.");
                typingState.isPaused = true;
                typingState.wasTypingBeforeInterruption = true;
                unblockKeyboardEvents();
            }
        } else {
            // Page visible
            if (typingState.wasTypingBeforeInterruption) {
                // console.log("Page visible. Resuming typing.");
                typingState.isPaused = false;
                typingState.wasTypingBeforeInterruption = false;
                typingState.lastCharTimestamp = performance.now(); // Reset timer
                blockKeyboardEvents();
                // Ensure loop is running if it somehow stopped
                if (!typingState.animationFrameId) {
                    typingState.animationFrameId = requestAnimationFrame(typingLoop);
                }
            }
        }
    }

    function handleWindowBlur() {
        if (typingState.isTyping && !typingState.isPaused) {
            // console.log("Window lost focus. Auto-pausing typing.");
            typingState.isPaused = true;
            typingState.wasTypingBeforeInterruption = true;
            unblockKeyboardEvents();
        }
    }

    function handleWindowFocus() {
        if (typingState.wasTypingBeforeInterruption) {
            // console.log("Window regained focus. Resuming typing.");
            typingState.isPaused = false;
            typingState.wasTypingBeforeInterruption = false;
            typingState.lastCharTimestamp = performance.now(); // Reset timer
            blockKeyboardEvents();
            if (!typingState.animationFrameId) {
                typingState.animationFrameId = requestAnimationFrame(typingLoop);
            }
        }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);

    // Expose to global scope
    window.handleTypingCommand = handleTypingCommand;
    // console.log("Typing script ready. Place cursor and run handleTypingCommand().");

})();
