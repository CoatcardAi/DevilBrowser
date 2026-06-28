// ============================================================
// Command Palette — DevilBrowser (Ctrl+K)
// Sprint 1 — DevilBrowser Advanced AI Features
// ============================================================
(function () {
  'use strict';

  // ── State ──
  let isOpen = false;
  let allCommands = [];
  let filtered = [];
  let selectedIdx = 0;
  let searchDebounce = null;

  // ── DOM ──
  const overlay = document.getElementById('cmd-palette-overlay');
  const input   = document.getElementById('cmd-palette-input');
  const list    = document.getElementById('cmd-palette-list');
  const hint    = document.getElementById('cmd-palette-hint');

  if (!overlay || !input || !list) return;

  // ── Command Registry ──
  function buildCommands() {
    const tabs = window._tabs || [];
    const activeTabId = window._activeTabId;
    const activeTab = tabs.find(t => t.id === activeTabId);

    allCommands = [
      // ── Navigation ──
      {
        id: 'new-tab',
        icon: '＋',
        label: 'New Tab',
        category: 'Navigation',
        shortcut: 'Ctrl+T',
        action: () => window.electronAPI.createTab('about:blank')
      },
      {
        id: 'new-incognito',
        icon: '🕵️',
        label: 'New Incognito Window',
        category: 'Navigation',
        shortcut: 'Ctrl+Shift+N',
        action: () => window.electronAPI.createTab('about:blank') // triggers incognito from main
      },
      {
        id: 'close-tab',
        icon: '✕',
        label: 'Close Current Tab',
        category: 'Navigation',
        shortcut: 'Ctrl+W',
        action: () => activeTabId && window.electronAPI.closeTab(activeTabId)
      },
      {
        id: 'go-back',
        icon: '←',
        label: 'Go Back',
        category: 'Navigation',
        action: () => activeTabId && window.electronAPI.goBack(activeTabId)
      },
      {
        id: 'go-forward',
        icon: '→',
        label: 'Go Forward',
        category: 'Navigation',
        action: () => activeTabId && window.electronAPI.goForward(activeTabId)
      },
      {
        id: 'reload',
        icon: '↻',
        label: 'Reload Page',
        category: 'Navigation',
        shortcut: 'Ctrl+R',
        action: () => activeTabId && window.electronAPI.reload(activeTabId)
      },

      // ── AI Tasks ──
      {
        id: 'ai-summarise',
        icon: '✨',
        label: 'Summarise This Page',
        category: 'AI',
        action: () => {
          if (window.aiPanel) window.aiPanel.open();
          setTimeout(() => {
            const input = document.getElementById('ai-panel-input');
            if (input) {
              input.value = 'Please summarise the content of this page in 5 bullet points.';
              document.getElementById('ai-panel-send')?.click();
            }
          }, 300);
        }
      },
      {
        id: 'ai-fill-form',
        icon: '📝',
        label: 'Auto-Fill Forms on Page',
        category: 'AI',
        action: () => {
          if (window.aiPanel) window.aiPanel.open();
          setTimeout(() => {
            const input = document.getElementById('ai-panel-input');
            if (input) {
              input.value = 'Please find all input fields and forms on this page and fill them using my persona profile.';
              document.getElementById('ai-panel-send')?.click();
            }
          }, 300);
        }
      },
      {
        id: 'ai-apply-job',
        icon: '💼',
        label: 'Apply to This Job',
        category: 'AI',
        action: () => {
          if (window.aiPanel) window.aiPanel.open();
          setTimeout(() => {
            const input = document.getElementById('ai-panel-input');
            if (input) {
              input.value = 'Please read this job posting, understand the requirements, and help me apply using my profile. Show me what you will fill before submitting.';
              document.getElementById('ai-panel-send')?.click();
            }
          }, 300);
        }
      },
      {
        id: 'ai-extract-data',
        icon: '📊',
        label: 'Extract Data from Page',
        category: 'AI',
        action: () => {
          if (window.aiPanel) window.aiPanel.open();
          setTimeout(() => {
            const input = document.getElementById('ai-panel-input');
            if (input) {
              input.value = 'Please extract all structured data from this page: tables, prices, emails, phone numbers, addresses. Format as a clean list.';
              document.getElementById('ai-panel-send')?.click();
            }
          }, 300);
        }
      },
      {
        id: 'ai-research',
        icon: '🔍',
        label: 'Research Mode',
        category: 'AI',
        action: () => {
          if (window.aiPanel) window.aiPanel.open();
          setTimeout(() => {
            const input = document.getElementById('ai-panel-input');
            if (input) {
              input.value = 'Enter research mode. I want you to research ';
              document.getElementById('ai-panel-input').focus();
            }
          }, 300);
        }
      },
      {
        id: 'ai-translate',
        icon: '🌐',
        label: 'Translate Page',
        category: 'AI',
        action: () => {
          if (window.aiPanel) window.aiPanel.open();
          setTimeout(() => {
            const input = document.getElementById('ai-panel-input');
            if (input) {
              input.value = 'Please translate the main content of this page to English.';
              document.getElementById('ai-panel-send')?.click();
            }
          }, 300);
        }
      },
      {
        id: 'ai-generate-image',
        icon: '🎨',
        label: 'Generate AI Image',
        category: 'AI',
        action: () => window.aiImage && window.aiImage.open()
      },

      // ── Panels ──
      {
        id: 'open-downloads',
        icon: '⬇️',
        label: 'Open Downloads',
        category: 'Panels',
        shortcut: 'Ctrl+J',
        action: () => document.getElementById('btn-downloads-toggle')?.click()
      },
      {
        id: 'open-bookmarks',
        icon: '⭐',
        label: 'Open Bookmarks',
        category: 'Panels',
        shortcut: 'Ctrl+Shift+O',
        action: () => document.getElementById('btn-bookmarks-manager-toggle')?.click()
      },
      {
        id: 'open-settings',
        icon: '⚙️',
        label: 'Open Settings',
        category: 'Panels',
        action: () => document.getElementById('btn-settings')?.click()
      },
      {
        id: 'open-ai-tools',
        icon: '🛒',
        label: 'AI Marketplace',
        category: 'Panels',
        action: () => window.aiTools && window.aiTools.open()
      },
      {
        id: 'open-history',
        icon: '📜',
        label: 'AI Request History',
        category: 'Panels',
        action: () => window.aiHistory && window.aiHistory.open()
      },

      // ── Browser Actions ──
      {
        id: 'toggle-adblocker',
        icon: '🛡️',
        label: 'Toggle Ad Blocker',
        category: 'Browser',
        action: () => {
          const toggle = document.getElementById('toggle-adblocker');
          if (toggle) { toggle.click(); }
        }
      },
      {
        id: 'bookmark-page',
        icon: '🔖',
        label: 'Bookmark This Page',
        category: 'Browser',
        shortcut: 'Ctrl+D',
        action: () => document.getElementById('btn-bookmark-page')?.click()
      },
      {
        id: 'zoom-in',
        icon: '🔍',
        label: 'Zoom In',
        category: 'Browser',
        action: () => activeTabId && window.electronAPI.navigateTab({ tabId: activeTabId, url: '' })
      },
      {
        id: 'clear-cache',
        icon: '🗑️',
        label: 'Clear Browsing Data',
        category: 'Browser',
        action: () => document.getElementById('btn-clear-cache')?.click()
      },

      // ── Tabs (dynamic) ──
      ...tabs.map(tab => ({
        id: 'switch-tab-' + tab.id,
        icon: tab.favicon ? '🌐' : '📄',
        label: `Switch to: ${tab.title || tab.url || 'New Tab'}`,
        category: 'Tabs',
        subtitle: tab.url !== 'about:blank' ? tab.url : '',
        action: () => window.electronAPI.setActiveTab(tab.id)
      }))
    ];
  }

  // ── Fuzzy Search ──
  function fuzzyMatch(query, str) {
    if (!query) return true;
    const q = query.toLowerCase();
    const s = str.toLowerCase();
    if (s.includes(q)) return true;
    // simple char-by-char match
    let qi = 0;
    for (let i = 0; i < s.length && qi < q.length; i++) {
      if (s[i] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  let currentSearchQuery = '';

  async function fetchAsyncMatches(query) {
    currentSearchQuery = query;
    try {
      const results = await window.electronAPI.aiSemanticSearch(query);
      if (currentSearchQuery !== query) return;
      if (!isOpen) return;

      const historyCommands = results.map(res => ({
        id: 'history-' + res.url,
        icon: '📜',
        label: res.title || res.url,
        category: 'History',
        subtitle: `Semantic Match | ${res.url}`,
        action: () => window.electronAPI.createTab(res.url)
      }));

      const q = query.toLowerCase();
      const localMatches = allCommands
        .filter(c => fuzzyMatch(q, c.label) || fuzzyMatch(q, c.category) || (c.subtitle && fuzzyMatch(q, c.subtitle)));

      const uniqueKeys = new Set(localMatches.map(m => m.id));
      const uniqueHistory = historyCommands.filter(h => !uniqueKeys.has(h.id));

      filtered = [...localMatches, ...uniqueHistory].slice(0, 20);
      render();
    } catch (e) {
      console.error('Command Palette async search failed:', e);
    }
  }

  function filterCommands(query) {
    if (!query.trim()) {
      filtered = allCommands.slice(0, 20);
      currentSearchQuery = '';
    } else {
      const q = query.trim().toLowerCase();
      filtered = allCommands
        .filter(c => fuzzyMatch(q, c.label) || fuzzyMatch(q, c.category) || (c.subtitle && fuzzyMatch(q, c.subtitle)))
        .slice(0, 20);

      fetchAsyncMatches(query.trim());
    }
    selectedIdx = 0;
  }

  // ── Render ──
  function render() {
    list.innerHTML = '';
    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="cmd-empty">
          <div class="cmd-empty-icon">🔍</div>
          <div>No commands found</div>
          <div class="cmd-empty-sub">Try searching for a URL or asking the AI something</div>
        </div>`;
      return;
    }

    let lastCat = null;
    filtered.forEach((cmd, idx) => {
      if (cmd.category !== lastCat) {
        lastCat = cmd.category;
        const sep = document.createElement('div');
        sep.className = 'cmd-category';
        sep.textContent = cmd.category;
        list.appendChild(sep);
      }
      const item = document.createElement('div');
      item.className = `cmd-item${idx === selectedIdx ? ' selected' : ''}`;
      item.dataset.idx = idx;
      item.innerHTML = `
        <span class="cmd-item-icon">${cmd.icon}</span>
        <div class="cmd-item-text">
          <span class="cmd-item-label">${highlightMatch(cmd.label, input.value)}</span>
          ${cmd.subtitle ? `<span class="cmd-item-sub">${cmd.subtitle.slice(0, 60)}</span>` : ''}
        </div>
        ${cmd.shortcut ? `<span class="cmd-item-shortcut">${cmd.shortcut}</span>` : ''}
      `;
      item.addEventListener('mouseenter', () => { selectedIdx = idx; renderSelection(); });
      item.addEventListener('mousedown', (e) => { e.preventDefault(); executeCommand(cmd); });
      list.appendChild(item);
    });
  }

  function renderSelection() {
    list.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.classList.toggle('selected', i === selectedIdx);
    });
    // Scroll into view
    const selected = list.querySelector('.cmd-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function highlightMatch(label, query) {
    if (!query.trim()) return label;
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return label.replace(re, '<mark>$1</mark>');
  }

  // ── Open / Close ──
  function open() {
    if (isOpen) return;
    isOpen = true;
    buildCommands();
    filterCommands('');
    render();
    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
    input.value = '';
    input.focus();
    if (hint) hint.textContent = `${allCommands.length} actions available`;
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove('visible');
    setTimeout(() => overlay.classList.add('hidden'), 200);
    input.value = '';
  }

  function executeCommand(cmd) {
    close();
    setTimeout(() => cmd.action(), 50);
  }

  // ── URL/AI fallback ──
  function handleEnter() {
    const query = input.value.trim();
    if (filtered.length > 0 && filtered[selectedIdx]) {
      executeCommand(filtered[selectedIdx]);
      return;
    }
    // Treat as URL or AI prompt
    if (!query) return;
    close();
    if (/^https?:\/\//.test(query) || /^[\w-]+\.[\w.-]+/.test(query)) {
      window.electronAPI.createTab(query.startsWith('http') ? query : 'https://' + query);
    } else {
      // Send to AI
      if (window.aiPanel) window.aiPanel.open();
      setTimeout(() => {
        const aiInput = document.getElementById('ai-panel-input');
        if (aiInput) { aiInput.value = query; document.getElementById('ai-panel-send')?.click(); }
      }, 300);
    }
  }

  // ── Event Listeners ──
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      filterCommands(input.value);
      render();
    }, 80);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1); renderSelection(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); renderSelection(); }
    else if (e.key === 'Enter') { e.preventDefault(); handleEnter(); }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Tab') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1); renderSelection(); }
  });

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  // ── Global Shortcut (Ctrl+K) ──
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      isOpen ? close() : open();
    }
    if (e.key === 'Escape' && isOpen) close();
  });

  // Listen for global shortcut forwarded from main process
  window.electronAPI.on('open-command-palette', () => {
    isOpen ? close() : open();
  });

  // Expose for external use
  window.cmdPalette = { open, close };
})();
