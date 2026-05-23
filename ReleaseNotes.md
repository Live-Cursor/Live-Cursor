# Live Cursor v1.1.5 Release Notes

**v1.1.5 Feature Upgrades:**
- **Human Readable Conflicts:** When file sync conflicts occur, the conflicting files are now intelligently separated into `Sync Conflicts/Local/` and `Sync Conflicts/Remote/` folders. Crucially, they perfectly retain their original `.md` extensions and nested folder structures, so you can easily browse, read, and merge them natively inside the Obsidian UI!

**v1.1.4 Hotfixes:**
- **UI Visibility Fix:** Files downloaded from the WebRTC Mesh now instantly appear in the Obsidian File Explorer UI! Previously, the engine used a low-level disk adapter which bypassed Obsidian's indexing cache, requiring a restart to see the files.

**v1.1.3 Feature Upgrades:**
- **Full Vault Sync Engine:** The syncing engine has been entirely rewritten. You can now sync your ENTIRE vault (every single `.md` note, not just your settings) *directly from your phone* over decentralized WebRTC data channels! Just click "Sync Entire Vault"!
- Resolved a critical silent TypeScript bug in the Full Vault Sync engine that would have caused crashes during initial peer connections.
- Strict compiler enforcement (`tsc --noEmit`) added to the build pipeline for ironclad stability.

---

# Live Cursor v1.1.0 Major Update

Welcome to the biggest update to Live Cursor since launch! We've listened to your feedback and completely revolutionized how synchronization works on mobile devices while drastically simplifying the user interface.

## Mobile WebRTC Mesh (New Feature!)
Mobile devices (iOS/Android) historically struggled with hosting background sync servers due to OS restrictions. **No more.**
- **True P2P Mesh:** Live Cursor now natively implements `y-webrtc`. You can now select **WebRTC P2P (Mobile Friendly)** mode from the settings to instantly create a persistent, background serverless sync room. 
- **Full Vault Sync Engine:** The syncing engine has been entirely rewritten. You can now sync your ENTIRE vault (every single `.md` note, not just your settings) *directly from your phone* over decentralized WebRTC data channels! Just click "Sync Entire Vault"!

## Completely Redesigned UI
The settings panel has been rebuilt from the ground up to be ultra-intuitive for everyday users:
- **3 Simple Connection Modes:** Quickly toggle between *Host Local (LAN)*, *Cloud Server*, and *WebRTC P2P*.
- **Automated LAN Hosting:** Clicking "Host Local" on a desktop now automatically spins up the background Node.js daemon and automatically detects and displays your local Wi-Fi and Tailscale IP addresses. Just copy and paste the link to your peers!
- **Dynamic Connection UI:** Complex developer settings are now neatly tucked away in an "Advanced Settings" dropdown.

## Enhancements & Bug Fixes
- **Intelligent JSON Collision Handling:** Merging `.obsidian` configuration files during sync conflicts has been upgraded. We now perform a robust deep merge logic that properly handles plugin arrays without corrupting index positions.
- **Structural Conflict Backups:** In the rare case of unresolvable file conflicts, the sync engine now gracefully creates a `Sync Conflicts/` folder at the root of your vault. It preserves the exact subdirectory path of the conflicted file, giving you both a `.local.bak` and `.remote.bak` file for easy side-by-side resolution.
- **Timestamps Edge-Case Fix:** Mitigated an issue where cross-platform syncs (e.g., FAT32 vs NTFS file systems) could trigger endless looping syncs due to sub-second modification time mismatches.

## How to Update
Restart Obsidian or toggle the plugin off/on in your Community Plugins settings to trigger the new v1.1.0 logic. Keep an eye out for the new welcome pop-up on launch!
