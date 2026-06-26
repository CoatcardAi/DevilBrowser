const state = require('../../core/state');
const { aiFetch } = require('./ai-fetch');

async function aiLogin(email) {
  try {
    const res = await aiFetch('POST', '/auth/login', { email }, null);
    return res.body;
  } catch(err) { return { error: err.message }; }
}

async function aiVerifyOtp(email, otp) {
  try {
    const res = await aiFetch('POST', '/auth/verify', { email, otp }, null);
    if (res.body && res.body.token) {
      state.store.set('ai-token', res.body.token);
      // Fetch me to return role info
      try {
        const meRes = await aiFetch('GET', '/auth/me', null, res.body.token);
        return { token: res.body.token, me: meRes.body };
      } catch { return { token: res.body.token }; }
    }
    return res.body;
  } catch(err) { return { error: err.message }; }
}

async function aiLogout() {
  const token = state.store.get('ai-token');
  if (token) {
    try { await aiFetch('POST', '/auth/logout', {}, token); } catch {}
    state.store.delete('ai-token');
  }
  return { success: true };
}

async function aiGetMe() {
  const token = state.store.get('ai-token');
  if (!token) return null;
  try {
    const res = await aiFetch('GET', '/auth/me', null, token);
    if (res.status === 401) { state.store.delete('ai-token'); return null; }
    return res.body;
  } catch { return null; }
}

function aiGetToken() {
  return state.store.get('ai-token') || null;
}

module.exports = {
  aiLogin,
  aiVerifyOtp,
  aiLogout,
  aiGetMe,
  aiGetToken
};
