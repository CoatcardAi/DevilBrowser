function isAuthorizedSender(sender) {
  try {
    const url = sender.getURL();
    return url.startsWith('file://') && url.includes('index.html');
  } catch (e) {
    return false;
  }
}

module.exports = {
  isAuthorizedSender
};
