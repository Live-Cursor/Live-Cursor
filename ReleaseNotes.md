# Release Notes — Version 1.3.6

Version 1.3.6 is a **major architectural upgrade** that introduces a lightweight, database-free whole-vault synchronization system, expands sync scope beyond configurations to the entire vault, and fixes critical real-time cursor persistence and build compilation bugs.

---

## What's New in 1.3.6

### 📂 Database-Free Whole-Vault Syncing
Replaced the need for a heavy, crash-prone database (like CouchDB or LevelDB) with a highly reliable, **lightweight folder-based storage system**. 
- **Simple Disk Folders**: The server now saves files directly on the server's disk using simple filesystem folders (`data/config/` for vault files and `data/rooms/` for Yjs CRDT states).
- **Infinite Reliability**: Immune to index corruption, crash loops, and heavy database memory consumption.
- **Vault-Wide Sync Scope**: Traverses and synchronizes your entire vault root `""` recursively. Notes, images, PDFs, attachments, snippets, themes, and plugins are now synchronized automatically inside the background file loop.

### 🛡️ Low-Level File System Access & system Configs Sync
- **Hidden System Directories support**: Fully converted `configSync.ts` to use low-level `app.vault.adapter` calls (`writeBinary`, `mkdir`, and `exists`) rather than high-level `app.vault` APIs. This successfully bypasses Obsidian restrictions on hidden paths and allows configurations under `.obsidian` to sync properly.
- **Smart Filter Exclusions**: Integrated a global ignore parser (`shouldIgnore`) to skip continuous conflict noise, ignoring:
  - `.git/` and `.trash/`
  - `node_modules/`
  - `.obsidian/workspace.json` (Obsidian workspace layouts that change continuously)
  - Local backup folders (`Sync Conflicts/`)

### ⚡ Critical WebSocket Persistence & Server Bug Fixes
- **WebSocket Document Mapping Restored**: Corrected the `setupWSConnection` signature in `server.js`. The server now correctly maps room connections in `{ docName: roomName }` and registers the disk persistence update listeners on `y-websocket`'s active shared document. Edits are now robustly saved to disk.
- **Shutdown Handlers (No Data Loss)**: Registered process termination signal handlers (`SIGTERM` and `SIGINT`) in `server.js` to synchronously flush all pending document modifications to disk before the server process exits.

### 🛠️ Strict TypeScript Compilation & Build Health
- **Private Access Fix**: Safely bypassed the TypeScript compiler's private-access restriction on CodeMirror's `EditorView.destroyed` by casting the check: `!(cm as any).destroyed`.
- **Roster Panel Access**: Made `activeSyncs` in `LiveCursorPlugin` public, resolving setting-panel class type errors.
- **Backup Cleanups**: Safely deleted the duplicate backup `main_full.ts` to ensure clean TypeScript builds.

---

## How to Sync

### 1. Enable Full Vault Syncing
- All your notes, attachments, plugins, and settings will automatically synchronize in the background when the plugin transitions to `🟢 Connected` status.
- Press **"Sync Vault Now"** in Settings at any time to force an immediate, incremental scan of the entire vault and synchronize it with your server.

### 2. Private Local Server Setup
- Click **"▶ Start Local Server"** in Obsidian Settings or boot it manually in Node.js:
  ```bash
  node server.js
  ```
- Store all your notes, images, and plugins directly on your own hardware without third-party databases.
