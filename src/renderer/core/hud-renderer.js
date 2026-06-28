(function() {
  'use strict';

  const container = document.getElementById('hud-container');
  const titleEl = document.getElementById('hud-title');
  const stepsEl = document.getElementById('hud-steps');
  const btnMinimize = document.getElementById('hud-minimize');
  const btnPause = document.getElementById('hud-pause');
  const btnCancel = document.getElementById('hud-cancel');
  const interactiveEl = document.getElementById('hud-interactive');

  let steps = [];
  let isMinimized = false;
  let isPaused = false;

  // Listen for data from Main Process
  window.electronAPI.on('hud-data', (data) => {
    if (!data) return;

    switch (data.type) {
      case 'start':
        steps = [];
        isMinimized = false;
        isPaused = false;
        if (container) {
          container.className = 'hud-container';
        }
        if (titleEl) titleEl.textContent = data.title || 'AI Agent Running...';
        if (stepsEl) stepsEl.innerHTML = '';
        if (btnPause) {
          btnPause.innerHTML = '⏸';
          btnPause.title = 'Pause Task';
          btnPause.classList.remove('paused');
        }
        if (interactiveEl) {
          interactiveEl.style.display = 'none';
          interactiveEl.innerHTML = '';
        }
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

      case 'request-input':
        if (isMinimized) {
          isMinimized = false;
          if (container) {
            container.classList.remove('minimized');
          }
          if (btnMinimize) {
            btnMinimize.textContent = '▼';
          }
        }
        renderInputRequest(data.prompt, data.options);
        break;

      case 'clear-request-input':
        clearInputRequest();
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
        clearInputRequest();
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
        clearInputRequest();
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

  function renderInputRequest(prompt, options) {
    if (!interactiveEl) return;
    interactiveEl.innerHTML = '';
    interactiveEl.style.display = 'flex';

    const promptDiv = document.createElement('div');
    promptDiv.className = 'hud-interactive-prompt';
    promptDiv.textContent = prompt;
    interactiveEl.appendChild(promptDiv);

    if (options && options.length > 0) {
      const optionsDiv = document.createElement('div');
      optionsDiv.className = 'hud-interactive-options';
      options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'hud-interactive-opt-btn';
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          window.electronAPI.sendHudResponse(opt);
          clearInputRequest();
        });
        optionsDiv.appendChild(btn);
      });
      interactiveEl.appendChild(optionsDiv);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'hud-interactive-input-wrap';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'hud-interactive-input';
      input.placeholder = 'Type your answer...';

      const submit = document.createElement('button');
      submit.className = 'hud-interactive-submit';
      submit.textContent = 'Send';

      const send = () => {
        const val = input.value.trim();
        if (val) {
          window.electronAPI.sendHudResponse(val);
          clearInputRequest();
        }
      };

      submit.addEventListener('click', send);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          send();
        }
      });

      wrap.appendChild(input);
      wrap.appendChild(submit);
      interactiveEl.appendChild(wrap);

      // Focus the input field automatically
      setTimeout(() => input.focus(), 200);
    }

    if (stepsEl) {
      stepsEl.scrollTop = stepsEl.scrollHeight;
    }
  }

  function clearInputRequest() {
    if (interactiveEl) {
      interactiveEl.style.display = 'none';
      interactiveEl.innerHTML = '';
    }
  }

  // Click handler for Pause
  if (btnPause) {
    btnPause.addEventListener('click', () => {
      isPaused = !isPaused;
      if (isPaused) {
        btnPause.innerHTML = '▶';
        btnPause.title = 'Resume Task';
        btnPause.classList.add('paused');
        window.electronAPI.hudPauseClicked();
      } else {
        btnPause.innerHTML = '⏸';
        btnPause.title = 'Pause Task';
        btnPause.classList.remove('paused');
        window.electronAPI.hudResumeClicked();
      }
    });
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
    });
  }
})();
