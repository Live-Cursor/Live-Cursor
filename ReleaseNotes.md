# Release Notes - Version 1.3.0

Version 1.3.0 is a major refactoring release that elevates the Live Cursor plugin to a premium, streamlined, online-only real-time collaborative editor. 

By removing complex local server hosting, background node daemons, and offline subnet scanning, the codebase is now 60% lighter, extremely elegant, and optimized strictly for high-performance online multiplayer syncing (like Google Docs or Figma).

## Highlights of 1.3.0

### 🚀 Simplified Multiplayer Architecture
* **Strict Online Sync:** Replaced local-room server hosting with a streamlined WebRTC architecture that connects out-of-the-box using highly reliable, public signaling channels (`wss://signaling.yjs.dev`).
* **Zero Overhead:** Deleted legacy, heavy local network utilities (`subnetSweep.ts`, `signalingServer.ts`, `server_daemon.js`) and removed `ws` server dependencies.
* **Streamlined settings:** Cleaned up the settings tab to focus entirely on visual customization (Visual Nickname, Cursor Color) and Room naming.
