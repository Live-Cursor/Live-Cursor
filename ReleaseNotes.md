# Release Notes — Version 1.3.5

Version 1.3.5 is a **major milestone release** that brings highly anticipated real-time cursor visualizations, a complete synchronization engine for plugins, themes, and settings, a live collaborators roster, and critical stability fixes to the Live Cursor platform.

---

## What's New in 1.3.5

### 👥 Real-Time Remote Cursors & Selections (Fully Restored!)
The signature feature of **Live Cursor** is now fully functional! Real-time collaborator cursors and selection ranges are beautifully visualized directly inside the editor:
- **Visual Cursor Flags**: Remote collaborator cursors are decorated with their custom username tags and distinct, harmonious colors.
- **Selection Highlights**: Highlighting text dynamically draws colored selection ranges in the editor of all connected peers.
- **Under-the-Hood Fixes**:
  - Resolved a core binding issue where Yjs awareness was not properly propagated to the CodeMirror `yCollab` extension.
  - Fixed an editor-mount race condition so remote cursors are rendered immediately upon connecting without requiring the peer to move their cursor.
  - Implemented strict decoration coordinate sorting and safety boundaries to prevent silent CodeMirror `Decoration.set` crashes.

### 🔄 Full Vault Synchronization (Plugins, Themes, Snippets, & Settings)
Taking collaboration beyond simple text editing, Version 1.3.5 introduces **Full Vault Synchronization**:
- **Total Workspace Parity**: Real-time sync now manages your entire Obsidian workspace — including themes, CSS snippets, active plugins, and core settings.
- **Config Sync Engine**: An intelligent background manager hashes configuration files, detects changes, and uploads/downloads workspace updates.
- **REST Sync API**: The self-hosted server (`server.js`) has been upgraded with lightweight REST endpoints (`/api/manifest`, `/api/upload`, `/api/download`) to handle secure config transfers.

### 📋 Live Connected Collaborators Roster
Inside the Settings panel, you can now see exactly who is co-authoring with you:
- A real-time, reactive list of all active users currently connected to your room.
- Displays active usernames, distinct connection colors, and internal client IDs for debugging and transparency.

### ⚡ Stability & Sync Bug Fixes
- **Duplicate Text Resolution**: Solved a notorious synchronization issue where text blocks would duplicate or triplicate during concurrent sync handshake processes.
- **Reliable Reconnections**: Refined the automatic reconnection loops, boosting retries to 20 cycles with intelligent backoff intervals to ensure background processes never drop permanently.

---

## How to Use

### 1. Enable Real-Time Text Collaboration
1. Ensure your self-hosted server is running (click **"▶ Start Local Server"** in Settings or run `node server.js`).
2. Make sure all devices are connected to the same **Server URL** and use the exact same **Room Name**.
3. Open any note — you will instantly see your collaborators' cursors, selection marks, and name tags as they type!

### 2. Syncing Vault Configurations (Plugins, Themes, Settings)
- The plugin automatically checks and synchronizes your workspace configurations when it transitions to the `🟢 Connected` state.
- Keep your Obsidian workflow, styling, and keyboard shortcuts completely uniform across your phone, tablet, and desktop without manual intervention!
