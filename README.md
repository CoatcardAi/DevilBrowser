# DevilBrowser

Minimal Electron-based browser scaffold with modern UI, tabs, content protection toggle, download handling, bookmarks placeholder, and Windows audio-routing hooks.

Requirements
- Node.js and npm
- On Windows, for full audio-routing automation install the PowerShell module `AudioDeviceCmdlets` (optional).

Run

```bash
npm install
npm start
```

Notes
- Content protection uses `BrowserWindow.setContentProtection` where supported.
- Audio routing is implemented as an OS-integration hook: the app will call PowerShell commands to list/set recording devices when available. Installing a virtual audio device (e.g., VB-Cable) is recommended.
- This scaffold follows Electron security best practices: `contextIsolation` is enabled and only minimal IPC surfaces are exposed via `preload.js`.
