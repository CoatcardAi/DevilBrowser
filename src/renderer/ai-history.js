// ============================================================
// AI Request History Log Panel — DevilBrowser
// ============================================================
(function() {
  'use strict';

  const panel     = document.getElementById('ai-history-panel');
  const tbody     = document.getElementById('ai-history-tbody');
  const btnClose  = document.getElementById('ai-history-close');
  const btnToggle = document.getElementById('btn-ai-history');
  const filterStatus = document.getElementById('ai-history-filter-status');
  const filterModel  = document.getElementById('ai-history-filter-model');
  const paginationEl = document.getElementById('ai-history-pagination');

  const analyticsTotal = document.getElementById('analytics-total');
  const analyticsSuccessRate = document.getElementById('analytics-success-rate');
  const analyticsAvgLatency = document.getElementById('analytics-avg-latency');
  const analyticsTokens = document.getElementById('analytics-tokens');

  let currentSkip = 0;
  const PAGE_SIZE = 20;

  window.aiHistory = {
    async open() {
      const token = await window.electronAPI.aiGetToken();
      if (!token) {
        if (window.aiAuth) window.aiAuth.showModal();
        return;
      }
      if (!panel) return;
      panel.classList.add('open');
      updateLayout();
      await populateModelOptions();
      await loadLogs(0);
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

  async function populateModelOptions() {
    if (!filterModel) return;
    try {
      const res = await window.electronAPI.aiGetModels();
      if (res && res.models) {
        const currentVal = filterModel.value;
        filterModel.innerHTML = '<option value="">All Models</option>';
        res.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          filterModel.appendChild(opt);
        });
        filterModel.value = currentVal;
      }
    } catch (e) {}
  }

  async function updateTelemetry() {
    try {
      const res = await window.electronAPI.aiGetLogs({ limit: 100, skip: 0 });
      if (res && res.logs) {
        const logs = res.logs;
        const total = logs.length;
        if (total === 0) {
          if (analyticsTotal) analyticsTotal.textContent = '0';
          if (analyticsSuccessRate) analyticsSuccessRate.textContent = '0%';
          if (analyticsAvgLatency) analyticsAvgLatency.textContent = '0ms';
          if (analyticsTokens) analyticsTokens.textContent = '0';
          return;
        }

        const successes = logs.filter(l => l.status === 'success');
        const successRate = Math.round((successes.length / total) * 100);

        let totalLatency = 0;
        let latencyCount = 0;
        let totalTokens = 0;

        logs.forEach(l => {
          if (l.latency_ms) {
            totalLatency += l.latency_ms;
            latencyCount++;
          }
          if (l.usage_metadata && l.usage_metadata.totalTokenCount) {
            totalTokens += l.usage_metadata.totalTokenCount;
          }
        });

        const avgLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;
        
        let tokenStr = totalTokens.toString();
        if (totalTokens >= 1000000) {
          tokenStr = (totalTokens / 1000000).toFixed(1) + 'M';
        } else if (totalTokens >= 1000) {
          tokenStr = (totalTokens / 1000).toFixed(1) + 'k';
        }

        if (analyticsTotal) analyticsTotal.textContent = res.total;
        if (analyticsSuccessRate) analyticsSuccessRate.textContent = `${successRate}%`;
        if (analyticsAvgLatency) analyticsAvgLatency.textContent = `${avgLatency}ms`;
        if (analyticsTokens) analyticsTokens.textContent = tokenStr;
      }
    } catch (err) {
      console.error('Failed to update telemetry:', err);
    }
  }

  async function loadLogs(skip) {
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="ai-history-loading">Loading...</td></tr>';
    try {
      await updateTelemetry();
      const status = filterStatus ? filterStatus.value : '';
      const model  = filterModel  ? filterModel.value  : '';
      const res = await window.electronAPI.aiGetLogs({ limit: PAGE_SIZE, skip, status: status || undefined, model: model || undefined });
      if (!res || !res.logs) {
        tbody.innerHTML = '<tr><td colspan="5" class="ai-history-empty">No history available.</td></tr>';
        return;
      }
      currentSkip = skip;
      renderLogs(res.logs);
      renderPagination(res.total, skip);
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="5" class="ai-history-empty">⚠️ ${e.message}</td></tr>`;
    }
  }

  function renderLogs(logs) {
    if (!tbody) return;
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="ai-history-empty">No requests logged yet.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    logs.forEach(log => {
      const tr = document.createElement('tr');
      const date = new Date(log.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      const statusClass = log.status === 'success' ? 'success' : 'error';
      const tokens = log.usage_metadata ? log.usage_metadata.totalTokenCount : '—';
      tr.innerHTML = `
        <td>${date}</td>
        <td><code>${log.model || '—'}</code></td>
        <td class="ai-log-prompt" title="${(log.prompt_length || 0) + ' chars'}">${log.prompt_length || 0} chars</td>
        <td>${tokens}</td>
        <td><span class="ai-log-status ${statusClass}">${log.status}</span><br><small>${log.latency_ms || 0}ms</small></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderPagination(total, skip) {
    if (!paginationEl) return;
    const page = Math.floor(skip / PAGE_SIZE) + 1;
    const pages = Math.ceil(total / PAGE_SIZE);
    paginationEl.innerHTML = `
      <button class="ai-page-btn" ${skip === 0 ? 'disabled' : ''} data-skip="${Math.max(0, skip - PAGE_SIZE)}">← Prev</button>
      <span>Page ${page} of ${pages} (${total} total)</span>
      <button class="ai-page-btn" ${skip + PAGE_SIZE >= total ? 'disabled' : ''} data-skip="${skip + PAGE_SIZE}">Next →</button>
    `;
    paginationEl.querySelectorAll('.ai-page-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => loadLogs(parseInt(btn.dataset.skip)));
    });
  }

  if (btnClose)  btnClose.addEventListener('click', () => window.aiHistory.close());
  if (btnToggle) btnToggle.addEventListener('click', () => {
    panel && panel.classList.contains('open') ? window.aiHistory.close() : window.aiHistory.open();
  });
  if (filterStatus) filterStatus.addEventListener('change', () => loadLogs(0));
  if (filterModel)  filterModel.addEventListener('change',  () => loadLogs(0));

})();
