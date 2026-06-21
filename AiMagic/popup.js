const BASE_URL = 'http://127.0.0.1:3001';

document.addEventListener('DOMContentLoaded', () => {
    // Load current settings
    chrome.storage.local.get(['preferredTheme', 'isPremium', 'requestsToday', 'totalApiCalls', 'userEmail', 'uiOpacity', 'toastOpacity', 'typerWPM', 'authToken'], (result) => {
        // Load Theme
        const theme = result.preferredTheme || 'dark';
        updateThemeUI(theme);

        // Load Opacity
        const uiOp = result.uiOpacity || 100;
        const toastOp = result.toastOpacity || 100;

        const uiSlider = document.getElementById('uiOpacity');
        const uiVal = document.getElementById('uiOpacityVal');
        if (uiSlider && uiVal) {
            uiSlider.value = uiOp;
            uiVal.textContent = `${uiOp}%`;
        }

        const toastSlider = document.getElementById('toastOpacity');
        const toastVal = document.getElementById('toastOpacityVal');
        if (toastSlider && toastVal) {
            toastSlider.value = toastOp;
            toastVal.textContent = `${toastOp}%`;
        }

        // Load Typer WPM
        const wpm = result.typerWPM || 60;
        const wpmSlider = document.getElementById('typerWPM');
        const wpmVal = document.getElementById('typerWPMVal');
        if (wpmSlider && wpmVal) {
            wpmSlider.value = wpm;
            wpmVal.textContent = `${wpm} WPM`;
        }

        // Setup account UI
        setupLoginUI(result.authToken || null);
        if (result.authToken) {
            fetchStats(result.authToken);
        }
    });

    // Sync Account Button
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            syncBtn.textContent = 'Syncing...';
            syncBtn.disabled = true;

            chrome.runtime.sendMessage({ action: 'FORCE_SYNC' }, () => {
                chrome.storage.local.get(['authToken'], ({ authToken }) => {
                    if (authToken) {
                        fetchStats(authToken).then(() => {
                            const status = document.getElementById('status');
                            status.textContent = 'Stats refreshed!';
                            status.style.color = '#10b981';
                            status.classList.add('show');
                            setTimeout(() => {
                                status.classList.remove('show');
                                syncBtn.textContent = 'Sync Account';
                                syncBtn.disabled = false;
                            }, 3000);
                        });
                    } else {
                        const status = document.getElementById('status');
                        status.textContent = 'Not logged in.';
                        status.style.color = '#ef4444';
                        status.classList.add('show');
                        setTimeout(() => {
                            status.classList.remove('show');
                            syncBtn.textContent = 'Sync Account';
                            syncBtn.disabled = false;
                        }, 3000);
                    }
                });
            });
        });
    }

    // --- Login Flow ---

    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const verifyOtpBtn = document.getElementById('verifyOtpBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if (sendOtpBtn) {
        sendOtpBtn.addEventListener('click', async () => {
            const email = document.getElementById('emailInput').value.trim();
            if (!email) {
                showLoginStatus('Enter your email address.', 'error');
                return;
            }

            sendOtpBtn.textContent = 'Sending...';
            sendOtpBtn.disabled = true;

            try {
                const res = await fetch(`${BASE_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });
                const data = await res.json();

                if (res.ok) {
                    showLoginStatus('OTP sent! Check your email.', 'success');
                    document.getElementById('otpSection').style.display = 'block';
                    sendOtpBtn.textContent = 'Resend OTP';
                    sendOtpBtn.disabled = false;
                } else {
                    showLoginStatus(data.error || 'Failed to send OTP.', 'error');
                    sendOtpBtn.textContent = 'Send OTP';
                    sendOtpBtn.disabled = false;
                }
            } catch (e) {
                showLoginStatus('Cannot connect to server.', 'error');
                sendOtpBtn.textContent = 'Send OTP';
                sendOtpBtn.disabled = false;
            }
        });
    }

    if (verifyOtpBtn) {
        verifyOtpBtn.addEventListener('click', async () => {
            const email = document.getElementById('emailInput').value.trim();
            const otp = document.getElementById('otpInput').value.trim();

            if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
                showLoginStatus('Enter the 6-digit OTP.', 'error');
                return;
            }

            verifyOtpBtn.textContent = 'Verifying...';
            verifyOtpBtn.disabled = true;

            try {
                const res = await fetch(`${BASE_URL}/auth/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, otp }),
                });
                const data = await res.json();

                if (res.ok) {
                    chrome.storage.local.set({ authToken: data.token }, () => {
                        chrome.runtime.sendMessage({ action: 'SAVE_AUTH_TOKEN', token: data.token });
                        showLoginStatus('Logged in successfully!', 'success');
                        setupLoginUI(data.token);
                        fetchStats(data.token);
                    });
                } else {
                    const msg = data.error || 'Verification failed.';
                    showLoginStatus(msg, 'error');
                    verifyOtpBtn.textContent = 'Verify & Login';
                    verifyOtpBtn.disabled = false;
                }
            } catch (e) {
                showLoginStatus('Cannot connect to server.', 'error');
                verifyOtpBtn.textContent = 'Verify & Login';
                verifyOtpBtn.disabled = false;
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'LOGOUT' }, () => {
                chrome.storage.local.set({ authToken: null, userEmail: null, isPremium: false }, () => {
                    setupLoginUI(null);
                    clearStatsDisplay();
                });
            });
        });
    }

    // Opacity Sliders
    const uiSlider = document.getElementById('uiOpacity');
    const uiVal = document.getElementById('uiOpacityVal');
    const toastSlider = document.getElementById('toastOpacity');
    const toastVal = document.getElementById('toastOpacityVal');

    if (uiSlider && uiVal) {
        uiSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            uiVal.textContent = `${val}%`;
            chrome.storage.local.set({ uiOpacity: parseInt(val) });
        });
    }

    if (toastSlider && toastVal) {
        toastSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            toastVal.textContent = `${val}%`;
            chrome.storage.local.set({ toastOpacity: parseInt(val) });
        });
    }

    // Typer WPM Slider
    const wpmSlider = document.getElementById('typerWPM');
    const wpmVal = document.getElementById('typerWPMVal');

    if (wpmSlider && wpmVal) {
        wpmSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            wpmVal.textContent = `${val} WPM`;
            chrome.storage.local.set({ typerWPM: parseInt(val) });
        });
    }

    // Theme Toggle
    const themeButtons = document.querySelectorAll('#themeToggle button');
    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const selectedTheme = btn.dataset.theme;
            updateThemeUI(selectedTheme, themeButtons);
            chrome.storage.local.set({ preferredTheme: selectedTheme });
        });
    });
});

// Fetch stats from /v1/users/me, /v1/quota, and /v1/usage
async function fetchStats(authToken) {
    if (!authToken) return;

    // Show loading state in stats section
    setStatsLoading(true);

    const headers = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
    };

    try {
        const [meRes, quotaRes, usageRes] = await Promise.all([
            fetch(`${BASE_URL}/v1/users/me`, { headers }),
            fetch(`${BASE_URL}/v1/quota`,    { headers }),
            fetch(`${BASE_URL}/v1/usage`,    { headers }),
        ]);

        // Handle session expiry
        if (meRes.status === 401 || quotaRes.status === 401) {
            chrome.storage.local.set({ authToken: null, userEmail: null, isPremium: false });
            setupLoginUI(null);
            clearStatsDisplay();
            return;
        }

        const [me, quota, usage] = await Promise.all([
            meRes.ok   ? meRes.json()    : null,
            quotaRes.ok ? quotaRes.json() : null,
            usageRes.ok ? usageRes.json() : null,
        ]);

        renderStats(me, quota, usage);

        // Sync relevant fields to storage for background.js use
        if (me) {
            const isPremium = me.role === 'admin' || me.role === 'owner' || me.plan === 'premium';
            chrome.storage.local.set({ userEmail: me.email, isPremium });
        }
    } catch (e) {
        console.warn('[POPUP] fetchStats failed:', e);
        setStatsLoading(false);
    }
}

function setStatsLoading(loading) {
    const ids = ['planStatus', 'userRole', 'userEmail', 'accountStatus', 'usageStatus', 'totalRequests', 'avgLatency', 'lastLogin'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && loading) {
            el.textContent = '...';
            el.className = el.className.includes('badge') ? el.className : 'info-value stat-loading';
        }
    });
}

function renderStats(me, quota, usage) {
    // Plan badge
    const planEl = document.getElementById('planStatus');
    if (planEl && me) {
        const plan = me.plan || 'free';
        const role = me.role || 'user';
        if (role === 'owner') {
            planEl.textContent = 'Owner';
            planEl.className = 'badge badge-owner';
        } else if (role === 'admin') {
            planEl.textContent = 'Admin';
            planEl.className = 'badge badge-admin';
        } else if (plan === 'premium') {
            planEl.textContent = 'Premium';
            planEl.className = 'badge badge-premium';
        } else {
            planEl.textContent = 'Free';
            planEl.className = 'badge badge-free';
        }
    }

    // Role
    const roleEl = document.getElementById('userRole');
    if (roleEl && me) {
        roleEl.textContent = me.role ? capitalize(me.role) : '—';
        roleEl.className = 'info-value';
    }

    // Email
    const emailEl = document.getElementById('userEmail');
    if (emailEl && me) {
        emailEl.textContent = me.email || '—';
        emailEl.className = 'info-value';
        emailEl.style.fontSize = '12px';
        emailEl.style.wordBreak = 'break-all';
    }

    // Account status
    const statusEl = document.getElementById('accountStatus');
    if (statusEl && me) {
        statusEl.textContent = capitalize(me.status || 'active');
        statusEl.className = 'info-value';
        statusEl.style.color = me.status === 'active' ? '#10b981' : '#ef4444';
    }

    // Today's usage (from /v1/quota)
    const usageEl = document.getElementById('usageStatus');
    if (usageEl) {
        if (quota) {
            if (quota.limit === null) {
                usageEl.textContent = `${quota.used_today ?? 0} / Unlimited`;
            } else {
                usageEl.textContent = `${quota.used_today ?? 0} / ${quota.limit}`;
                usageEl.style.color = (quota.remaining !== null && quota.remaining <= 5) ? '#ef4444' : '';
            }
        } else {
            usageEl.textContent = '—';
        }
        usageEl.className = 'info-value';
    }

    // Total requests (from /v1/users/me)
    const totalEl = document.getElementById('totalRequests');
    if (totalEl && me) {
        totalEl.textContent = me.usage?.total_requests != null
            ? me.usage.total_requests.toLocaleString()
            : '0';
        totalEl.className = 'info-value';
    }

    // Avg latency (from /v1/usage)
    const latencyEl = document.getElementById('avgLatency');
    if (latencyEl) {
        const avg = usage?.overall?.avg_latency_ms;
        latencyEl.textContent = avg != null ? `${avg} ms` : '—';
        latencyEl.className = 'info-value';
    }

    // Last login
    const loginEl = document.getElementById('lastLogin');
    if (loginEl && me && me.last_login) {
        loginEl.textContent = formatDate(me.last_login);
        loginEl.className = 'info-value';
        loginEl.style.fontSize = '11px';
    } else if (loginEl) {
        loginEl.textContent = '—';
    }

    // Show stats section
    const statsSection = document.getElementById('statsSection');
    if (statsSection) statsSection.style.display = 'flex';
}

function clearStatsDisplay() {
    const ids = ['planStatus', 'userRole', 'userEmail', 'accountStatus', 'usageStatus', 'totalRequests', 'avgLatency', 'lastLogin'];
    const defaults = {
        planStatus: { text: '—', className: 'badge badge-free' },
        userRole:   { text: '—' },
        userEmail:  { text: 'Not Logged In' },
        accountStatus: { text: '—' },
        usageStatus: { text: '—' },
        totalRequests: { text: '—' },
        avgLatency: { text: '—' },
        lastLogin: { text: '—' },
    };

    for (const [id, def] of Object.entries(defaults)) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.textContent = def.text;
        if (def.className) el.className = def.className;
        el.style.color = '';
        el.style.fontSize = '';
    }

    const statsSection = document.getElementById('statsSection');
    if (statsSection) statsSection.style.display = 'none';
}

function showLoginStatus(message, type) {
    const el = document.getElementById('loginStatus');
    if (!el) return;
    el.textContent = message;
    el.className = `login-status ${type}`;
}

function setupLoginUI(authToken) {
    const loginForm = document.getElementById('loginForm');
    const logoutSection = document.getElementById('logoutSection');
    if (!loginForm || !logoutSection) return;

    if (authToken) {
        loginForm.style.display = 'none';
        logoutSection.style.display = 'block';
    } else {
        loginForm.style.display = 'block';
        logoutSection.style.display = 'none';
        // Reset OTP section
        const otpSection = document.getElementById('otpSection');
        if (otpSection) otpSection.style.display = 'none';
        const emailInput = document.getElementById('emailInput');
        if (emailInput) emailInput.value = '';
        const otpInput = document.getElementById('otpInput');
        if (otpInput) otpInput.value = '';
        const sendOtpBtn = document.getElementById('sendOtpBtn');
        if (sendOtpBtn) {
            sendOtpBtn.textContent = 'Send OTP';
            sendOtpBtn.disabled = false;
        }
        showLoginStatus('', '');
    }
}

function updateThemeUI(theme, buttons = null) {
    const themeButtons = buttons || document.querySelectorAll('#themeToggle button');
    themeButtons.forEach(b => {
        if (b.dataset.theme === theme) b.classList.add('active');
        else b.classList.remove('active');
    });

    document.body.classList.remove('light-mode', 'dark-mode', 'ocean-theme', 'contrast-theme');
    if (theme === 'light') document.body.classList.add('light-mode');
    else if (theme === 'dark') document.body.classList.add('dark-mode');
    else if (theme === 'ocean') document.body.classList.add('ocean-theme');
    else if (theme === 'contrast') document.body.classList.add('contrast-theme');
}

function capitalize(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(isoString) {
    try {
        const d = new Date(isoString);
        return d.toLocaleString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch (e) {
        return isoString;
    }
}

// Watch for storage changes to update login UI
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && 'authToken' in changes) {
        const newToken = changes.authToken.newValue || null;
        setupLoginUI(newToken);
        if (newToken) {
            fetchStats(newToken);
        } else {
            clearStatsDisplay();
        }
    }
});
