// ============================================================
// AI Auth Modal Controller
// ============================================================
// Handles OTP-based login flow for the AiMagic backend.
// JWT is stored in electron-store via IPC.

(function() {
  'use strict';

  // ------- DOM refs -------
  const modal         = document.getElementById('ai-auth-modal');
  const loginStep     = document.getElementById('ai-auth-login-step');
  const otpStep       = document.getElementById('ai-auth-otp-step');
  const emailInput    = document.getElementById('ai-auth-email');
  const otpInput      = document.getElementById('ai-auth-otp');
  const btnSendOtp    = document.getElementById('ai-auth-send-otp');
  const btnVerifyOtp  = document.getElementById('ai-auth-verify-otp');
  const btnBackToLogin= document.getElementById('ai-auth-back');
  const loginError    = document.getElementById('ai-auth-login-error');
  const otpError      = document.getElementById('ai-auth-otp-error');
  const otpEmailLabel = document.getElementById('ai-auth-otp-email-label');
  const loadingSpinner= document.getElementById('ai-auth-loading');

  let pendingEmail = '';

  // ------- Public API -------
  window.aiAuth = {
    /** Check if a token is stored; if so, restore session silently */
    async init() {
      const token = await window.electronAPI.aiGetToken();
      if (token) {
        // Validate token is still good in the background
        try {
          const me = await window.electronAPI.aiGetMe();
          if (me && me.email) {
            window.aiAuth.onLoggedIn(me);
          }
        } catch(e) {
          // Token expired or invalid, clear it
          await window.electronAPI.aiLogout();
        }
      }
    },

    showModal() {
      if (modal) {
        modal.classList.remove('hidden');
        showLoginStep();
        if (emailInput) emailInput.focus();
      }
    },

    hideModal() {
      if (modal) modal.classList.add('hidden');
    },

    /** Called after successful login — update UI globally */
    onLoggedIn(me) {
      this.hideModal();
      // Update AI panel user info
      if (window.aiPanel) window.aiPanel.onAuthReady(me);
      if (window.aiQuota) window.aiQuota.refresh();
    },

    async logout() {
      await window.electronAPI.aiLogout();
      this.showModal();
      if (window.aiPanel) window.aiPanel.onLoggedOut();
    }
  };

  // ------- Step transitions -------
  function showLoginStep() {
    loginStep.classList.remove('hidden');
    otpStep.classList.add('hidden');
    clearError(loginError);
    if (emailInput) emailInput.value = '';
  }

  function showOtpStep(email) {
    pendingEmail = email;
    loginStep.classList.add('hidden');
    otpStep.classList.remove('hidden');
    if (otpEmailLabel) otpEmailLabel.textContent = email;
    clearError(otpError);
    if (otpInput) { otpInput.value = ''; otpInput.focus(); }
  }

  function setLoading(on) {
    if (loadingSpinner) loadingSpinner.classList.toggle('hidden', !on);
    if (btnSendOtp)   btnSendOtp.disabled  = on;
    if (btnVerifyOtp) btnVerifyOtp.disabled = on;
  }

  function clearError(el) { if (el) el.textContent = ''; }
  function showError(el, msg) { if (el) el.textContent = msg; }

  // ------- Event Handlers -------
  if (btnSendOtp) {
    btnSendOtp.addEventListener('click', async () => {
      const email = emailInput ? emailInput.value.trim() : '';
      if (!email) { showError(loginError, 'Please enter your email address.'); return; }
      clearError(loginError);
      setLoading(true);
      try {
        const res = await window.electronAPI.aiLogin(email);
        if (res && res.error) {
          showError(loginError, res.error);
        } else {
          showOtpStep(email);
        }
      } catch(e) {
        showError(loginError, 'Could not reach the AI server. Check your internet connection.');
      } finally {
        setLoading(false);
      }
    });
  }

  if (emailInput) {
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSendOtp && btnSendOtp.click();
    });
  }

  if (btnVerifyOtp) {
    btnVerifyOtp.addEventListener('click', async () => {
      const otp = otpInput ? otpInput.value.trim() : '';
      if (!otp || otp.length !== 6) { showError(otpError, 'Please enter the 6-digit OTP.'); return; }
      clearError(otpError);
      setLoading(true);
      try {
        const res = await window.electronAPI.aiVerifyOtp(pendingEmail, otp);
        if (res && res.token) {
          window.aiAuth.onLoggedIn(res.me || { email: pendingEmail, role: 'user' });
        } else {
          const msg = res && res.error
            ? (res.error === 'invalid_otp' ? 'Incorrect OTP — please try again.'
              : res.error === 'too_many_attempts' ? 'Too many attempts. Request a new OTP.'
              : res.error)
            : 'Verification failed. Please try again.';
          showError(otpError, msg);
        }
      } catch(e) {
        showError(otpError, 'Verification failed. Check your connection.');
      } finally {
        setLoading(false);
      }
    });
  }

  if (otpInput) {
    otpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnVerifyOtp && btnVerifyOtp.click();
    });
  }

  if (btnBackToLogin) {
    btnBackToLogin.addEventListener('click', showLoginStep);
  }

  // Handle 401 session_superseded events from AI panel
  window.addEventListener('ai-session-expired', () => {
    window.aiAuth.showModal();
  });

})();
