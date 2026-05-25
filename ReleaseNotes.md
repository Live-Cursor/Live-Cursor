# Release Notes — Version 1.3.2

Version 1.3.2 is a **critical connectivity fix** that makes the plugin actually work out of the box.

---

## What Was Wrong (and Why 1.3.1 Didn't Work)

The plugin was defaulting to `wss://signaling.yjs.dev` — a **community-run public WebSocket server** that is frequently offline, rate-limited, or blocked. This caused the plugin to silently fail with no feedback, leaving the status bar stuck on "Standby" forever.

---

## What's New in 1.3.2

### 🏠 Local-First by Default
The plugin now defaults to **`ws://localhost:4444`** — your own private server — instead of the unreliable public signaling server. No third parties, no rate limits, no downtime.

### 🟢 Real Connection Status
The status bar now shows the **actual connection state** in real time:
- `🟢 1 synced` — connected and syncing
- `🟡 Connecting...` — attempting connection
- `🔴 Disconnected` — connection lost (auto-retry in progress)
- `⚪ Standby` — no file open yet

### 🖥️ Start Server from Settings
New **"▶ Start Local Server"** button in the Settings panel. Click it to launch your private sync server directly from Obsidian — no terminal required (desktop only).

### 🔄 Auto-Retry with Backoff
If the connection drops, the plugin automatically retries up to 5 times (3s → 6s → 12s → 24s → 60s). After 5 failed attempts, a helpful notice tells you exactly what to do.

### 🔄 Reconnect Button
New **"Reconnect"** button in Settings to immediately force a reconnection with the current URL — useful after changing settings or starting the server.

### 📱 Mobile Setup Guidance
The settings panel now shows **clear instructions** for connecting mobile devices, including exactly what command to run to find your PC's local IP.

---

## How to Use

### Desktop (Same Machine)
1. Open **Settings → Live Cursor**
2. Click **"▶ Start Local Server"** — status turns 🟢
3. Open any note — it syncs automatically

### Cross-Device (PC + Phone on Same Wi-Fi)
1. Start the local server on your PC (step above)
2. Find your PC's IP: run `ipconfig` in Command Prompt
3. On each device, set **Server URL** to `ws://YOUR_PC_IP:4444`
4. Use the same **Room Name** on all devices
5. Open the same note — cursors appear in real time ✨
