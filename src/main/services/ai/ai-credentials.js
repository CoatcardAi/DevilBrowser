const Store = require('electron-store');
const { safeStorage } = require('electron');
const credentialStore = new Store({ name: 'secure-credentials' });

function saveCredential({ domain, username, password }) {
  if (!domain || !username || !password) {
    return { success: false, error: 'Missing required parameters: domain, username, or password' };
  }

  const key = `${domain.toLowerCase()}:${username}`;
  let storedPassword = password;

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(password);
    storedPassword = encrypted.toString('hex');
  } else {
    console.warn('Encryption is not available on this host. Saving in plain text (fallback).');
  }

  const credentials = credentialStore.get('credentials', {});
  credentials[key] = {
    domain: domain.toLowerCase(),
    username,
    password: storedPassword,
    encrypted: safeStorage.isEncryptionAvailable()
  };
  credentialStore.set('credentials', credentials);
  return { success: true, key };
}

function listCredentials() {
  const credentials = credentialStore.get('credentials', {});
  const list = Object.entries(credentials).map(([key, data]) => ({
    key,
    domain: data.domain,
    username: data.username
  }));
  return { success: true, list };
}

function getCredential(key) {
  const credentials = credentialStore.get('credentials', {});
  const data = credentials[key];
  if (!data) return { success: false, error: 'Credential not found' };

  let decryptedPassword = data.password;
  if (data.encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      const buf = Buffer.from(data.password, 'hex');
      decryptedPassword = safeStorage.decryptString(buf);
    } catch (err) {
      return { success: false, error: 'Decryption failed: ' + err.message };
    }
  }
  return {
    success: true,
    credential: {
      domain: data.domain,
      username: data.username,
      password: decryptedPassword
    }
  };
}

function deleteCredential(key) {
  const credentials = credentialStore.get('credentials', {});
  if (!credentials[key]) return { success: false, error: 'Credential not found' };
  delete credentials[key];
  credentialStore.set('credentials', credentials);
  return { success: true };
}

module.exports = {
  saveCredential,
  listCredentials,
  getCredential,
  deleteCredential
};
