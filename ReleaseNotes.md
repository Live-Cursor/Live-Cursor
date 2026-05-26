# Release Notes — Version 1.3.7

## What's New in 1.3.7

### ✨ Cursors & Styling Fixes
- **Remote Cursors Now Visible**: Fixed an issue where remote user cursors and name tags were completely invisible. We overrode the upstream `y-codemirror.next` default theme which was aggressively hiding the cursor dot and setting the username label's opacity to 0.
- **Premium Visibility**: Ensured username tags and cursor dots are prominently visible with the user's chosen custom color at all times, identical to professional collaborative editors.

### 🐛 Sync Engine Fixes
- **Dynamic Configuration Updates**: Fixed a critical bug where changing the server connection URL or room name required restarting the entire Obsidian application to take effect. The "Full Vault Sync" engine now automatically and dynamically honors URL and Room changes the exact moment you type them in the settings menu.
