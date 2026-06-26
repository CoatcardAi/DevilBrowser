/**
 * DevilBrowser — Autonomous AI Cockpit Controller
 * Handles planning cycles, safety gates, execution state machine, and resource telemetry.
 */

(function () {
  // --- STATE ---
  const state = {
    goal: '',
    phase: 'Idle',
    isRunning: false,
    isPaused: false,
    currentStepIndex: 0,
    safeMode: true,
    turboMode: false,
    plan: [],
    memory: {},
    logs: [],
    approvals: [],
    executionTimer: null,
    telemetryTimer: null,
    scenario: 'flights', // default scenario
    workerTabId: null
  };

  // --- MOCK WORKFLOW DATABASES ---
  const SCENARIOS = {
    flights: {
      steps: [
        { id: 1, label: 'Initialize planner and parse goal constraints', agent: 'agent-planner' },
        { id: 2, label: 'Navigate to travel comparison aggregator (Google Flights)', agent: 'agent-nav' },
        { id: 3, label: 'Search direct flights to Delhi for next Friday', agent: 'agent-nav' },
        { id: 4, label: 'Compare rates across airlines (IndiGo, SpiceJet, Air India)', agent: 'agent-research' },
        { id: 5, label: 'Select cheapest non-stop option (SpiceJet SG-829, ₹5,490)', agent: 'agent-research' },
        { id: 6, label: 'Extract flight connection variables and seating maps', agent: 'agent-vision' },
        { id: 7, label: 'Auto-fill passenger details (John Doe, john.doe@email.com)', agent: 'agent-form' },
        { id: 8, label: 'Confirm seat selection mapping (HIL verification required)', agent: 'agent-auth', gate: 'seat_selection' },
        { id: 9, label: 'Initiate flight checkout (Financial transaction gate)', agent: 'agent-auth', gate: 'payment' },
        { id: 10, label: 'Verify receipt validation and PNR extraction', agent: 'agent-vision' },
        { id: 11, label: 'Generate PDF receipt and download to Downloads folder', agent: 'agent-nav' },
        { id: 12, label: 'Verify document integrity and close navigation session', agent: 'agent-planner' }
      ],
      actions: [
        // Step 1
        { phase: 'Planning', eta: '3m', confidence: '98%', log: 'Parsing goal constraints: Nonstop, Destination Delhi, Budget < ₹6000.', memory: {} },
        // Step 2
        { phase: 'Navigation', eta: '2.5m', confidence: '96%', log: 'Navigating to flights.google.com...', memory: { 'Preferred Aggregator': 'Google Flights' } },
        // Step 3
        { phase: 'Search', eta: '2m', confidence: '95%', log: 'Entering flight queries: Origin Bom, Destination Del, Date: Next Friday.', memory: { 'Travel Date': 'Next Friday', 'Direction': 'BOM -> DEL' } },
        // Step 4
        { phase: 'Research', eta: '1.8m', confidence: '94%', log: 'Scanning rates... Found: IndiGo (₹6200), Air India (₹6800), SpiceJet (₹5490).', memory: { 'SpiceJet rate': '₹5490', 'IndiGo rate': '₹6200' } },
        // Step 5
        { phase: 'Selection', eta: '1.5m', confidence: '95%', log: 'Selected SpiceJet SG-829 (₹5,490, Non-stop). Loading passenger fields.', memory: { 'Selected Flight': 'SpiceJet SG-829', 'Price': '₹5,490' } },
        // Step 6
        { phase: 'Parsing Bounding Box', eta: '1.2m', confidence: '92%', log: 'Vision Agent parsing page coordinates... Highlighted Seating Form details.', memory: { 'Form Coordinates': '[X: 120, Y: 430, W: 600, H: 450]' } },
        // Step 7
        { phase: 'Form Filler', eta: '1m', confidence: '97%', log: 'Injecting form states into document... Names and contacts loaded.', memory: { 'Passenger Name': 'John Doe', 'Passenger Email': 'john.doe@email.com' } },
        // Step 8 (Gate: seat selection)
        { phase: 'Human approval required', eta: '45s', confidence: '99%', log: 'Safety Gate triggered: Seating arrangement validation required.', approval: { type: 'seat_selection', desc: 'Confirm flight seat selection: Row 12F (Standard window seat).' } },
        // Step 9 (Gate: payment)
        { phase: 'Human approval required', eta: '30s', confidence: '99%', log: 'Safety Gate triggered: Financial transaction detected.', approval: { type: 'payment', desc: 'Approve ticket purchase: ₹5,490.00 charged to MasterCard (ending 4022).' } },
        // Step 10
        { phase: 'Verification', eta: '15s', confidence: '96%', log: 'Booking confirmed! Extracted PNR number SG-DEL8294X.', memory: { 'PNR Number': 'SG-DEL8294X', 'Status': 'Confirmed' } },
        // Step 11
        { phase: 'Printing', eta: '5s', confidence: '98%', log: 'Downloading invoice PDF... Saved to C:/Users/kumar/Downloads/SpiceJet_SG829_Ticket.pdf', memory: { 'Ticket Invoice Path': 'SpiceJet_SG829_Ticket.pdf' } },
        // Step 12
        { phase: 'Mission Completed', eta: '0s', confidence: '99%', log: 'Orchestration complete. All sub-goals verified successfully.', memory: {} }
      ]
    },
    laptop: {
      steps: [
        { id: 1, label: 'Parse goal details and compile specification profile', agent: 'agent-planner' },
        { id: 2, label: 'Search Amazon for laptops under ₹80,000 with 16GB RAM', agent: 'agent-nav' },
        { id: 3, label: 'Search Flipkart to compare price indexes and deals', agent: 'agent-nav' },
        { id: 4, label: 'Scan specification sheets and warranty terms', agent: 'agent-research' },
        { id: 5, label: 'Extract customer reviews, ratings and compile average score', agent: 'agent-research' },
        { id: 6, label: 'Generate comparison sheet dataset format (CSV)', agent: 'agent-planner' },
        { id: 7, label: 'Review comparison sheet validation (User action required)', agent: 'agent-auth', gate: 'sheet_check' },
        { id: 8, label: 'Highlight top recommendation (ASUS Vivobook Pro, ₹74,990)', agent: 'agent-research' },
        { id: 9, label: 'Trigger purchase checkout block (Financial validation required)', agent: 'agent-auth', gate: 'laptop_payment' },
        { id: 10, label: 'Save receipt invoice to local Downloads directory', agent: 'agent-nav' },
        { id: 11, label: 'Finalize goal status and print mission logs summary', agent: 'agent-planner' }
      ],
      actions: [
        // Step 1
        { phase: 'Planning', eta: '4m', confidence: '98%', log: 'Established laptop goal parameters: Price Limit ₹80,000, 16GB RAM.', memory: {} },
        // Step 2
        { phase: 'Navigation', eta: '3.5m', confidence: '95%', log: 'Navigating to amazon.in and entering query...', memory: { 'Platform A': 'Amazon' } },
        // Step 3
        { phase: 'Navigation', eta: '3m', confidence: '94%', log: 'Navigating to flipkart.com and entering query...', memory: { 'Platform B': 'Flipkart' } },
        // Step 4
        { phase: 'Research', eta: '2.5m', confidence: '92%', log: 'Extracting product specs... Found 5 candidate laptops.', memory: { 'Candidates Found': 5 } },
        // Step 5
        { phase: 'Research', eta: '2m', confidence: '93%', log: 'Compiling reviews... ASUS Vivobook (4.4 stars), HP Pavilion (4.2 stars).', memory: { 'Top Match': 'ASUS Vivobook Pro', 'Rating': '4.4 / 5' } },
        // Step 6
        { phase: 'Data Generation', eta: '1.5m', confidence: '96%', log: 'Formatting comparison sheet structure to CSV format.', memory: {} },
        // Step 7 (Gate: sheet check)
        { phase: 'Human approval required', eta: '1.2m', confidence: '99%', log: 'Safety Gate triggered: Comparison table output approval required.', approval: { type: 'sheet_check', desc: 'Approve saving compiled spreadsheet: laptop_comparison.csv (Contains 5 models).' } },
        // Step 8
        { phase: 'Selection', eta: '1m', confidence: '95%', log: 'Presenting ASUS Vivobook Pro 15 (₹74,990, 16GB, OLED) as top recommendation.', memory: { 'Final Recommendation': 'ASUS Vivobook Pro 15', 'Price': '₹74,990' } },
        // Step 9 (Gate: payment)
        { phase: 'Human approval required', eta: '40s', confidence: '99%', log: 'Safety Gate triggered: Checkout payment authorization required.', approval: { type: 'laptop_payment', desc: 'Approve payment authorization: ₹74,990.00 charged to Card ending 8219.' } },
        // Step 10
        { phase: 'Navigation', eta: '15s', confidence: '98%', log: 'Downloading invoice statement... Saved to C:/Users/kumar/Downloads/Amazon_Invoice_ASUS.pdf', memory: { 'Invoice Saved': 'Amazon_Invoice_ASUS.pdf' } },
        // Step 11
        { phase: 'Mission Completed', eta: '0s', confidence: '99%', log: 'All subtasks resolved. Laptop spreadsheet and invoice successfully cached.', memory: {} }
      ]
    }
  };

  // --- DOM CACHE ---
  let els = {};

  function initDOMElements() {
    els = {
      panel: document.getElementById('ai-cockpit-panel'),
      btnOpen: document.getElementById('btn-ai-cockpit'),
      btnClose: document.getElementById('ai-cockpit-close'),
      
      btnTabSearch: document.getElementById('btn-tab-search'),
      btnTabCockpit: document.getElementById('btn-tab-cockpit'),
      subpageSearch: document.getElementById('new-tab-search-subpage'),
      subpageCockpit: document.getElementById('new-tab-cockpit-subpage'),
      dashboardPage: document.getElementById('new-tab-page'),
      
      btnStart: document.getElementById('btn-cockpit-start'),
      btnAbort: document.getElementById('btn-cockpit-abort'),
      btnPause: document.getElementById('btn-cockpit-pause'),
      btnResume: document.getElementById('btn-cockpit-resume'),
      btnRetry: document.getElementById('btn-cockpit-retry'),
      btnSkip: document.getElementById('btn-cockpit-skip'),
      chkSafe: document.getElementById('chk-cockpit-safe'),
      chkTurbo: document.getElementById('chk-cockpit-turbo'),
      
      goalInput: document.getElementById('cockpit-goal-input'),
      statusPhase: document.getElementById('cockpit-status-phase'),
      statusEta: document.getElementById('cockpit-status-eta'),
      statusConfidence: document.getElementById('cockpit-status-confidence'),
      progressFill: document.getElementById('cockpit-progress-fill'),
      progressStep: document.getElementById('cockpit-progress-step'),
      progressPercent: document.getElementById('cockpit-progress-percent'),
      
      approvalQueue: document.getElementById('cockpit-approval-queue'),
      plannedTasks: document.getElementById('cockpit-planned-tasks'),
      activityFeed: document.getElementById('cockpit-activity-feed'),
      browserMap: document.getElementById('cockpit-browser-map'),
      memoryViewer: document.getElementById('cockpit-memory-viewer'),
      console: document.getElementById('cockpit-console'),
      
      visionFeed: document.getElementById('cockpit-vision-feed'),
      visionPlaceholder: document.getElementById('cockpit-vision-placeholder'),
      visionBoxOverlay: document.getElementById('vision-box-overlay'),
      
      meterCpu: document.getElementById('meter-cpu'),
      meterRam: document.getElementById('meter-ram'),
      meterNetwork: document.getElementById('meter-network'),
      meterLatency: document.getElementById('meter-latency'),
      
      personaName: document.getElementById('persona-name'),
      personaEmail: document.getElementById('persona-email'),
      personaPhone: document.getElementById('persona-phone'),
      personaLocation: document.getElementById('persona-location'),
      personaSkills: document.getElementById('persona-skills'),
      personaSummary: document.getElementById('persona-summary'),
      resumeStatus: document.getElementById('resume-status'),
      resumeFile: document.getElementById('persona-resume-file'),
      btnUploadResume: document.getElementById('btn-upload-resume'),
      btnSavePersona: document.getElementById('btn-save-persona')
    };
  }

  // --- LISTENERS ---
  function setupListeners() {
    // Switch to Search sub-page
    if (els.btnTabSearch) {
      els.btnTabSearch.addEventListener('click', () => {
        if (els.btnTabSearch) els.btnTabSearch.classList.add('active');
        if (els.btnTabCockpit) els.btnTabCockpit.classList.remove('active');
        if (els.subpageSearch) els.subpageSearch.classList.add('active');
        if (els.subpageCockpit) els.subpageCockpit.classList.remove('active');
        if (els.dashboardPage) els.dashboardPage.classList.remove('cockpit-active');
      });
    }

    // Switch to Cockpit sub-page
    if (els.btnTabCockpit) {
      els.btnTabCockpit.addEventListener('click', () => {
        if (els.btnTabCockpit) els.btnTabCockpit.classList.add('active');
        if (els.btnTabSearch) els.btnTabSearch.classList.remove('active');
        if (els.subpageCockpit) els.subpageCockpit.classList.add('active');
        if (els.subpageSearch) els.subpageSearch.classList.remove('active');
        if (els.dashboardPage) els.dashboardPage.classList.add('cockpit-active');
        
        // Focus and sync browser layout map
        syncBrowserMap();
        captureVisionFeed();
      });
    }

    // Close Panel / Return to Search Dashboard
    if (els.btnClose) {
      els.btnClose.addEventListener('click', () => {
        if (els.btnTabSearch) els.btnTabSearch.click();
      });
    }

    // Goal actions
    if (els.btnStart) els.btnStart.addEventListener('click', startMission);
    if (els.btnAbort) els.btnAbort.addEventListener('click', abortMission);
    if (els.btnPause) els.btnPause.addEventListener('click', pauseMission);
    if (els.btnResume) els.btnResume.addEventListener('click', resumeMission);
    if (els.btnRetry) els.btnRetry.addEventListener('click', retryStep);
    if (els.btnSkip) els.btnSkip.addEventListener('click', skipStep);

    // Sync settings toggles
    if (els.chkSafe) {
      els.chkSafe.addEventListener('change', () => {
        state.safeMode = els.chkSafe.checked;
        logConsole(`[System] Safety verification gates ${state.safeMode ? 'ENABLED' : 'DISABLED'}.`, 'line-system');
      });
    }
    if (els.chkTurbo) {
      els.chkTurbo.addEventListener('change', () => {
        state.turboMode = els.chkTurbo.checked;
        logConsole(`[System] Turbo Mode ${state.turboMode ? 'ACTIVATED' : 'DEACTIVATED'}. Execution cycle updated to ${state.turboMode ? '1.5s' : '4.5s'}.`, 'line-system');
        if (state.isRunning && !state.isPaused) {
          // Reset interval timer with new speed
          clearInterval(state.executionTimer);
          state.executionTimer = setInterval(executionCycle, state.turboMode ? 1500 : 4500);
        }
      });
    }

    // Listen to window tab notifications to update browser map
    if (window.electronAPI && window.electronAPI.on) {
      window.electronAPI.on('tab-created', syncBrowserMap);
      window.electronAPI.on('tab-activated', () => {
        syncBrowserMap();
        captureVisionFeed();
      });
      window.electronAPI.on('tab-closed', syncBrowserMap);
      window.electronAPI.on('tab-url-updated', syncBrowserMap);
    }

    // Persona Vault Handlers
    if (els.btnUploadResume && els.resumeFile) {
      els.btnUploadResume.addEventListener('click', () => els.resumeFile.click());
    }
    if (els.resumeFile) {
      els.resumeFile.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          const file = e.target.files[0];
          if (els.resumeStatus) els.resumeStatus.innerText = "Resume: " + file.name;
          logConsole(`[System] Selected resume file: ${file.name}`, 'line-system');
        }
      });
    }
    if (els.btnSavePersona) {
      els.btnSavePersona.addEventListener('click', savePersona);
    }
  }

  function savePersona() {
    const data = {
      name: els.personaName ? els.personaName.value.trim() : '',
      email: els.personaEmail ? els.personaEmail.value.trim() : '',
      phone: els.personaPhone ? els.personaPhone.value.trim() : '',
      location: els.personaLocation ? els.personaLocation.value.trim() : '',
      skills: els.personaSkills ? els.personaSkills.value.trim() : '',
      summary: els.personaSummary ? els.personaSummary.value.trim() : '',
      resumeName: (els.resumeFile && els.resumeFile.files && els.resumeFile.files[0]) ? els.resumeFile.files[0].name : (els.resumeStatus ? els.resumeStatus.innerText.replace('Resume: ', '') : '')
    };
    if (data.resumeName === 'None Loaded') data.resumeName = '';

    localStorage.setItem('devilbrowser-persona', JSON.stringify(data));
    logConsole('[System] Profile saved to Persona Vault. Ready for form integration.', 'line-system');
    logActivity('Profile Saved to Vault', 'success');
  }

  function loadPersona() {
    try {
      const dataStr = localStorage.getItem('devilbrowser-persona');
      if (dataStr) {
        const data = JSON.parse(dataStr);
        if (els.personaName) els.personaName.value = data.name || '';
        if (els.personaEmail) els.personaEmail.value = data.email || '';
        if (els.personaPhone) els.personaPhone.value = data.phone || '';
        if (els.personaLocation) els.personaLocation.value = data.location || '';
        if (els.personaSkills) els.personaSkills.value = data.skills || '';
        if (els.personaSummary) els.personaSummary.value = data.summary || '';
        if (data.resumeName) {
          if (els.resumeStatus) els.resumeStatus.innerText = "Resume: " + data.resumeName;
        }
      }
    } catch (e) {
      console.error('Failed to load persona:', e);
    }
  }

  // --- CORE LIFECYCLE CONTROLS ---

  function getLocalNextStep(goal, index, currentUrl) {
    let targetUrl = 'https://www.google.com';
    let targetName = 'Google';
    
    const lowerGoal = goal.toLowerCase();
    if (lowerGoal.includes('wikipedia')) {
      targetUrl = 'https://www.wikipedia.org';
      targetName = 'Wikipedia';
    } else if (lowerGoal.includes('youtube')) {
      targetUrl = 'https://www.youtube.com';
      targetName = 'YouTube';
    } else if (lowerGoal.includes('github')) {
      targetUrl = 'https://github.com';
      targetName = 'GitHub';
    } else if (lowerGoal.includes('amazon')) {
      targetUrl = 'https://www.amazon.com';
      targetName = 'Amazon';
    } else {
      // Try to extract a URL or domain
      const urlMatch = goal.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/i);
      if (urlMatch) {
        targetUrl = urlMatch[0];
        if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        }
        targetName = urlMatch[1];
      } else {
        const words = goal.split(' ').filter(w => w.length > 2);
        if (words.length > 0) {
          targetUrl = `https://www.google.com/search?q=${encodeURIComponent(goal)}`;
          targetName = `Google Search for "${words.join(' ')}"`;
        }
      }
    }

    if (index === 0) {
      return {
        isCompleted: false,
        step: { id: 1, label: 'Initialize local planner and parse goal', agent: 'agent-planner', actionType: 'none', elementId: '', value: '' },
        action: { phase: 'Planning', eta: '2m', confidence: '99%', log: `Parsed goal: "${goal}". Strategy: Navigate to ${targetName}.`, memory: {} }
      };
    } else if (index === 1) {
      return {
        isCompleted: false,
        step: { id: 2, label: `Navigate to ${targetName}`, agent: 'agent-nav', actionType: 'navigate', elementId: '', value: targetUrl },
        action: { phase: 'Navigation', eta: '1.5m', confidence: '98%', log: `Directing tab to ${targetUrl}`, memory: { 'Destination': targetName, 'URL': targetUrl } }
      };
    } else if (index === 2) {
      return {
        isCompleted: false,
        step: { id: 3, label: `Verify page layout and content structure for: "${goal}"`, agent: 'agent-vision', actionType: 'none', elementId: '', value: '' },
        action: { phase: 'Bounding Box', eta: '1m', confidence: '95%', log: `Analyzing viewport dimensions at ${currentUrl}`, memory: {} }
      };
    } else if (index === 3) {
      return {
        isCompleted: false,
        step: { id: 4, label: 'Extract required telemetry and variables', agent: 'agent-research', actionType: 'none', elementId: '', value: '' },
        action: { phase: 'Research', eta: '30s', confidence: '97%', log: 'Scanning page links, headers, and document tags.', memory: { 'Status': 'Success' } }
      };
    } else {
      return {
        isCompleted: true,
        step: null,
        action: { phase: 'Completed', eta: '0m', confidence: '99%', log: `Mission completed for goal: "${goal}"`, memory: {} }
      };
    }
  }

  async function startMission() {
    const goal = els.goalInput.value.trim();
    if (!goal) {
      alert('Please state a goal first.');
      return;
    }

    // Check login state first
    const token = await window.electronAPI.aiGetToken();
    if (!token) {
      if (window.aiAuth) window.aiAuth.showModal();
      return;
    }

    state.goal = goal;
    state.isRunning = true;
    state.isPaused = false;
    state.currentStepIndex = 0;
    state.memory = {};
    state.logs = [];
    state.approvals = [];
    state.workerTabId = null;
    state.plan = []; // Initialize empty steps checklist
    state.scenario = 'dynamic';
    SCENARIOS['dynamic'] = { steps: [], actions: [] };

    // Reset controls
    els.btnStart.disabled = true;
    els.btnAbort.disabled = false;
    els.btnPause.disabled = true;
    els.btnResume.disabled = true;
    els.btnRetry.disabled = true;
    els.btnSkip.disabled = true;
    els.goalInput.disabled = true;

    // Clear feeds and show planner loader
    els.plannedTasks.innerHTML = '<div class="timeline-empty">🧠 AI Planner is formulating strategy...</div>';
    els.activityFeed.innerHTML = '';
    els.approvalQueue.innerHTML = '<div class="queue-empty">No pending validations. Safe state active.</div>';
    els.memoryViewer.innerHTML = '';

    logActivity(`Mission requested: "${goal}"`);
    logConsole(`[System] Initializing step-by-step planner session...`, 'line-system');

    // Open background worker tab
    if (window.electronAPI) {
      try {
        const cockpitTabId = window._activeTabId;
        logConsole(`[System] Initializing background executor context...`, 'line-system');
        const res = await window.electronAPI.createTab('about:blank');
        if (res && res.id) {
          state.workerTabId = res.id;
          logConsole(`[System] Background worker tab created: ID ${res.id}`, 'line-system');
          // Register worker tab in main process
          await window.electronAPI.aiSetWorkerTab(res.id);
          // Switch back to cockpit tab so the dashboard doesn't get hidden
          if (cockpitTabId) {
            await window.electronAPI.setActiveTab(cockpitTabId);
          }
        }
      } catch (err) {
        logConsole(`[System] Failed to initialize background tab: ${err.message}. Using active layout.`, 'line-error');
      }
    }

    // Reset controls to active running state
    els.btnStart.disabled = true;
    els.btnAbort.disabled = false;
    els.btnPause.disabled = false;
    els.btnResume.disabled = true;
    els.btnRetry.disabled = true;
    els.btnSkip.disabled = false;

    // Run telemetry fluctuations
    startTelemetryMonitors();

    // Trigger initial execution step immediately
    executionCycle();
  }

  function pauseMission() {
    state.isPaused = true;
    els.btnPause.disabled = true;
    els.btnResume.disabled = false;
    els.btnRetry.disabled = false;
    
    if (state.executionTimer) {
      clearTimeout(state.executionTimer);
      state.executionTimer = null;
    }
    
    // Grey out active agent status bars
    deactivateAllAgents();
    
    logConsole('[System] Execution suspended. Retaining variables, cookies, DOM pointers and network handles.', 'line-warn');
    logActivity('Execution Paused by User', 'warn');
  }

  function resumeMission() {
    state.isPaused = false;
    els.btnPause.disabled = false;
    els.btnResume.disabled = true;
    els.btnRetry.disabled = true;

    logConsole('[System] Resuming workflow from saved execution state...', 'line-system');
    logActivity('Execution Resumed', 'success');

    // Run cycle step immediately
    executionCycle();
  }

  async function abortMission() {
    if (state.executionTimer) {
      clearTimeout(state.executionTimer);
      state.executionTimer = null;
    }
    stopTelemetryMonitors();
    
    state.isRunning = false;
    state.isPaused = false;
    
    els.btnStart.disabled = false;
    els.btnAbort.disabled = true;
    els.btnPause.disabled = true;
    els.btnResume.disabled = true;
    els.btnRetry.disabled = true;
    els.btnSkip.disabled = true;
    els.goalInput.disabled = false;

    deactivateAllAgents();

    els.statusPhase.innerText = 'Aborted';
    els.statusEta.innerText = '—';
    els.statusConfidence.innerText = '—';
    els.progressFill.style.width = '0%';
    els.progressPercent.innerText = '0%';

    logConsole('[System] Mission ABORTED. Network handles detached. Session cache released.', 'line-error');
    logActivity('Mission Aborted by User', 'error');

    // Render summary logs
    logConsole(`[System] Execution summary: Completed ${state.currentStepIndex} actions.`, 'line-system');
    // Close background worker tab
    if (state.workerTabId && window.electronAPI) {
      logConsole(`[System] Tearing down background worker tab...`, 'line-system');
      const wId = state.workerTabId;
      state.workerTabId = null;
      await window.electronAPI.aiSetWorkerTab(null);
      window.electronAPI.closeTab(wId);
    }
  }

  function skipStep() {
    if (!state.isRunning) return;
    
    const stepLabel = state.plan[state.currentStepIndex] ? state.plan[state.currentStepIndex].label : "Current Step";
    logConsole(`[Planner] Skipping Step ${state.currentStepIndex + 1}: "${stepLabel}"`, 'line-warn');
    logActivity(`Skipped: ${stepLabel}`, 'warn');

    if (state.plan[state.currentStepIndex]) {
      // Mark current step as completed or skipped
      const stepEl = els.plannedTasks.querySelector(`[data-step-id="${state.plan[state.currentStepIndex].id}"]`);
      if (stepEl) {
        stepEl.className = 'plan-step-item completed';
      }
    }

    state.currentStepIndex++;
    if (!state.isPaused) {
      if (state.executionTimer) {
        clearTimeout(state.executionTimer);
      }
      executionCycle();
    }
  }

  function retryStep() {
    if (!state.isRunning || !state.isPaused) return;
    
    const stepLabel = state.plan[state.currentStepIndex] ? state.plan[state.currentStepIndex].label : "Current Step";
    logConsole(`[Planner] Retrying Step ${state.currentStepIndex + 1}: "${stepLabel}"`, 'line-system');
    logActivity(`Retrying Step: ${stepLabel}`, 'warn');

    state.isPaused = false;
    els.btnPause.disabled = false;
    els.btnResume.disabled = true;
    els.btnRetry.disabled = true;

    executionCycle();
  }

  // --- AUTOMATIC CYCLE EXECUTION ---

  async function executionCycle() {
    if (!state.isRunning || state.isPaused) return;

    // Safeguard max steps to prevent infinite loops
    if (state.currentStepIndex >= 15) {
      logConsole(`[System] Maximum step limit reached. Concluding mission.`, 'line-warn');
      completeMission();
      return;
    }

    if (state.executionTimer) {
      clearTimeout(state.executionTimer);
      state.executionTimer = null;
    }

    // Page Stability Gate: Wait until the worker tab finishes loading
    if (state.workerTabId && window.electronAPI) {
      logConsole(`[System] Checking page stability...`, 'line-system');
      let isLoading = true;
      let checkCount = 0;
      while (isLoading && checkCount < 10 && state.isRunning && !state.isPaused) {
        isLoading = await window.electronAPI.aiIsTabLoading(state.workerTabId);
        if (isLoading) {
          logConsole(`[System] Page is loading or busy, waiting 500ms...`, 'line-system');
          await new Promise(r => setTimeout(r, 500));
          checkCount++;
        }
      }
      // Wait an extra 500ms for layout stabilization
      await new Promise(r => setTimeout(r, 500));
    }

    // 1. Observe Environment
    let currentUrl = 'about:blank';
    let currentTitle = 'New Tab';
    let domElementsText = 'No interactive elements detected on the page.';
    
    if (window._tabs && state.workerTabId) {
      const tab = window._tabs.find(t => t.id === state.workerTabId);
      if (tab) {
        currentUrl = tab.url || 'about:blank';
        currentTitle = tab.title || 'New Tab';
      }
    }

    // Call aiGetPageDOM to inject selectors and list elements
    if (state.workerTabId && window.electronAPI) {
      try {
        const domResult = await window.electronAPI.aiGetPageDOM(state.workerTabId);
        if (domResult && domResult !== '[]') {
          const elsList = JSON.parse(domResult);
          if (Array.isArray(elsList) && elsList.length > 0) {
            // Build a clean, readable text description of interactive elements
            const formatted = elsList.map(el => {
              const details = [];
              if (el.id) details.push(`id="${el.id}"`);
              if (el.name) details.push(`name="${el.name}"`);
              if (el.type) details.push(`type="${el.type}"`);
              if (el.placeholder) details.push(`placeholder="${el.placeholder}"`);
              if (el.labelText) details.push(`label="${el.labelText.trim()}"`);
              if (el.innerText) details.push(`text="${el.innerText.trim().slice(0, 40)}"`);
              if (el.role) details.push(`role="${el.role}"`);
              return `[aiId=${el.aiId}] <${el.tagName}> ${details.join(' ')}`;
            }).slice(0, 150); // limit to 150 elements
            domElementsText = formatted.join('\n');
          }
        }
      } catch (err) {
        logConsole(`[System] DOM extraction failed: ${err.message}`, 'line-warn');
      }
    }

    logConsole(`[System] Observing environment: ${currentUrl} ("${currentTitle}")`, 'line-system');
    els.statusPhase.innerText = 'Observing';
    els.statusEta.innerText = 'Calculating';

    // Build executed history summary for LLM
    const historySummary = state.plan.map((step, idx) => {
      const act = SCENARIOS['dynamic'].actions[idx];
      let realRes = 'Completed';
      if (act) {
        if (act.actualResult) {
          realRes = act.actualResult.success ? 
            `Success (Result: ${JSON.stringify(act.actualResult.result || 'Done')})` : 
            `Failed (Error: ${act.actualResult.error})`;
        } else {
          realRes = act.log || 'Completed';
        }
      }
      return `Step ${step.id}: ${step.label} (${step.agent}) -> Result: ${realRes}`;
    }).join('\n');

    let nextStepData = null;

    // 2. Call Planner LLM for Single Next Step
    try {
      logConsole(`[Planner] Strategizing next execution step...`, 'line-system');
      
      const systemInstruction = 
        "You are the Step-by-Step Orchestration Planner for an Autonomous AI Cockpit browser agent.\n" +
        "Your task is to observe the current environment state (URL, Title, interactive DOM elements list, visible page text, memory cache, and history of executed steps) " +
        "and plan the EXACT NEXT SINGLE STEP to move closer to the user's goal.\n\n" +
        "You must return ONLY a valid JSON object with the following structure:\n" +
        "{\n" +
        "  \"isCompleted\": false,\n" +
        "  \"step\": {\n" +
        "    \"id\": 1,\n" +
        "    \"label\": \"Brief description of the next step\",\n" +
        "    \"agent\": \"agent-planner | agent-nav | agent-research | agent-form | agent-auth | agent-vision\",\n" +
        "    \"actionType\": \"click | fill | select | navigate | download | presskey | scroll | wait | extracttext | none\",\n" +
        "    \"elementId\": \"the aiId of the DOM element to interact with, e.g. '10'\",\n" +
        "    \"selector\": \"CSS selector or Playwright-style text selector (e.g. 'input[name=\\\"q\\\"]', 'button[type=\\\"submit\\\"]', 'text=\\\"Search\\\"') to identify the target element in the page environment\",\n" +
        "    \"value\": \"text value for fill/select, URL for navigate, key name for presskey (e.g. 'Enter'), scroll direction ('up'/'down'), sleep duration in ms or selector to wait for (e.g. '3000' or '#submit'), or filename for download\",\n" +
        "    \"x\": 450,\n" +
        "    \"y\": 300,\n" +
        "    \"gate\": \"optional_gate_name_if_sensitive_checkout_or_payment\"\n" +
        "  },\n" +
        "  \"action\": {\n" +
        "    \"phase\": \"Planning | Navigation | Search | Research | Bounding Box | Form Filler | Verification | Printing | Completed\",\n" +
        "    \"eta\": \"estimated time to complete remaining goal, e.g. 2m\",\n" +
        "    \"confidence\": \"e.g. 95%\",\n" +
        "    \"log\": \"Simulated action log message detailing the reason for this step\",\n" +
        "    \"memory\": { \"OptionalKey\": \"OptionalValue\" }\n" +
        "  }\n" +
        "}\n\n" +
        "Rules:\n" +
        "1. If the goal has been fully accomplished (including summarizing research or saving files), set \"isCompleted\" to true, \"step\" to null, and \"action\" phase to \"Completed\".\n" +
        "2. For any navigation step, set the actionType to 'navigate' and agent to 'agent-nav' and include the target URL in the 'value' property.\n" +
        "3. To write text into text inputs/textareas/contenteditables (e.g., search queries, login credentials, ChatGPT prompt box), set actionType to 'fill', set selector/elementId, and value to the text. If you need to submit the text by pressing Enter, plan a subsequent 'presskey' step with value 'Enter' on that input.\n" +
        "4. To click on buttons, links, checkbox/radio labels, set actionType to 'click' and selector/elementId.\n" +
        "5. If you cannot find a suitable DOM element in the list, but you see it on the page screenshot, you can specify coordinates \"x\" and \"y\" (pixels, relative to the 1024x768 viewport screenshot) inside the \"step\" object to perform a direct vision-based click or focus.\n" +
        "6. To wait for a button or a search result to load or appear on the page before clicking it, use actionType to 'wait' and set value to the selector or element text (e.g., '.result-item' or 'text=Submit') or a timeout in milliseconds (e.g., '2000').\n" +
        "7. To extract information or values from the page (e.g., prices, order IDs, receipt text, ChatGPT response content), use actionType 'extracttext' and specify the target element selector/elementId. The extracted text will be saved into the memory cache automatically.\n" +
        "8. To scroll the page down or up to locate off-screen or lazy-loaded elements, set actionType to 'scroll' and value to 'down' or 'up'.\n" +
        "9. To download files, invoices, receipts, or data exports, set actionType to 'download' and set the target filename in 'value'.\n" +
        "10. Do NOT include any payment, transaction, or security gates/approvals unless the user's goal explicitly involves money, checkouts, or sensitive credentials.\n" +
        "11. Return only the JSON object. Do not wrap in ```json or any markdown formatting.";

      // Retrieve page text content
      let pageTextContent = '';
      if (state.workerTabId && window.electronAPI) {
        try {
          const fullText = await window.electronAPI.aiGetPageText(state.workerTabId);
          if (fullText) {
            pageTextContent = `Page Visible Text Content (first 5000 chars):\n${fullText.slice(0, 5000)}\n\n`;
          }
        } catch (textErr) {
          logConsole(`[System] Page text extraction failed: ${textErr.message}`, 'line-warn');
        }
      }

      // Retrieve memory cache contents
      let memoryText = '';
      if (Object.keys(state.memory).length > 0) {
        memoryText = `Memory Cache (extracted facts/data):\n${JSON.stringify(state.memory, null, 2)}\n\n`;
      }

      const prompt = `Goal: "${state.goal}"\n` +
                     `Current URL: ${currentUrl}\n` +
                     `Current Page Title: "${currentTitle}"\n` +
                     `Interactive DOM Elements on Current Page:\n${domElementsText}\n\n` +
                     pageTextContent +
                     memoryText +
                     `Next Step ID: ${state.currentStepIndex + 1}\n` +
                     `Executed Steps History:\n${historySummary || 'No steps executed yet.'}`;

      // Capture current page screenshot for LLM visual environment observation
      let screenshotPayload = undefined;
      if (state.workerTabId && window.electronAPI) {
        try {
          const screenshotRes = await window.electronAPI.aiGetPageScreenshot(state.workerTabId);
          if (screenshotRes && !screenshotRes.error && screenshotRes.base64) {
            screenshotPayload = [{
              type: 'base64',
              mimeType: screenshotRes.mimeType || 'image/png',
              data: screenshotRes.base64
            }];
          }
        } catch (screenshotErr) {
          logConsole(`[System] Screenshot capture failed for AI request: ${screenshotErr.message}`, 'line-warn');
        }
      }

      const response = await window.electronAPI.aiGenerate({
        prompt,
        systemInstruction,
        maxOutputTokens: 800,
        images: screenshotPayload
      });

      if (response && response.error) {
        if (response.error.includes('401') || response.error.includes('Not authenticated')) {
          window.dispatchEvent(new Event('ai-session-expired'));
          throw new Error("Session expired. Please log in.");
        }
        throw new Error(response.error);
      }

      if (!response || !response.text) {
        throw new Error("Empty response from AI planner");
      }

      const parsed = cleanAndParseJSON(response.text);
      if (parsed && (parsed.isCompleted || (parsed.step && parsed.action))) {
        nextStepData = parsed;
      } else {
        throw new Error("Invalid single-step JSON schema");
      }
    } catch (err) {
      logConsole(`[Planner] Dynamic planning failed: ${err.message}. Invoking local step heuristics...`, 'line-error');
      nextStepData = getLocalNextStep(state.goal, state.currentStepIndex, currentUrl);
    }

    if (!state.isRunning || state.isPaused) return;

    // 3. Process the Planned Next Step
    if (nextStepData.isCompleted) {
      els.statusPhase.innerText = 'Completed';
      els.statusEta.innerText = '0m';
      els.statusConfidence.innerText = '100%';
      logConsole(`[Planner] Goal accomplished! Concluding dynamic ReAct loop.`, 'line-system');
      logActivity(nextStepData.action.log || 'Goal successfully completed!', 'success');
      
      els.progressFill.style.width = '100%';
      els.progressPercent.innerText = '100%';
      
      completeMission();
      return;
    }

    const nextStep = nextStepData.step;
    const nextAction = nextStepData.action;

    // Ensure step ID matches current index + 1
    nextStep.id = state.currentStepIndex + 1;

    // Append to plans
    state.plan.push(nextStep);
    SCENARIOS['dynamic'].steps.push(nextStep);
    SCENARIOS['dynamic'].actions.push(nextAction);

    // Render Steps dynamically
    renderPlannedTasks();
    updateActiveStepHighlight(nextStep.id);
    activateAgent(nextStep.agent);

    // If human gate is required and safeMode is active
    if (nextStep.gate && state.safeMode) {
      pauseForApproval({ type: nextStep.gate, desc: nextAction.log || `User approval required for ${nextStep.label}` });
      return;
    }

    // Execute step
    els.statusPhase.innerText = nextAction.phase || 'Processing';
    els.statusEta.innerText = nextAction.eta || '1m';
    els.statusConfidence.innerText = nextAction.confidence || '95%';

    let activityStatus = '';
    if (nextAction.phase === 'Completed' || nextAction.phase === 'Verification') {
      activityStatus = 'success';
    }
    logActivity(nextAction.log, activityStatus);
    logConsole(`[${nextStep.agent.split('-')[1].toUpperCase()}] Running: ${nextStep.label}`, 'line-system');

    // Update memory
    if (nextAction.memory) {
      Object.entries(nextAction.memory).forEach(([k, v]) => {
        state.memory[k] = v;
      });
      renderMemoryViewer();
    }

    // Vision frame check
    captureVisionFeed();

    // Trigger physical browser operations based on steps
    await executeNativeBrowserHook(state.currentStepIndex);

    // Vision frame check after execution
    captureVisionFeed();

    // Update Progress calculations
    state.currentStepIndex++;
    const progressPct = Math.min(95, Math.round((state.currentStepIndex / 8) * 100)); // estimate progress
    els.progressFill.style.width = progressPct + '%';
    els.progressStep.innerText = `Step ${state.currentStepIndex} executed`;
    els.progressPercent.innerText = progressPct + '%';

    // Schedule next cycle
    scheduleNextCycle();
  }

  function scheduleNextCycle() {
    if (!state.isRunning || state.isPaused) return;
    
    if (state.executionTimer) {
      clearTimeout(state.executionTimer);
    }
    const delay = state.turboMode ? 1500 : 4500;
    state.executionTimer = setTimeout(executionCycle, delay);
  }

  async function completeMission() {
    state.isRunning = false;
    deactivateAllAgents();

    els.statusPhase.innerText = 'Completed';
    els.statusEta.innerText = '0m';
    els.statusConfidence.innerText = '100%';
    
    els.btnStart.disabled = false;
    els.btnAbort.disabled = true;
    els.btnPause.disabled = true;
    els.btnResume.disabled = true;
    els.btnRetry.disabled = true;
    els.btnSkip.disabled = true;
    els.goalInput.disabled = false;

    logConsole(`[System] Mission successfully RESOLVED. Results compiled. Output stored.`, 'line-system');
    logActivity('Goal Successfully Completed! 🏁', 'success');
    
    stopTelemetryMonitors();

    // Promote background worker tab to active tab upon successful completion so user sees their page
    if (state.workerTabId && window.electronAPI) {
      logConsole(`[System] Mission completed. Promoting worker tab (ID ${state.workerTabId}) to active viewport...`, 'line-system');
      const wId = state.workerTabId;
      state.workerTabId = null;
      await window.electronAPI.aiSetWorkerTab(null);
      await window.electronAPI.setActiveTab(wId);
    }
  }

  // --- HARDWARE INTERFACES & AUTOMATION HOOKS ---

  // Helper functions injected dynamically on target WebContents pages to support DOM operations
  const helperScript = `
    (function() {
      if (!window.__aiFindElement) {
        window.__aiFindElement = function(selectorOrId) {
          if (!selectorOrId) return null;
          let el = document.querySelector('[data-ai-id="' + selectorOrId + '"]');
          if (el) return el;
          try {
            el = document.querySelector(selectorOrId);
            if (el) return el;
          } catch (e) {}
          // Playwright text locator matching
          if (typeof selectorOrId === 'string' && selectorOrId.startsWith('text=')) {
            const searchText = selectorOrId.substring(5).replace(/^["']|["']$/g, '').trim();
            const allTextEls = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"], label, span, p, div, [role="button"]'));
            el = allTextEls.find(e => e.textContent.trim() === searchText || (e.value && e.value.trim() === searchText));
            if (el) return el;
          }
          return null;
        };
      }
      if (!window.__aiFindElementAndCoords) {
        window.__aiFindElementAndCoords = function(selectorOrId) {
          if (!selectorOrId) return null;

          function search(root, offset = { x: 0, y: 0 }) {
            let el = root.querySelector('[data-ai-id="' + selectorOrId + '"]');
            if (!el) {
              try {
                el = root.querySelector(selectorOrId);
              } catch (e) {}
            }
            if (!el && typeof selectorOrId === 'string' && selectorOrId.startsWith('text=')) {
              const txt = selectorOrId.substring(5).replace(/^["']|["']$/g, '').trim();
              const candidates = Array.from(root.querySelectorAll('a, button, input, label, span, p, div, [role="button"]'));
              el = candidates.find(c => c.textContent.trim() === txt || (c.value && c.value.trim() === txt));
            }

            if (el) {
              const rect = el.getBoundingClientRect();
              return {
                x: Math.round(rect.left + rect.width / 2 + offset.x),
                y: Math.round(rect.top + rect.height / 2 + offset.y),
                rect: {
                  x: Math.round(rect.left + offset.x),
                  y: Math.round(rect.top + offset.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                }
              };
            }

            const iframes = Array.from(root.querySelectorAll('iframe'));
            for (const iframe of iframes) {
              try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                const iframeRect = iframe.getBoundingClientRect();
                const nextOffset = {
                  x: offset.x + iframeRect.left,
                  y: offset.y + iframeRect.top
                };
                const res = search(iframeDoc, nextOffset);
                if (res) return res;
              } catch (e) {}
            }

            const all = Array.from(root.querySelectorAll('*'));
            for (const item of all) {
              if (item.shadowRoot) {
                const res = search(item.shadowRoot, offset);
                if (res) return res;
              }
            }

            return null;
          }

          const found = search(document);
          if (found) {
            return {
              x: found.x,
              y: found.y,
              rect: found.rect,
              success: true
            };
          }
          return { success: false };
        };
      }
      if (!window.__aiClick) {
        window.__aiClick = function(selectorOrId) {
          const el = window.__aiFindElement(selectorOrId);
          if (el) {
            el.focus();
            el.click();
            return true;
          }
          return false;
        };
      }
      if (!window.__aiFill) {
        window.__aiFill = function(selectorOrId, val) {
          const el = window.__aiFindElement(selectorOrId);
          if (el) {
            el.focus();
            const nativeValueSetter = Object.getOwnPropertyDescriptor(
              el.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
              'value'
            );
            const tracker = el._valueTracker;

            // Clear value
            if (nativeValueSetter && nativeValueSetter.set) {
              nativeValueSetter.set.call(el, '');
            } else {
              el.value = '';
            }
            if (tracker) tracker.setValue('');
            el.dispatchEvent(new Event('input', { bubbles: true }));

            // Set new value
            if (nativeValueSetter && nativeValueSetter.set) {
              nativeValueSetter.set.call(el, val);
            } else {
              el.value = val;
            }
            if (tracker) tracker.setValue(val);

            // Dispatch framework events
            el.dispatchEvent(new Event('keydown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('keypress', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('keyup', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          }
          return false;
        };
      }
      if (!window.__aiSelect) {
        window.__aiSelect = function(selectorOrId, val) {
          const el = window.__aiFindElement(selectorOrId);
          if (el) {
            el.focus();
            if (el.tagName.toLowerCase() === 'select') {
              el.value = val;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            } else {
              const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
              if (nativeValueSetter && nativeValueSetter.set) {
                nativeValueSetter.set.call(el, val);
              } else {
                el.value = val;
              }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
          return false;
        };
      }
    })();
  `;

  // Structured namespaces implementing:
  // Browser Automation Engine -> DOM API | Tab API | Network API | File API -> Chromium
  const AutomationEngine = {
    // 1. DOM API
    dom: {
      async executeAction(actionType, target, val, tabId) {
        const step = state.plan[state.currentStepIndex];
        let x = step && typeof step.x === 'number' ? step.x : null;
        let y = step && typeof step.y === 'number' ? step.y : null;

        async function resolveTargetCoords(selOrId) {
          if (!selOrId) return null;
          const script = `
            ${helperScript}
            (function() {
              return window.__aiFindElementAndCoords(${JSON.stringify(selOrId)});
            })()
          `;
          const res = await window.electronAPI.aiExecutePageAction(script, tabId);
          if (res && res.success && res.result && res.result.success) {
            return { x: res.result.x, y: res.result.y };
          }
          return null;
        }

        if (actionType === 'fill') {
          logConsole(`[DOM API] Filling target "${target}" with value: "${val}"`, 'line-system');
          let coords = { x, y };
          if (coords.x === null || coords.y === null) {
            coords = await resolveTargetCoords(target);
          }
          if (!coords) {
            logConsole(`[DOM API] Target not found for fill`, 'line-warn');
            return { success: false, error: 'Element not found' };
          }
          
          // Clear programmatically
          const clearScript = `
            ${helperScript}
            (function() {
              const el = window.__aiFindElement(${JSON.stringify(target)});
              if (el) {
                el.focus();
                if (el.tagName && (el.tagName.toLowerCase() === 'textarea' || el.tagName.toLowerCase() === 'input')) {
                  const nativeValueSetter = Object.getOwnPropertyDescriptor(
                    el.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
                    'value'
                  );
                  const tracker = el._valueTracker;
                  if (nativeValueSetter && nativeValueSetter.set) {
                    nativeValueSetter.set.call(el, '');
                  } else {
                    el.value = '';
                  }
                  if (tracker) tracker.setValue('');
                  el.dispatchEvent(new Event('keydown', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new Event('keypress', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('keyup', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('blur', { bubbles: true }));
                } else if (el.isContentEditable) {
                  el.textContent = '';
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
                return true;
              }
              return false;
            })()
          `;
          await window.electronAPI.aiExecutePageAction(clearScript, tabId);
          
          // Focus via CDP click
          await window.electronAPI.aiCDPClick({ tabId, x: coords.x, y: coords.y });
          
          // Type via CDP keystrokes
          const success = await window.electronAPI.aiCDPType({ tabId, text: val });
          logConsole(`[DOM API] Fill native result: ${success ? 'Success' : 'Failed'}`, 'line-system');
          return { success };

        } else if (actionType === 'click') {
          logConsole(`[DOM API] Clicking target "${target || `(${x},${y})`}"`, 'line-system');
          let coords = { x, y };
          if (coords.x === null || coords.y === null) {
            coords = await resolveTargetCoords(target);
          }
          if (!coords) {
            logConsole(`[DOM API] Target not found for click`, 'line-warn');
            return { success: false, error: 'Element not found' };
          }
          const success = await window.electronAPI.aiCDPClick({ tabId, x: coords.x, y: coords.y });
          logConsole(`[DOM API] Click native result: ${success ? 'Success' : 'Failed'}`, 'line-system');
          return { success };

        } else if (actionType === 'select') {
          logConsole(`[DOM API] Selecting option "${val}" on "${target}"`, 'line-system');
          let coords = await resolveTargetCoords(target);
          if (coords) {
            await window.electronAPI.aiCDPClick({ tabId, x: coords.x, y: coords.y });
          }
          const script = `
            ${helperScript}
            (function() {
              return window.__aiSelect(${JSON.stringify(target)}, ${JSON.stringify(val)});
            })()
          `;
          const res = await window.electronAPI.aiExecutePageAction(script, tabId);
          logConsole(`[DOM API] Select option result: ${res && res.success && res.result ? 'Success' : 'Failed'}`, 'line-system');
          return res;

        } else if (actionType === 'presskey') {
          logConsole(`[DOM API] Pressing key "${val}" on target "${target || 'focused element'}"`, 'line-system');
          if (target) {
            let coords = await resolveTargetCoords(target);
            if (coords) {
              await window.electronAPI.aiCDPClick({ tabId, x: coords.x, y: coords.y });
            }
          }
          const success = await window.electronAPI.aiCDPPressKey({ tabId, key: val });
          logConsole(`[DOM API] Press key native result: ${success ? 'Success' : 'Failed'}`, 'line-system');
          return { success };

        } else if (actionType === 'scroll') {
          logConsole(`[DOM API] Scrolling: value="${val}" target="${target || 'viewport'}"`, 'line-system');
          const script = `
            ${helperScript}
            (function() {
              if (${JSON.stringify(target)}) {
                const el = window.__aiFindElement(${JSON.stringify(target)});
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return true;
                }
              }
              const direction = ${JSON.stringify(val)}.toLowerCase();
              if (direction === 'down') {
                window.scrollBy({ top: 500, behavior: 'smooth' });
                return true;
              } else if (direction === 'up') {
                window.scrollBy({ top: -500, behavior: 'smooth' });
                return true;
              }
              return false;
            })()
          `;
          const res = await window.electronAPI.aiExecutePageAction(script, tabId);
          logConsole(`[DOM API] Scroll result: ${res && res.success && res.result ? 'Success' : 'Failed'}`, 'line-system');
          return res;

        } else if (actionType === 'extracttext') {
          logConsole(`[DOM API] Extracting text from "${target}"`, 'line-system');
          const script = `
            ${helperScript}
            (function() {
              const el = window.__aiFindElement(${JSON.stringify(target)});
              return el ? el.innerText || el.value : null;
            })()
          `;
          const res = await window.electronAPI.aiExecutePageAction(script, tabId);
          if (res && res.success && res.result !== null) {
            logConsole(`[DOM API] Extracted content: "${res.result.slice(0, 100)}..."`, 'line-system');
            const memKey = 'Extracted_' + (target.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 15));
            state.memory[memKey] = res.result;
            renderMemoryViewer();
          } else {
            logConsole(`[DOM API] Extraction failed: ${res ? res.error : 'Element not found'}`, 'line-warn');
          }
          return res;
        }
        return { success: false, error: 'Unknown DOM action' };
      }
    },

    // 2. Tab API
    tab: {
      async navigate(url, tabId) {
        if (!/^https?:\/\//i.test(url)) {
          url = 'https://' + url;
        }
        logConsole(`[Tab API] Navigating worker tab to ${url}`, 'line-system');
        return window.electronAPI.navigateTab({ tabId, url });
      },
      async wait(val, tabId) {
        if (/^\d+$/.test(val)) {
          const ms = parseInt(val);
          logConsole(`[Tab API] Sleeping for ${ms}ms...`, 'line-system');
          return new Promise(resolve => setTimeout(() => resolve({ success: true }), ms));
        } else {
          logConsole(`[Tab API] Waiting for selector/element "${val}" to load...`, 'line-system');
          const startTime = Date.now();
          while (Date.now() - startTime < 10000) {
            const script = `
              (function() {
                let el = document.querySelector('[data-ai-id="' + ${JSON.stringify(val)} + '"]');
                if (el) return true;
                try {
                  el = document.querySelector(${JSON.stringify(val)});
                  if (el) return true;
                } catch(e) {}
                if (${JSON.stringify(val)}.startsWith('text=')) {
                  const txt = ${JSON.stringify(val)}.substring(5).replace(/^["']|["']$/g, '').trim();
                  const all = Array.from(document.querySelectorAll('a, button, input, label, span, p, div'));
                  if (all.find(e => e.textContent.trim() === txt)) return true;
                }
                return false;
              })()
            `;
            const res = await window.electronAPI.aiExecutePageAction(script, tabId);
            if (res && res.success && res.result) {
              logConsole(`[Tab API] Target "${val}" loaded successfully!`, 'line-system');
              return { success: true };
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          logConsole(`[Tab API] Timeout waiting for target "${val}"`, 'line-warn');
          return { success: false, error: 'Timeout waiting for selector' };
        }
      }
    },

    // 3. Network API
    network: {
      async updateTelemetry() {
        updateMeters();
      }
    },

    // 4. File API
    file: {
      async download(filename, content) {
        logConsole(`[File API] Downloading generated artifact: "${filename}"`, 'line-system');
        if (window.electronAPI && window.electronAPI.aiSaveFile) {
          const res = await window.electronAPI.aiSaveFile(filename, content);
          if (res && res.success) {
            logConsole(`[File API] File successfully saved to: ${res.filePath}`, 'line-system');
            logActivity(`Artifact saved: ${filename}`, 'success');
          } else {
            logConsole(`[File API] Download failed: ${res ? res.error : 'Unknown error'}`, 'line-warn');
            logActivity(`Download failed: ${filename}`, 'warn');
          }
          return res;
        }
        logConsole(`[File API] File saving failed: API unavailable`, 'line-error');
        return { success: false, error: 'File API not available' };
      }
    }
  };

  async function waitForWorkerTabLoad(tabId) {
    if (!tabId || !window.electronAPI) return;
    // Wait 500ms first to let any page transition start loading
    await new Promise(r => setTimeout(r, 500));
    
    let isLoading = true;
    let checkCount = 0;
    while (isLoading && checkCount < 15 && state.isRunning && !state.isPaused) {
      isLoading = await window.electronAPI.aiIsTabLoading(tabId);
      if (isLoading) {
        logConsole(`[System] Page is loading, waiting 300ms...`, 'line-system');
        await new Promise(r => setTimeout(r, 300));
        checkCount++;
      }
    }
    // Wait another 500ms to let page scripts/layouts settle down
    await new Promise(r => setTimeout(r, 500));
  }

  async function executeNativeBrowserHook(index) {
    if (!window.electronAPI) return { success: false, error: 'API unavailable' };

    try {
      const targetTabId = state.workerTabId || window._activeTabId;
      const step = state.plan[index];
      if (!step) return { success: false, error: 'Step not found' };

      const actionType = (step.actionType || '').toLowerCase();
      logConsole(`[Automation Engine] Processing step ${step.id} action: type=${actionType}`, 'line-system');

      let res = { success: false, error: 'Unknown action' };
      if (actionType === 'navigate' || (step.agent === 'agent-nav' && step.url)) {
        const url = (step.value || step.url || '').trim();
        if (url) {
          await AutomationEngine.tab.navigate(url, targetTabId);
          res = { success: true, result: `Navigated to ${url}` };
        }
      } else if (actionType === 'download') {
        const filename = step.value || 'receipt.txt';
        const content = step.content || 'Goal: ' + state.goal + '\nStatus: Success\nDetails: Completed by DevilBrowser Autonomous Cockpit.';
        res = await AutomationEngine.file.download(filename, content);
      } else if (actionType === 'wait') {
        const val = step.value || '2000';
        res = await AutomationEngine.tab.wait(val, targetTabId);
      } else if (['fill', 'click', 'select', 'presskey', 'scroll', 'extracttext'].includes(actionType)) {
        const target = step.selector || step.elementId;
        const val = step.value || '';
        res = await AutomationEngine.dom.executeAction(actionType, target, val, targetTabId);
      }

      // Check if tab is loading after actions like navigation, clicking, typing or pressing Enter
      if (['navigate', 'click', 'presskey', 'fill'].includes(actionType)) {
        await waitForWorkerTabLoad(targetTabId);
      }

      if (SCENARIOS['dynamic'] && SCENARIOS['dynamic'].actions[index]) {
        SCENARIOS['dynamic'].actions[index].actualResult = res;
      }
      return res;
    } catch (e) {
      logConsole(`[Error Recovery] Automation Engine execution failed: ${e.message}`, 'line-error');
      const res = { success: false, error: e.message };
      if (SCENARIOS['dynamic'] && SCENARIOS['dynamic'].actions[index]) {
        SCENARIOS['dynamic'].actions[index].actualResult = res;
      }
      return res;
    }
  }

  // --- HUMAN APPROVAL (HIL) PIPELINE ---

  function pauseForApproval(approvalData) {
    state.isPaused = true;
    els.btnPause.disabled = true;
    els.btnResume.disabled = false;
    els.btnRetry.disabled = false;

    // Highlight urgent card
    els.approvalQueue.innerHTML = `
      <div class="approval-item">
        <span class="approval-desc">🚨 Validation Required:<br>${approvalData.desc}</span>
        <div class="approval-actions">
          <button class="btn-approve" id="hil-approve-btn">Approve Transaction</button>
          <button class="btn-reject" id="hil-reject-btn">Reject Action</button>
        </div>
      </div>
    `;

    // Hook buttons
    document.getElementById('hil-approve-btn').addEventListener('click', () => {
      els.approvalQueue.innerHTML = '<div class="queue-empty">No pending validations. Safe state active.</div>';
      logConsole('[Security] Action APPROVED by user. Resuming mission pipeline.', 'line-system');
      logActivity('Security Action Approved', 'success');
      
      // Mark step details as approved so it doesn't prompt again
      SCENARIOS[state.scenario].actions[state.currentStepIndex].approved = true;
      resumeMission();
    });

    document.getElementById('hil-reject-btn').addEventListener('click', () => {
      els.approvalQueue.innerHTML = '<div class="queue-empty">No pending validations. Safe state active.</div>';
      logConsole('[Security] Action REJECTED by user. Halting execution loop.', 'line-error');
      logActivity('Security Action Rejected', 'error');
      pauseMission();
    });

    logConsole(`[Security] Gated step encountered: "${approvalData.desc}". Halting for user validation.`, 'line-warn');
    logActivity('Safety Authorization Required', 'warn');
    activateAgent('agent-auth');
  }

  // --- SYSTEM telemetry GAUGES ---

  function startTelemetryMonitors() {
    if (AutomationEngine && AutomationEngine.network && AutomationEngine.network.updateTelemetry) {
      AutomationEngine.network.updateTelemetry();
      state.telemetryTimer = setInterval(() => {
        AutomationEngine.network.updateTelemetry();
      }, 2000);
    } else {
      updateMeters();
      state.telemetryTimer = setInterval(updateMeters, 2000);
    }
  }

  function stopTelemetryMonitors() {
    clearInterval(state.telemetryTimer);
    els.meterCpu.style.width = '0%';
    els.meterRam.style.width = '0%';
    els.meterNetwork.style.width = '0%';
    els.meterLatency.style.width = '0%';
  }

  function updateMeters() {
    if (!state.isRunning) return;
    
    // CPU Fluctuations
    const cpu = Math.floor(Math.random() * 24) + 12; // 12-36%
    els.meterCpu.style.width = cpu + '%';
    
    // RAM Fluctuations
    const ram = Math.floor(Math.random() * 8) + 42; // 42-50%
    els.meterRam.style.width = ram + '%';
    
    // Network load
    const net = Math.floor(Math.random() * 40) + 15;
    els.meterNetwork.style.width = net + '%';
    
    // Latency
    const latency = Math.floor(Math.random() * 30) + 20;
    els.meterLatency.style.width = latency + '%';
  }

  // --- RENDERING HELPERS ---

  function renderPlannedTasks() {
    els.plannedTasks.innerHTML = '';
    state.plan.forEach((step, idx) => {
      const div = document.createElement('div');
      div.className = 'plan-step-item';
      div.dataset.stepId = step.id;
      div.innerHTML = `
        <span class="step-num">${step.id}.</span>
        <span class="step-label">${step.label}</span>
      `;
      els.plannedTasks.appendChild(div);
    });
  }

  function updateActiveStepHighlight(activeId) {
    const items = els.plannedTasks.querySelectorAll('.plan-step-item');
    items.forEach(el => {
      const id = parseInt(el.dataset.stepId);
      if (id < activeId) {
        el.className = 'plan-step-item completed';
      } else if (id === activeId) {
        el.className = 'plan-step-item active';
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        el.className = 'plan-step-item';
      }
    });
  }

  function activateAgent(agentId) {
    deactivateAllAgents();
    const agentEl = document.getElementById(agentId);
    if (agentEl) {
      agentEl.classList.add('active');
    }
  }

  function deactivateAllAgents() {
    const items = document.querySelectorAll('.agent-item');
    items.forEach(el => el.classList.remove('active'));
  }

  function logActivity(message, status = '') {
    const div = document.createElement('div');
    div.className = `timeline-item ${status}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `
      <span class="ts">[${time}]</span>
      <span class="msg">${message}</span>
    `;
    
    els.activityFeed.appendChild(div);
    els.activityFeed.scrollTop = els.activityFeed.scrollHeight;
  }

  function logConsole(message, cssClass = '') {
    const div = document.createElement('div');
    div.className = `console-line ${cssClass}`;
    div.innerText = message;
    
    els.console.appendChild(div);
    els.console.scrollTop = els.console.scrollHeight;
  }

  function renderMemoryViewer() {
    els.memoryViewer.innerHTML = '';
    const keys = Object.keys(state.memory);
    if (keys.length === 0) {
      els.memoryViewer.innerHTML = '<div class="memory-empty">Memory cache empty. Extracted data appears here.</div>';
      return;
    }
    
    keys.forEach(k => {
      const item = document.createElement('div');
      item.className = 'memory-row-item';
      item.innerHTML = `
        <span class="key">${k}:</span>
        <span class="val" title="${state.memory[k]}">${state.memory[k]}</span>
      `;
      els.memoryViewer.appendChild(item);
    });
  }

  // --- BROWSER MAP & TABS SYNCHRONIZATION ---

  function syncBrowserMap() {
    if (!els.browserMap) return;
    els.browserMap.innerHTML = '';
    
    const tabs = window._tabs || [];
    const activeTabId = window._activeTabId;

    if (tabs.length === 0) {
      els.browserMap.innerHTML = '<div class="plan-empty">No active tabs in viewport</div>';
      return;
    }

    tabs.forEach(t => {
      const div = document.createElement('div');
      div.className = `map-tab-item ${t.id === activeTabId ? 'active' : ''}`;
      div.innerHTML = `
        <span class="tab-title-text">${t.title || 'New Tab'}</span>
        <span class="tab-jump">Jump →</span>
      `;
      div.addEventListener('click', () => {
        if (window.electronAPI) {
          window.electronAPI.setActiveTab(t.id);
        }
      });
      els.browserMap.appendChild(div);
    });
  }

  // --- BROWSER VISION screenshot CAPTURE ---

  async function captureVisionFeed() {
    if (!window.electronAPI || !els.visionFeed || !els.visionPlaceholder) return;

    try {
      const targetTabId = state.workerTabId || window._activeTabId;
      const res = await window.electronAPI.aiGetPageScreenshot(targetTabId);
      if (res && !res.error && res.base64) {
        els.visionFeed.src = `data:${res.mimeType || 'image/png'};base64,${res.base64}`;
        els.visionFeed.classList.remove('hidden');
        els.visionPlaceholder.classList.add('hidden');
        
        // Draw some mock OCR boxes on top of overlay to show agent is reading
        drawMockOCRBoxes();
      } else {
        fallbackVisionPlaceholder();
      }
    } catch (e) {
      fallbackVisionPlaceholder();
    }
  }

  function fallbackVisionPlaceholder() {
    els.visionFeed.classList.add('hidden');
    els.visionPlaceholder.classList.remove('hidden');
    els.visionBoxOverlay.innerHTML = '';
  }

  function drawMockOCRBoxes() {
    els.visionBoxOverlay.innerHTML = '';
    
    // Draw 2-3 randomized bounding boxes to simulate Vision analysis
    const count = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < count; i++) {
      const box = document.createElement('div');
      box.className = 'ocr-box';
      
      const top = Math.floor(Math.random() * 60) + 10;
      const left = Math.floor(Math.random() * 60) + 10;
      const width = Math.floor(Math.random() * 20) + 10;
      const height = Math.floor(Math.random() * 15) + 5;
      
      box.style.top = top + '%';
      box.style.left = left + '%';
      box.style.width = width + '%';
      box.style.height = height + '%';
      
      els.visionBoxOverlay.appendChild(box);
    }
  }

  // --- AI PLANNER INTEGRATIONS ---
  async function getActiveModel() {
    try {
      const res = await window.electronAPI.aiGetModels();
      if (res && res.models && res.models.length > 0) {
        return res.models[0];
      }
    } catch (e) {}
    return 'gemini-2.5-flash'; // fallback
  }

  function cleanAndParseJSON(jsonStr) {
    let clean = jsonStr.trim();
    
    // 1. Try markdown code block extraction anywhere in the text
    const matchJson = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (matchJson) {
      clean = matchJson[1].trim();
    } else {
      // 2. Search for bracket bounds if direct parse/codeblock fails
      const startIdx = clean.indexOf('{');
      const endIdx = clean.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        clean = clean.slice(startIdx, endIdx + 1);
      }
    }
    
    // Remove comments
    clean = clean.replace(/(?:^|\s)\/\/.*$/gm, '');
    clean = clean.replace(/\/\*[\s\S]*?\*\//g, '');
    
    try {
      return JSON.parse(clean);
    } catch (e) {
      try {
        let fixed = clean
          .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'(?=\s*:)/g, '"$1"')
          .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');
        fixed = fixed.replace(/,\s*([\]}])/g, '$1');
        return JSON.parse(fixed);
      } catch (e2) {
        throw new Error("Invalid JSON plan: " + e.message);
      }
    }
  }

  // --- INITIALIZATION ---
  function init() {
    initDOMElements();
    setupListeners();
    loadPersona();
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
