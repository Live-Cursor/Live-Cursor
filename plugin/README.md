# Live Cursor for Obsidian

Live Cursor is an ultra-lightweight, zero-conflict real-time collaborative editing and configuration sync engine for Obsidian vaults. It brings real-time, conflict-free collaborative editing, live collaborator cursor tracking, and total vault synchronization to self-hosted markdown databases.

---

## Features

- **Real-Time Cursor Tracking**: View the live cursors and text selections of other vault editors inside your notes with custom user profiles.
- **Background Daemon Server**: Built-in platform-independent background engine that launches with a single click inside Obsidian—no terminals or external Docker installs required.
- **Config Sync Engine**: One-click bidirectional synchronization of settings, themes, and community plugins (your `.obsidian` configuration folder).
- **Admin Diagnostics**: Secure telemetry dashboard reporting uptime, connected rooms, memory utilization, and local SQLite/event-log database sizes.
- **Secure by Design**: Cryptographic verification gates all sync and administrative routes.

---

## Guided Setup Wizard

You can fully configure your server and collaborator sessions directly inside the Obsidian settings panel under the Live Cursor tab:

1. **Start Local Background Server**: Click Launch Local Server to start the built-in background sync daemon.
2. **Initialize Admin Account**: Provide a password to initialize your root administration credential registry.
3. **Register Collaborator**: Enter your editor username and password. The wizard will automatically create the user account on your server and save it.
4. **Complete and Sync**: Start editing! Collaborative cursors will appear in real time on any shared vault note.

---

## Advanced Developer Mode

Unlocking the Developer Mode switch in settings exposes additional, precise control parameters:

- **Direct Server URL**: View or modify the connection socket URL directly in plain text.
- **Direct Username**: Inspect and edit the active username.
- **Direct Password**: Inspect and edit the current session password credential.
- **Workspace Identifier**: Set a custom workspace namespace to isolate specific Vault configurations (defaults to `default-workspace`).
- **Debug Logging**: Prints detailed synchronization events and websocket status reports to the Obsidian console.
- **Auto-Sync On Load**: When enabled, runs config sync automatically 3 seconds after Obsidian starts.

---

## Submitting to the Obsidian Community Plugins Tab

To make this plugin downloadable directly from the official Community Plugins catalog inside Obsidian, follow these steps:

### 1. Build and Release
Compile the plugin code locally:
```bash
npm run build
```
This updates `main.js` and compiles the background daemon launcher. 

Create a new Release in your GitHub repository (`Live-Cursor/Live-Cursor`):
- Name the release exactly matching your version in `manifest.json` (e.g. `1.0.0`).
- Attach the following three compiled files as assets to the GitHub Release:
  1. `main.js`
  2. `manifest.json`
  3. `styles.css`

### 2. Submit to Obsidian Releases
1. Fork the official [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) repository on GitHub.
2. Edit `community-plugins.json` inside your fork and append your plugin configuration object at the end:
   ```json
   {
     "id": "live-cursor",
     "name": "Live Cursor",
     "author": "Live-Cursor Organization",
     "description": "Real-time collaborative editing and cursor tracking for Obsidian notes.",
     "repo": "Live-Cursor/Live-Cursor"
   }
   ```
3. Commit the change and submit a Pull Request to the `obsidian-releases` repository. The Obsidian development team will automatically review, verify compliance, and add it to the live catalog!

---

## License

This project is licensed under the MIT License.
