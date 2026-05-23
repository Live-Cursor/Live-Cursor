# Live Cursor for Obsidian

Live Cursor is an ultra-lightweight, zero-conflict real-time collaborative editing and configuration sync engine for Obsidian vaults. It brings real-time collaborative editing, live collaborator cursor tracking, and total vault synchronization across devices without complex setups.

---

## Architecture & Connection Modes

Live Cursor is built with **Simplicity** in mind. We know setting up sync servers can be painful, so we’ve abstracted the technology into three seamless Connection Modes. Whether you are working across the room, across a corporate VPN, or from your mobile phone on a train, Live Cursor just works.

### 1. Host Local (LAN/Tailscale) 
**Best for:** Desktop users who want a quick, private sync session with other computers on their Wi-Fi or VPN.

- **How it works:** When you click "Start Local Host" on a Desktop PC, Live Cursor silently spins up a lightweight Node.js background websocket daemon. It automatically scans your network interfaces and gives you ready-to-use IP addresses (e.g., `ws://192.168.x.x:1234/sync`).
- **Simplicity:** No terminals, no Docker, no configuration files. One click and your PC is the server.
- **Limitations:** Only works on Desktop OS (Windows, Mac, Linux). Mobile devices (iOS/Android) cannot act as the "Host" in this mode because mobile operating systems block background TCP port binding. Mobile devices **can** easily join this host, but they cannot *be* the host.

### 2. WebRTC P2P (Mobile Friendly)
**Best for:** Mobile users, serverless setups, and true Peer-to-Peer synchronization.

- **How it works:** This mode uses a decentralized WebRTC mesh network powered by `y-webrtc`. Instead of a central server, devices connect directly to each other using a shared "Room Name" and "Password".
- **Serverless Vault Config Sync:** Usually, syncing your `.obsidian` configuration files (themes, plugins) requires an HTTP server. Live Cursor elegantly bypasses this limitation on Mobile by pushing your configuration files directly over WebRTC Data Channels using a shared `Y.Map`. **This means your mobile phone can fully act as a "Server" for configurations and real-time editing without needing a Node.js daemon.**
- **Simplicity:** Enter a Room Name, and you are instantly syncing. No IPs, no port forwarding.
- **Limitations:** Requires an active internet connection to briefly hit public WebRTC signaling servers (which only facilitate the initial peer handshake, not the data itself).

### 3. Cloud Server 
**Best for:** Enterprise teams, 24/7 always-on sync environments, and heavy multi-user collaboration.

- **How it works:** You deploy the background daemon (via Docker or Node) on a dedicated cloud VPS (like DigitalOcean, AWS, or a Raspberry Pi). You then point your Live Cursor settings to that `ws://` URL.
- **Simplicity:** The plugin natively generates standard Docker Compose templates for you under the "Advanced Developer Settings" if you want to self-host.
- **Limitations:** Requires technical knowledge to deploy a cloud server, setup DNS, and manage SSL/TLS if you want secure web-socket (`wss://`) traffic.

---

## Features

- **Real-Time Cursor Tracking**: View the live cursors and text selections of other vault editors inside your notes with custom user profiles and dynamic hex colors.
- **Config Sync Engine**: One-click bidirectional synchronization of settings, themes, and community plugins (your `.obsidian` configuration folder). Handles file conflicts gracefully by moving conflicted copies into a designated `Sync Conflicts/` folder while preserving directory structures.
- **Admin Diagnostics**: Secure telemetry dashboard reporting uptime, connected rooms, memory utilization, and local SQLite/event-log database sizes (available on dedicated cloud instances).
- **Zero-Conflict JSON Merge**: Automatically attempts to deep-merge standard plugin configurations before falling back to manual review.

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
