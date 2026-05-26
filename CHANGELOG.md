# Changelog

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
