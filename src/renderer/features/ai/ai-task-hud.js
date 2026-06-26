// ============================================================
// AI Task HUD — DevilBrowser
// Controls the native standalone floating child window HUD via IPC
// Sprint 1 — DevilBrowser Advanced AI Features
// ============================================================
(function () {
  'use strict';

  let onCancelCallback = null;

  const HUD = window.aiTaskHUD = {
    // Start a new task with a title
    start(title, onCancel) {
      onCancelCallback = onCancel || null;
      window.electronAPI.hudStateUpdate({
        type: 'start',
        title
      });
    },

    // Add a new step
    addStep(text, status = 'running') {
      const id = Date.now() + Math.random().toString(36).substr(2, 4);
      window.electronAPI.hudStateUpdate({
        type: 'addStep',
        id,
        text,
        status
      });
      return id;
    },

    // Update a step status: 'running' | 'done' | 'error' | 'skip'
    updateStep(id, status, newText) {
      window.electronAPI.hudStateUpdate({
        type: 'updateStep',
        id,
        status,
        newText
      });
    },

    // Complete the task
    done(summaryText) {
      window.electronAPI.hudStateUpdate({
        type: 'done',
        summaryText
      });
      setTimeout(() => HUD.hide(), 4000);
    },

    // Error state
    error(message) {
      window.electronAPI.hudStateUpdate({
        type: 'error',
        message
      });
      setTimeout(() => HUD.hide(), 5000);
    },

    // Hide HUD window
    hide() {
      window.electronAPI.hudStateUpdate({
        type: 'hide'
      });
      onCancelCallback = null;
    }
  };

  // Listen for native HUD cancel click forwarding
  window.electronAPI.on('hud-cancel-triggered', () => {
    if (onCancelCallback) {
      onCancelCallback();
    }
    HUD.hide();
  });
})();
