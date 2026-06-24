// ============================================================
// AI Tools Marketplace Panel — DevilBrowser
// ============================================================
(function() {
  'use strict';

  const panel      = document.getElementById('ai-tools-panel');
  const grid       = document.getElementById('ai-tools-grid');
  const tagFilter  = document.getElementById('ai-tools-tag-filter');
  const btnClose   = document.getElementById('ai-tools-close');
  const btnToggle  = document.getElementById('btn-ai-tools');
  const searchBox  = document.getElementById('ai-tools-search');

  let allTools = [];
  let activeTag = null;

  window.aiTools = {
    async open() {
      const token = await window.electronAPI.aiGetToken();
      if (!token) {
        if (window.aiAuth) window.aiAuth.showModal();
        return;
      }
      if (!panel) return;
      panel.classList.add('open');
      updateLayout();
      await loadTools();
    },
    close() {
      if (!panel) return;
      panel.classList.remove('open');
      updateLayout();
    }
  };

  function updateLayout() {
    if (window.updateLayout) {
      window.updateLayout();
    }
  }

  async function loadTools() {
    if (!grid) return;
    grid.innerHTML = '<div class="ai-tools-loading">Loading tools...</div>';
    try {
      const res = await window.electronAPI.aiGetTools();
      if (!res || !res.items) {
        grid.innerHTML = '<div class="ai-tools-empty">No tools available.</div>';
        return;
      }
      allTools = res.items;
      renderTagFilter();
      renderTools(allTools);
    } catch(e) {
      grid.innerHTML = `<div class="ai-tools-empty">⚠️ Could not load tools: ${e.message}</div>`;
    }
  }

  function renderTagFilter() {
    if (!tagFilter) return;
    const tags = new Set();
    allTools.forEach(t => (t.tags || []).forEach(tag => tags.add(tag)));
    tagFilter.innerHTML = '<button class="tag-pill active" data-tag="">All</button>';
    tags.forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'tag-pill';
      btn.dataset.tag = tag;
      btn.textContent = tag;
      tagFilter.appendChild(btn);
    });
    tagFilter.querySelectorAll('.tag-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        tagFilter.querySelectorAll('.tag-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTag = btn.dataset.tag || null;
        applyFilters();
      });
    });
  }

  function applyFilters() {
    const query = searchBox ? searchBox.value.toLowerCase() : '';
    const filtered = allTools.filter(t => {
      const matchTag = !activeTag || (t.tags || []).includes(activeTag);
      const matchSearch = !query || t.name.toLowerCase().includes(query) || (t.description || '').toLowerCase().includes(query);
      return matchTag && matchSearch;
    });
    renderTools(filtered);
  }

  function renderTools(tools) {
    if (!grid) return;
    if (tools.length === 0) {
      grid.innerHTML = '<div class="ai-tools-empty">No tools match your filter.</div>';
      return;
    }
    grid.innerHTML = '';
    tools.forEach(tool => {
      const card = document.createElement('div');
      card.className = 'ai-tool-card';

      const iconSrc = tool.icon || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40"><path fill="%23a5b4fc" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';

      card.innerHTML = `
        <div class="ai-tool-header">
          <img class="ai-tool-icon" src="${iconSrc}" alt="${tool.name}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 width=%2240%22 height=%2240%22><rect width=%2224%22 height=%2224%22 fill=%22%23312e81%22 rx=%224%22/></svg>'" />
          <div class="ai-tool-meta">
            <span class="ai-tool-name">${tool.name}</span>
            <span class="ai-tool-version">v${tool.version || '1.0'}</span>
          </div>
        </div>
        <p class="ai-tool-desc">${tool.description || ''}</p>
        <div class="ai-tool-footer">
          <div class="ai-tool-tags">${(tool.tags || []).map(t => `<span class="tag-chip">${t}</span>`).join('')}</div>
          <div class="ai-tool-stats">↓ ${tool.download_count || 0}</div>
        </div>
        <button class="ai-tool-download-btn" data-id="${tool.id}" data-type="${tool.type}" data-name="${tool.file_name || tool.name}">
          ${tool.type === 'external' ? '🔗 Open' : '⬇️ Download'}
        </button>
      `;

      card.querySelector('.ai-tool-download-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Downloading...';
        try {
          await window.electronAPI.aiDownloadTool(tool.id, tool.file_name || tool.name + '.zip', tool.type);
          btn.textContent = '✓ Done';
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = tool.type === 'external' ? '🔗 Open' : '⬇️ Download';
          }, 3000);
        } catch(err) {
          btn.textContent = '✗ Failed';
          btn.disabled = false;
        }
      });

      grid.appendChild(card);
    });
  }

  if (btnClose) btnClose.addEventListener('click', () => window.aiTools.close());
  if (btnToggle) btnToggle.addEventListener('click', () => {
    panel && panel.classList.contains('open') ? window.aiTools.close() : window.aiTools.open();
  });
  if (searchBox) searchBox.addEventListener('input', applyFilters);

})();
