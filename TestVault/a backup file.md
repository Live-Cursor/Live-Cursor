# Reddit Showcase Draft: Live Cursor for Obsidian

Below is a complete, ready-to-publish Reddit post designed for subreddits like r/obsidianmd, r/selfhosted, and r/PKM. It is styled to sound authentic, engineering-focused, and completely free of emojis or marketing hype.

---

**Subreddit Suggestion:** r/obsidianmd or r/selfhosted
**Suggested Title:** I built Live Cursor: A self-hosted, zero-configuration real-time collaborative editing and config sync plugin for Obsidian

---

### Post Content

Over the past few months, I have been working on a solution to a problem that a lot of us in the self-hosted and markdown communities face: real-time collaboration inside Obsidian. 

While there are paid cloud sync solutions or complex git setups, there hasn't been a simple, zero-friction way to collaborate on notes with others in real time while maintaining complete control over your private data.

To solve this, I built **Live Cursor**—an ultra-lightweight, zero-conflict real-time collaborative editing and settings sync plugin for Obsidian.

The repository is fully public and open-source: https://github.com/Live-Cursor/Live-Cursor

### What makes it different?

Most collaborative markdown engines require hosting separate database servers, setting up complex Docker networks, or relying on third-party cloud architectures. Live Cursor is designed to be completely self-bootstrapping.

It includes a built-in background engine daemon. When you install the plugin, it can spawn a sandboxed Node.js WebSocket and SQLite server process directly on your local machine with a single click inside the Obsidian settings panel. You do not need to open a terminal or run external configuration scripts.

### Key Features:

* **Real-Time Cursor Tracking:** View the live cursor positions and active text selections of other editors in your notes in real time, featuring customizable profile colors.
* **Conflict-Free Synchronization:** Built on high-performance operational sync nodes to guarantee zero-conflict concurrent typing.
* **Vault Configuration Sync:** Provide one-click, bidirectional synchronization of themes, community plugins, snippets, and workspaces (your entire .obsidian configuration folder) between desktop and mobile devices.
* **Admin Telemetry Dashboard:** Includes a secure admin panel in your settings to monitor connected collaborator rooms, server uptime, database footprint, and active sync events.
* **Secure Permissions:** All administrative actions and registrations are gated using SHA-256 validation. Standard collaborators are registered securely by the admin directly from the dashboard.

### How it works under the hood:

The plugin utilizes a lightweight client-side synchronization engine that hooks directly into Obsidian’s markdown editor. The background daemon spawns a local server that handles database state mutations and room connections using high-performance WebSockets. 

It isolates vaults and workspaces using unique namespaces, meaning you can run multiple independent vaults across different collaborator groups without any cross-talk or metadata leaks.

### Looking for feedback and testers

The plugin is fully built, compiled, and the v1.0.0 release is live on GitHub. I am preparing to submit it to the official Obsidian Community Plugins directory today.

I would love to get your feedback on the setup flow, performance, and general usability. If you have a local workspace or edit notes across multiple devices with teammates, please give it a run.

GitHub Repository: https://github.com/Live-Cursor/Live-Cursor

Any bug reports, feature suggestions, or pull requests are highly appreciated. Let me know what you think!


Hekkif# Reddit Showcase Draft: Live Cursor for Obsidian

Below is a complete, ready-to-publish Reddit post designed for subreddits like r/obsidianmd, r/selfhosted, and r/PKM. It is styled to sound authentic, engineering-focused, and completely free of emojis or marketing hype.

---

**Subreddit Suggestion:** r/obsidianmd or r/selfhosted
**Suggested Title:** I built Live Cursor: A self-hosted, zero-configuration real-time collaborative editing and config sync plugin for Obsidian

---

### Post Content

Over the past few months, I have been working on a solution to a problem that a lot of us in the self-hosted and markdown communities face: real-time collaboration inside Obsidian. 

While there are paid cloud sync solutions or complex git setups, there hasn't been a simple, zero-friction way to collaborate on notes with others in real time while maintaining complete control over your private data.

To solve this, I built **Live Cursor**—an ultra-lightweight, zero-conflict real-time collaborative editing and settings sync plugin for Obsidian.

The repository is fully public and open-source: https://github.com/Live-Cursor/Live-Cursor

### What makes it different?

Most collaborative markdown engines require hosting separate database servers, setting up complex Docker networks, or relying on third-party cloud architectures. Live Cursor is designed to be completely self-bootstrapping.

It includes a built-in background engine daemon. When you install the plugin, it can spawn a sandboxed Node.js WebSocket and SQLite server process directly on your local machine with a single click inside the Obsidian settings panel. You do not need to open a terminal or run external configuration scripts.

### Key Features:

* **Real-Time Cursor Tracking:** View the live cursor positions and active text selections of other editors in your notes in real time, featuring customizable profile colors.
* **Conflict-Free Synchronization:** Built on high-performance operational sync nodes to guarantee zero-conflict concurrent typing.
* **Vault Configuration Sync:** Provide one-click, bidirectional synchronization of themes, community plugins, snippets, and workspaces (your entire .obsidian configuration folder) between desktop and mobile devices.
* **Admin Telemetry Dashboard:** Includes a secure admin panel in your settings to monitor connected collaborator rooms, server uptime, database footprint, and active sync events.
* **Secure Permissions:** All administrative actions and registrations are gated using SHA-256 validation. Standard collaborators are registered securely by the admin directly from the dashboard.

### How it works under the hood:

The plugin utilizes a lightweight client-side synchronization engine that hooks directly into Obsidian’s markdown editor. The background daemon spawns a local server that handles database state mutations and room connections using high-performance WebSockets. 

It isolates vaults and workspaces using unique namespaces, meaning you can run multiple independent vaults across different collaborator groups without any cross-talk or metadata leaks.

### Looking for feedback and testers

The plugin is fully built, compiled, and the v1.0.0 release is live on GitHub. I am preparing to submit it to the official Obsidian Community Plugins directory today.

I would love to get your feedback on the setup flow, performance, and general usability. If you have a local workspace or edit notes across multiple devices with teammates, please give it a run.

GitHub Repository: https://github.com/Live-Cursor/Live-Cursor

Any bug reports, feature suggestions, or pull requests are highly appreciated. Let me know what you think!


Hekkif# Reddit Showcase Draft: Live Cursor for Obsidian

Below is a complete, ready-to-publish Reddit post designed for subreddits like r/obsidianmd, r/selfhosted, and r/PKM. It is styled to sound authentic, engineering-focused, and completely free of emojis or marketing hype.

---

**Subreddit Suggestion:** r/obsidianmd or r/selfhosted
**Suggested Title:** I built Live Cursor: A self-hosted, zero-configuration real-time collaborative editing and config sync plugin for Obsidian

---

### Post Content

Over the past few months, I have been working on a solution to a problem that a lot of us in the self-hosted and markdown communities face: real-time collaboration inside Obsidian. 

While there are paid cloud sync solutions or complex git setups, there hasn't been a simple, zero-friction way to collaborate on notes with others in real time while maintaining complete control over your private data.

To solve this, I built **Live Cursor**—an ultra-lightweight, zero-conflict real-time collaborative editing and settings sync plugin for Obsidian.

The repository is fully public and open-source: https://github.com/Live-Cursor/Live-Cursor

### What makes it different?

Most collaborative markdown engines require hosting separate database servers, setting up complex Docker networks, or relying on third-party cloud architectures. Live Cursor is designed to be completely self-bootstrapping.

It includes a built-in background engine daemon. When you install the plugin, it can spawn a sandboxed Node.js WebSocket and SQLite server process directly on your local machine with a single click inside the Obsidian settings panel. You do not need to open a terminal or run external configuration scripts.

### Key Features:

* **Real-Time Cursor Tracking:** View the live cursor positions and active text selections of other editors in your notes in real time, featuring customizable profile colors.
* **Conflict-Free Synchronization:** Built on high-performance operational sync nodes to guarantee zero-conflict concurrent typing.
* **Vault Configuration Sync:** Provide one-click, bidirectional synchronization of themes, community plugins, snippets, and workspaces (your entire .obsidian configuration folder) between desktop and mobile devices.
* **Admin Telemetry Dashboard:** Includes a secure admin panel in your settings to monitor connected collaborator rooms, server uptime, database footprint, and active sync events.
* **Secure Permissions:** All administrative actions and registrations are gated using SHA-256 validation. Standard collaborators are registered securely by the admin directly from the dashboard.

### How it works under the hood:

The plugin utilizes a lightweight client-side synchronization engine that hooks directly into Obsidian’s markdown editor. The background daemon spawns a local server that handles database state mutations and room connections using high-performance WebSockets. 

It isolates vaults and workspaces using unique namespaces, meaning you can run multiple independent vaults across different collaborator groups without any cross-talk or metadata leaks.

### Looking for feedback and testers

The plugin is fully built, compiled, and the v1.0.0 release is live on GitHub. I am preparing to submit it to the official Obsidian Community Plugins directory today.

I would love to get your feedback on the setup flow, performance, and general usability. If you have a local workspace or edit notes across multiple devices with teammates, please give it a run.

GitHub Repository: https://github.com/Live-Cursor/Live-Cursor

Any bug reports, feature suggestions, or pull requests are highly appreciated. Let me know what you think!


Hekkif# Reddit Showcase Draft: Live Cursor for Obsidian

Below is a complete, ready-to-publish Reddit post designed for subreddits like r/obsidianmd, r/selfhosted, and r/PKM. It is styled to sound authentic, engineering-focused, and completely free of emojis or marketing hype.

---

**Subreddit Suggestion:** r/obsidianmd or r/selfhosted
**Suggested Title:** I built Live Cursor: A self-hosted, zero-configuration real-time collaborative editing and config sync plugin for Obsidian

---

### Post Content

Over the past few months, I have been working on a solution to a problem that a lot of us in the self-hosted and markdown communities face: real-time collaboration inside Obsidian. 

While there are paid cloud sync solutions or complex git setups, there hasn't been a simple, zero-friction way to collaborate on notes with others in real time while maintaining complete control over your private data.

To solve this, I built **Live Cursor**—an ultra-lightweight, zero-conflict real-time collaborative editing and settings sync plugin for Obsidian.

The repository is fully public and open-source: https://github.com/Live-Cursor/Live-Cursor

### What makes it different?

Most collaborative markdown engines require hosting separate database servers, setting up complex Docker networks, or relying on third-party cloud architectures. Live Cursor is designed to be completely self-bootstrapping.

It includes a built-in background engine daemon. When you install the plugin, it can spawn a sandboxed Node.js WebSocket and SQLite server process directly on your local machine with a single click inside the Obsidian settings panel. You do not need to open a terminal or run external configuration scripts.

### Key Features:

* **Real-Time Cursor Tracking:** View the live cursor positions and active text selections of other editors in your notes in real time, featuring customizable profile colors.
* **Conflict-Free Synchronization:** Built on high-performance operational sync nodes to guarantee zero-conflict concurrent typing.
* **Vault Configuration Sync:** Provide one-click, bidirectional synchronization of themes, community plugins, snippets, and workspaces (your entire .obsidian configuration folder) between desktop and mobile devices.
* **Admin Telemetry Dashboard:** Includes a secure admin panel in your settings to monitor connected collaborator rooms, server uptime, database footprint, and active sync events.
* **Secure Permissions:** All administrative actions and registrations are gated using SHA-256 validation. Standard collaborators are registered securely by the admin directly from the dashboard.

### How it works under the hood:

The plugin utilizes a lightweight client-side synchronization engine that hooks directly into Obsidian’s markdown editor. The background daemon spawns a local server that handles database state mutations and room connections using high-performance WebSockets. 

It isolates vaults and workspaces using unique namespaces, meaning you can run multiple independent vaults across different collaborator groups without any cross-talk or metadata leaks.

### Looking for feedback and testers

The plugin is fully built, compiled, and the v1.0.0 release is live on GitHub. I am preparing to submit it to the official Obsidian Community Plugins directory today.

I would love to get your feedback on the setup flow, performance, and general usability. If you have a local workspace or edit notes across multiple devices with teammates, please give it a run.

GitHub Repository: https://github.com/Live-Cursor/Live-Cursor

Any bug reports, feature suggestions, or pull requests are highly appreciated. Let me know what you think!


Hekkif