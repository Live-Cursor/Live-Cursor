# Changelog

## [1.3.15] - 2026-05-27

### Fixed
- **Workspace Syncing Excluded**: Prevented syncing of device-specific configuration files such as `workspace.json`, `workspace-mobile.json`, and `workspaces.json`. This ensures device layouts and recent files lists don't conflict or get overwritten across devices.

## [1.3.14] - 2026-05-27

### Fixed
- **Immortal Files Bug**: Fixed a major edge case where files deleted from your local vault were never deleted from the server, causing the server to "undelete" and restore them on the next sync cycle (which is why old conflict files kept returning after being cleaned up). Added a secure `DELETE` endpoint to the sync server and hooked it directly into Obsidian's deletion events. Now, when you delete a file (or when the cleanup tool removes a conflict file), it is instantly and permanently destroyed across all devices.

## [1.3.13] - 2026-05-27

### Added
- **Full Background Vault Sync**: The plugin now continuously runs in the background just like Obsidian-LiveSync! Any time you create, rename, modify, or delete a file, it will automatically sync to the server in the background (debounced to 5 seconds). It also automatically polls the server every 30 seconds for remote changes made by other devices, ensuring your entire vault stays in perfect harmony without needing to open files or click buttons!
- **Silent CRDT Conflict Merging**: Updated the "Merge and Clean Up Conflict Files" command. Instead of inserting messy `<<<<<<< Original` markers, it now performs a true CRDT-style silent additive merge. It keeps all new text from both the original and conflict files and seamlessly unifies them, leaving your documents clean while ensuring zero data loss!

## [1.3.12] - 2026-05-27

### Added
- **Conflict File Cleanup and Merge Tool**: Added a new command "Merge and Clean Up Conflict Files" in the Obsidian command palette. This tool automatically scans your vault for any old duplicate `(Conflict from ...)` files left behind by older versions. It cleanly merges their contents directly into the original document using standard Git-style conflict markers (`<<<<<<< Original`, `=======`, `>>>>>>> Conflict`) and automatically deletes the loose conflict files so your vault is clean and CRDT syncing operates smoothly!

## [1.3.11] - 2026-05-27

### Fixed
- **Stopped Conflict File Explosion**: The sync engine was recursively syncing its own internal data files (`data/rooms/*.bin`) and old conflict copies, creating hundreds of duplicate files. Added comprehensive filters to block plugin internals, conflict copy files, and `Sync Conflicts/` directories from being synced.
- **Near-Zero Delay Live Sync**: Reduced the disk-to-Yjs reconciliation debounce from 300ms to 50ms and the server-side persistence debounce from 2000ms to 500ms, achieving near-instant live text propagation between devices.
- **Faster Cursor Visibility**: Reduced the awareness broadcast delay from 150ms to 50ms with a follow-up ping at 500ms, ensuring remote cursors appear instantly when a peer connects.

## [1.3.10] - 2026-05-27

### Added
- Redesigned conflict copy behavior: Conflict files are now created side-by-side inside the original directory instead of in a separate root directory. They are named `[Filename] (Conflict from [Device/User]).[Ext]` to make it easy for users to compare, edit, or move them side-by-side with the original file.
- Confirmed full symmetric 2-way vault sync. Resolved mobile connection issues that caused aborted sync processes, ensuring complete bidirectionality.

## [1.3.9] - 2026-05-27

### Fixed
- Fixed a critical "parent folder not found" directory creation bug during client file sync. Bypassed the ignored path check when creating parent directories to ensure directories like `Sync Conflicts` and other nested subfolders are successfully created before writing files.
- Normalized Windows backslashes `\` to standard `/` during directory path creation checks to guarantee seamless cross-platform compatibility on Android and iOS.

## [1.3.8] - 2026-05-27

### Added
- Added robust on-the-fly Server Connection URL normalization. Users can now enter connection URLs in any format (e.g. `http://IP`, `ws://IP`, or raw `IP:port` without a protocol, with or without trailing slashes/paths). The plugin will automatically format them correctly for both WebSocket collaboration and HTTP file sync.
- Added detailed error reporting notices on the client. If file synchronization fails, the exact network/system error message is now displayed in the Notice alert instead of a generic failure message.
- Added detailed HTTP routing and status logs to `server.js` for easier remote connection diagnostics.

## [1.3.7] - 2026-05-27

### Fixed
- Fixed an issue where the remote user cursors were completely invisible due to an upstream dependency overriding the plugin's CSS theme styles.
- Ensured username tags and cursor dots are prominently visible with the user's chosen custom color.
- Fixed a bug where changing the server connection URL or room name required restarting the Obsidian application to take effect. The "Full Vault Sync" engine now correctly honors URL and Room changes dynamically.

## [1.3.6] - 2026-05-26

### Added
- Re-architected the "Full Vault Sync" mechanism to work entirely without a CouchDB/database dependency. It now uses a highly efficient, lightweight file-system synchronization engine locally on the node daemon.
- Resolved multiple critical bugs in the internal WebSocket handling that caused the daemon process to lose database documents upon connection drop.
- Fixed a TypeScript compile error (`cm.isDestroyed`) causing instability during editor binding.
