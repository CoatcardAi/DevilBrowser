// ============================================================
// AI Task HUD — DevilBrowser
// Floating overlay showing live AI task steps (like ChatGPT's "Searching...")
// Sprint 1 — DevilBrowser Advanced AI Features
// ============================================================
(function () {
  'use strict';

  const hud = document.getElementById('ai-task-hud');
  const hudTitle = document.getElementById('ai-hud-title');
  const hudSteps = document.getElementById('ai-hud-steps');
  const hudCancel = document.getElementById('ai-hud-cancel');
  const hudMinimize = document.getElementById('ai-hud-minimize');

  if (!hud) return;

  let steps = [];
  let isMinimized = false;
  let onCancelCallback = null;

  const HUD = window.aiTaskHUD = {
    // Start a new task with a title
    start(title, onCancel) {
      steps = [];
      onCancelCallback = onCancel || null;
      isMinimized = false;
      if (hudTitle) hudTitle.textContent = title;
      if (hudSteps) hudSteps.innerHTML = '';
      hud.classList.remove('hidden', 'minimized');
      hud.classList.add('visible');
    },

    // Add a new step
    addStep(text, status = 'running') {
      const step = { text, status, id: Date.now() };
      steps.push(step);
      renderStep(step);
      return step.id;
    },

    // Update a step status: 'running' | 'done' | 'error' | 'skip'
    updateStep(id, status, newText) {
      const step = steps.find(s => s.id === id);
      if (!step) return;
      step.status = status;
      if (newText) step.text = newText;
      renderSteps();
    },

    // Complete the task
    done(summaryText) {
      const doneEl = document.createElement('div');
      doneEl.className = 'hud-done-line';
      doneEl.innerHTML = `<span class="hud-step-icon done">✓</span><span>${summaryText || 'Task completed'}</span>`;
      if (hudSteps) hudSteps.appendChild(doneEl);
      hud.classList.add('done');
      setTimeout(() => HUD.hide(), 4000);
    },

    // Error state
    error(message) {
      const errEl = document.createElement('div');
      errEl.className = 'hud-error-line';
      errEl.innerHTML = `<span class="hud-step-icon error">✕</span><span>${message}</span>`;
      if (hudSteps) hudSteps.appendChild(errEl);
      setTimeout(() => HUD.hide(), 5000);
    },

    hide() {
      hud.classList.remove('visible', 'done');
      setTimeout(() => hud.classList.add('hidden'), 300);
      steps = [];
      onCancelCallback = null;
    }
  };

  function renderSteps() {
    if (!hudSteps) return;
    hudSteps.innerHTML = '';
    steps.forEach(s => renderStep(s));
  }

  function renderStep(step) {
    if (!hudSteps) return;
    // Check if step el exists
    let el = hudSteps.querySelector(`[data-step-id="${step.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'hud-step';
      el.dataset.stepId = step.id;
      hudSteps.appendChild(el);
    }
    const icons = { running: '<span class="hud-spinner"></span>', done: '✓', error: '✕', skip: '→' };
    el.className = `hud-step ${step.status}`;
    el.innerHTML = `
      <span class="hud-step-icon ${step.status}">${icons[step.status] || '•'}</span>
      <span class="hud-step-text">${step.text}</span>
    `;
    // Scroll to bottom
    hudSteps.scrollTop = hudSteps.scrollHeight;
  }

  if (hudCancel) {
    hudCancel.addEventListener('click', () => {
      if (onCancelCallback) onCancelCallback();
      HUD.hide();
    });
  }

  if (hudMinimize) {
    hudMinimize.addEventListener('click', () => {
      isMinimized = !isMinimized;
      hud.classList.toggle('minimized', isMinimized);
      hudMinimize.textContent = isMinimized ? '▲' : '▼';
    });
  }
})();
