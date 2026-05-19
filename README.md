# Obsidian Live Cursor 🚀

An ultra-lightweight, zero-conflict real-time collaborative editing and configuration backup engine for Obsidian. Live Cursor brings real-time Google Docs-like editing, live collaborator cursor tracking, and total vault synchronization to self-hosted markdown databases.

---

## 🌟 Features

- **Real-Time Cursor Sync**: See live cursors of other vault editors inside your notes with customizable user profiles.
- **Dynamic Portals**: Seamlessly switch between the **User Portal** (standard real-time sync) and **Admin Portal** (server-level administration).
- **Telemetry Admin Console**: Real-time server diagnostics reporting uptime, connected rooms, process memory footprint, and SQLite database size.
- **Collaborator Management**: Securely register standard synchronization users directly from the Admin Dashboard.
- **Config Sync Engine**: One-click bidirectional synchronization of themes, community plugins, and settings configuration (`.obsidian` folder).
- **Self-Bootstrapping**: Fresh servers dynamically present a "Register/Save" workflow, locking down automatically into a secure "Login" workflow once configured.

---

## ⚙️ General Control Panel Configuration

You can fully control your server connections and sessions via Obsidian's built-in Settings Panel (**Settings -> Community Plugins -> Live Cursor**):

### Option 1: Login Portal
- **Admin Portal**: Connect using the server administrator credentials. When a fresh server starts, the button will dynamically read **"Save"** so you can register your initial admin credentials. Once an admin is registered, the portal locks into a secure **"Login"** prompt.
- **User Portal**: Designed purely for standard collaborator access. Unauthenticated users cannot register accounts themselves here.

### Option 2: Server Connection
- Configure your primary backend WebSockets gateway URL (e.g. `ws://localhost:1234/sync`). This gateway supports full secure environments (`wss://`) for mobile device WebViews.

### Option 3: Create Local Server
- Click to copy a ready-to-run self-hosting script. This boots up a Dockerized WebSocket and Node.js SQLite server instantly on your local machine.

### Option 4: Config Synchronization
- Click **Sync Now** to securely sync plugins, snippets, and workspaces between instances. Perfect for keeping a desktop vault and mobile vault perfectly aligned!

---

## 🛠️ Advanced Developer Mode

By toggling the **Developer Mode** switch, you unlock powerful, low-level adjustments directly inside the settings tab:

| Setting Parameter | Description |
| :--- | :--- |
| **Direct Server URL** | Read/write the socket URL directly as plain text without using pop-up connection modals. |
| **Direct Username** | Read/write the active username directly in plain text. |
| **Direct Password** | Read/write the active credential key directly in plain text. |
| **Workspace Identifier** | Assign a custom workspace namespace to isolate specific Vault configurations (default: `default-workspace`). |
| **Debug Logging** | Toggle verbose console reporting to track socket states, Yjs transaction events, and WebSocket disconnect states inside developer tools. |
| **Auto-Sync On Load** | Enable this to run configuration synchronization automatically 3 seconds after Obsidian starts, ensuring your vault is always updated. |

---

## 📦 Docker Backend Setup

To host your own private server on your home network or private virtual machine:

1. Clone or download the backend repository.
2. In the folder containing the `docker-compose.yml`, execute:
   ```bash
   docker-compose up -d
   ```
3. Your server will instantly start listening on port `1234`.
4. Go to **Settings -> Live Cursor -> Option 1: Login** and select **Admin Portal** to configure your server.

---

## 🔒 Security Specifications

- All API routes and sync transactions are strictly validated using SHA-256 password hashing.
- Standard collaborator registration is entirely locked behind administrator privileges inside the **Admin Console** dashboard.
- Workspace parameters provide strong namespace isolation, preventing different collaborators from overwriting unrelated configuration sync nodes.
