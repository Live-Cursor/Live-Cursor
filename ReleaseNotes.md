# Release Notes — Version 1.3.8

## What's New in 1.3.8

### 🚀 Ultra-Robust Connection URL Normalization
- **Flexible Formats Supported**: You can now enter your Server Connection URL in absolutely any format (e.g. `http://100.76.247.27:4444`, `100.76.247.27:4444`, or `ws://100.76.247.27:4444/sync/`).
- **Zero-Config Normalization**: The plugin automatically detects and normalizes the protocol, trailing slashes, and paths on the fly. It guarantees that WebSockets always connect via `ws://`/`wss://` and the config sync API always runs via `http://`/`https://` cleanly, completely eliminating silent connection crashes from typos.

### 📋 Detailed Error Notices
- **Pinpoint Network Issues**: Replaced the generic *"Sync failed. Check server connection."* message with a **detailed, real-time error report notice** (e.g. `Sync failed: Server returned HTTP 500` or `Sync failed: TypeError: Failed to fetch`). If anything goes wrong at the network layer on your phone, you will see exactly why instantly.

### 💻 Diagnostics & Logging
- **HTTP Endpoint Logs**: Added detailed server-side logging for all sync actions (`/api/manifest`, `/api/upload`, `/api/download`) so developers and users can easily trace incoming connection traffic in the Node daemon.
