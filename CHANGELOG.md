# Changelog

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
