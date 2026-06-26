// ============================================================
// AI Support Tickets Script — DevilBrowser
// ============================================================
(function() {
  'use strict';

  const ticketSubject       = document.getElementById('ticket-subject');
  const ticketDesc          = document.getElementById('ticket-desc');
  const ticketPriority      = document.getElementById('ticket-priority');
  const ticketScreenshot    = document.getElementById('ticket-attach-screenshot');
  const btnSubmitTicket     = document.getElementById('btn-submit-ticket');
  const ticketStatusMsg     = document.getElementById('ticket-status-msg');
  const ticketsList         = document.getElementById('tickets-list');
  const btnSettings         = document.getElementById('btn-settings');
  const settingsPanel       = document.getElementById('settings-panel');

  // Load tickets on start and when settings panel opens
  if (btnSettings && settingsPanel) {
    btnSettings.addEventListener('click', () => {
      setTimeout(() => {
        if (!settingsPanel.classList.contains('hidden')) {
          loadTickets();
        }
      }, 100);
    });
  }

  // Handle ticket submission
  if (btnSubmitTicket) {
    btnSubmitTicket.addEventListener('click', async () => {
      const subject = ticketSubject ? ticketSubject.value.trim() : '';
      const description = ticketDesc ? ticketDesc.value.trim() : '';
      const priority = ticketPriority ? ticketPriority.value : 'medium';
      const attachScreenshot = ticketScreenshot ? ticketScreenshot.checked : false;

      if (!subject || subject.length < 3) {
        setStatus('Subject must be at least 3 characters.', 'error');
        return;
      }
      if (!description || description.length < 10) {
        setStatus('Description must be at least 10 characters.', 'error');
        return;
      }

      btnSubmitTicket.disabled = true;
      btnSubmitTicket.textContent = 'Submitting ticket...';
      setStatus('Processing ticket...', 'info');

      try {
        const token = await window.electronAPI.aiGetToken();
        if (!token) {
          setStatus('You must be signed in to submit tickets.', 'error');
          btnSubmitTicket.disabled = false;
          btnSubmitTicket.textContent = 'Submit Support Ticket';
          return;
        }

        let screenshotBase64 = null;
        if (attachScreenshot) {
          setStatus('Capturing active tab screenshot...', 'info');
          const screenshotRes = await window.electronAPI.aiGetPageScreenshot();
          if (screenshotRes && screenshotRes.success) {
            screenshotBase64 = screenshotRes.base64Data;
          } else {
            console.warn('Screenshot capture failed:', screenshotRes ? screenshotRes.error : 'Unknown error');
          }
        }

        setStatus('Submitting to server...', 'info');
        const res = await window.electronAPI.aiSubmitTicket({
          subject,
          description,
          priority,
          screenshotBase64
        });

        if (res && (res.id || !res.error)) {
          setStatus('Ticket submitted successfully!', 'success');
          // Clear inputs
          if (ticketSubject) ticketSubject.value = '';
          if (ticketDesc) ticketDesc.value = '';
          // Reload list
          loadTickets();
        } else {
          setStatus('Failed to submit ticket: ' + (res ? res.error || 'Server error' : 'Unknown error'), 'error');
        }
      } catch (err) {
        setStatus('Error submitting ticket: ' + err.message, 'error');
      } finally {
        btnSubmitTicket.disabled = false;
        btnSubmitTicket.textContent = 'Submit Support Ticket';
      }
    });
  }

  async function loadTickets() {
    if (!ticketsList) return;

    try {
      const token = await window.electronAPI.aiGetToken();
      if (!token) {
        ticketsList.innerHTML = '<div class="no-tickets" style="font-size: 11px; color: var(--text-faint); font-style: italic; padding: 4px;">Sign in to view submitted tickets.</div>';
        return;
      }

      const res = await window.electronAPI.aiGetTickets();
      if (!res || !res.tickets || res.tickets.length === 0) {
        ticketsList.innerHTML = '<div class="no-tickets" style="font-size: 11px; color: var(--text-faint); font-style: italic; padding: 4px;">No tickets submitted yet.</div>';
        return;
      }

      ticketsList.innerHTML = '';
      res.tickets.forEach(ticket => {
        const ticketCard = document.createElement('div');
        ticketCard.className = 'ticket-card';
        ticketCard.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px; padding: 8px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 4px; font-size: 11px;';

        const date = new Date(ticket.created_at).toLocaleDateString([], { dateStyle: 'short' });
        
        let priorityColor = 'var(--text-muted)';
        if (ticket.priority === 'high') priorityColor = 'var(--accent-bright)';
        else if (ticket.priority === 'medium') priorityColor = 'var(--amber, #f59e0b)';

        let statusColor = 'var(--text-secondary)';
        if (ticket.status === 'resolved' || ticket.status === 'closed') statusColor = 'var(--accent-green, #10b981)';
        else if (ticket.status === 'in_progress') statusColor = 'var(--accent-blue, #3b82f6)';

        ticketCard.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
            <strong style="color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;" title="${ticket.subject}">${ticket.subject}</strong>
            <span style="font-size: 9px; color: var(--text-faint); font-family: var(--font-mono);">${date}</span>
          </div>
          <p style="color: var(--text-secondary); margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3;" title="${ticket.description}">${ticket.description}</p>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 9px;">
            <span style="color: ${priorityColor}; font-weight: 600; text-transform: uppercase;">${ticket.priority}</span>
            <span style="color: ${statusColor}; font-weight: 600; text-transform: uppercase; background: rgba(255,255,255,0.03); padding: 1px 4px; border-radius: 3px; border: 1px solid var(--border);">${ticket.status.replace('_', ' ')}</span>
          </div>
        `;

        if (ticket.admin_response) {
          const respDiv = document.createElement('div');
          respDiv.style.cssText = 'margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--border); color: var(--accent-bright); font-style: italic;';
          respDiv.innerHTML = `<strong>Admin:</strong> ${ticket.admin_response}`;
          ticketCard.appendChild(respDiv);
        }

        ticketsList.appendChild(ticketCard);
      });
    } catch (err) {
      ticketsList.innerHTML = `<div class="no-tickets" style="font-size: 11px; color: var(--accent-bright); padding: 4px;">⚠️ Error loading tickets: ${err.message}</div>`;
    }
  }

  function setStatus(msg, type) {
    if (!ticketStatusMsg) return;
    ticketStatusMsg.textContent = msg;
    if (type === 'error') {
      ticketStatusMsg.style.color = '#ef4444';
    } else if (type === 'success') {
      ticketStatusMsg.style.color = '#10b981';
    } else if (type === 'info') {
      ticketStatusMsg.style.color = '#3b82f6';
    } else {
      ticketStatusMsg.style.color = 'var(--text-muted)';
    }
  }

})();
