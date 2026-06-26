(function() {
  'use strict';

  const container = document.getElementById('hud-container');
  const titleEl = document.getElementById('hud-title');
  const stepsEl = document.getElementById('hud-steps');
  const btnMinimize = document.getElementById('hud-minimize');
  const btnCancel = document.getElementById('hud-cancel');

  let steps = [];
  let isMinimized = false;

  // Listen for data from Main Process
  window.electronAPI.on('hud-data', (data) => {
    if (!data) return;

    switch (data.type) {
      case 'start':
        steps = [];
        isMinimized = false;
        if (container) {
          container.className = 'hud-container';
        }
        if (titleEl) titleEl.textContent = data.title || 'AI Agent Running...';
        if (stepsEl) stepsEl.innerHTML = '';
        break;

      case 'addStep':
        const newStep = { id: data.id, text: data.text, status: data.status || 'running' };
        steps.push(newStep);
        renderStep(newStep);
        break;

      case 'updateStep':
        const step = steps.find(s => s.id === data.id);
        if (step) {
          step.status = data.status;
          if (data.newText) step.text = data.newText;
          renderSteps();
        }
        break;

      case 'done':
        if (container) container.classList.add('done');
        const doneEl = document.createElement('div');
        doneEl.className = 'hud-done-line';
        doneEl.innerHTML = `<span class="hud-step-icon done">✓</span><span>${data.summaryText || 'Task completed'}</span>`;
        if (stepsEl) {
          stepsEl.appendChild(doneEl);
          stepsEl.scrollTop = stepsEl.scrollHeight;
        }
        break;

      case 'error':
        if (container) container.classList.add('error');
        const errEl = document.createElement('div');
        errEl.className = 'hud-error-line';
        errEl.innerHTML = `<span class="hud-step-icon error">✕</span><span>${data.message || 'Task failed'}</span>`;
        if (stepsEl) {
          stepsEl.appendChild(errEl);
          stepsEl.scrollTop = stepsEl.scrollHeight;
        }
        break;
    }
  });

  function renderSteps() {
    if (!stepsEl) return;
    stepsEl.innerHTML = '';
    steps.forEach(s => renderStep(s));
  }

  function renderStep(step) {
    if (!stepsEl) return;

    let el = stepsEl.querySelector(`[data-step-id="${step.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'hud-step';
      el.dataset.stepId = step.id;
      stepsEl.appendChild(el);
    }

    const icons = { 
      running: '<span class="hud-step-icon running"></span>', 
      done: '<span class="hud-step-icon done">✓</span>', 
      error: '<span class="hud-step-icon error">✕</span>', 
      skip: '<span class="hud-step-icon skip">→</span>' 
    };

    el.className = `hud-step ${step.status}`;
    el.innerHTML = `
      ${icons[step.status] || '<span class="hud-step-icon">•</span>'}
      <span class="hud-step-text">${step.text}</span>
    `;

    stepsEl.scrollTop = stepsEl.scrollHeight;
  }

  // Click handler for Cancel
  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      window.electronAPI.hudCancelClicked();
    });
  }

  // Click handler for Minimize
  if (btnMinimize) {
    btnMinimize.addEventListener('click', () => {
      isMinimized = !isMinimized;
      if (container) {
        container.classList.toggle('minimized', isMinimized);
      }
      btnMinimize.textContent = isMinimized ? '▲' : '▼';
      
      // Notify main process to resize window bounds if minimized/restored
      // Minimized size is 320x42, Restored is 320x180
      const width = 320;
      const height = isMinimized ? 42 : 180;
      // We can directly call a custom resize helper if we want, or just let bounds be.
      // Actually, Electron will cut off the height which is what we want!
      // Let's implement it inside main.js via IPC if needed, but since container overflows: hidden,
      // changing the height of container is enough if the window size remains 180, it will just show transparent background below it.
      // So no native resize is strictly necessary! The transparent background makes it look perfectly minimized.
    });
  }
})();
