// ============================================================
// Text Selection Quick Actions — DevilBrowser
// Popover that appears on text selection with AI action buttons
// Sprint 1 — DevilBrowser Advanced AI Features
// ============================================================
(function () {
  'use strict';

  const popover = document.getElementById('selection-popover');
  if (!popover) return;

  let hideTimeout = null;
  let lastSelection = '';

  const ACTIONS = [
    { id: 'explain',   icon: '💡', label: 'Explain',   prompt: (t) => `Explain the following in simple terms:\n\n"${t}"` },
    { id: 'summarise', icon: '📝', label: 'Summarise', prompt: (t) => `Summarise this in 1-2 sentences:\n\n"${t}"` },
    { id: 'translate', icon: '🌐', label: 'Translate', prompt: (t) => `Translate this to English (if not English) or Hindi:\n\n"${t}"` },
    { id: 'improve',   icon: '✨', label: 'Improve',   prompt: (t) => `Rewrite this to improve clarity and grammar:\n\n"${t}"` },
    { id: 'search',    icon: '🔍', label: 'Search',    prompt: null }, // special: opens search
    { id: 'copy',      icon: '📋', label: 'Copy',      prompt: null }  // special: copy to clipboard
  ];

  // Build the popover HTML once
  popover.innerHTML = `
    <div class="sel-popover-inner">
      ${ACTIONS.map(a => `
        <button class="sel-action-btn" data-action="${a.id}" title="${a.label}">
          <span class="sel-icon">${a.icon}</span>
          <span class="sel-label">${a.label}</span>
        </button>
      `).join('')}
    </div>
    <div class="sel-popover-arrow"></div>
  `;

  // Handle action clicks
  popover.querySelectorAll('.sel-action-btn').forEach(btn => {
    btn.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = ACTIONS.find(a => a.id === btn.dataset.action);
      if (!action) return;
      const text = lastSelection;
      hidePopover();

      if (action.id === 'copy') {
        try { await navigator.clipboard.writeText(text); showToast('📋 Copied!'); } catch(e) {}
        return;
      }
      if (action.id === 'search') {
        window.electronAPI.createTab(`https://www.google.com/search?q=${encodeURIComponent(text)}`);
        return;
      }
      // AI actions
      if (window.aiPanel) window.aiPanel.open();
      setTimeout(() => {
        const aiInput = document.getElementById('ai-panel-input');
        if (aiInput) {
          aiInput.value = action.prompt(text.length > 1000 ? text.slice(0, 1000) + '...' : text);
          document.getElementById('ai-panel-send')?.click();
        }
      }, 300);
    });
  });

  function showPopover(x, y) {
    popover.style.left = `${Math.min(x, window.innerWidth - 300)}px`;
    popover.style.top = `${y - 60}px`;
    popover.classList.remove('hidden');
    requestAnimationFrame(() => popover.classList.add('visible'));
  }

  function hidePopover() {
    popover.classList.remove('visible');
    setTimeout(() => popover.classList.add('hidden'), 150);
  }

  function showToast(msg) {
    if (window.showToastNotification) { window.showToastNotification(msg); }
  }

  document.addEventListener('mouseup', (e) => {
    // Don't trigger inside AI panel or settings
    if (e.target.closest('#ai-panel, #settings-panel, .cmd-palette-overlay, #selection-popover')) return;

    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (text.length > 5) {
        lastSelection = text;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const x = rect.left + rect.width / 2 - 140;
        const y = rect.top + window.scrollY;
        showPopover(x, y);
      } else {
        hidePopover();
      }
    }, 200);
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#selection-popover')) {
      hidePopover();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePopover();
  });
})();
