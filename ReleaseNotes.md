# Release Notes - Version 1.2.1

Version 1.2.1 introduces a massive architectural overhaul to the Live Cursor plugin, prioritizing performance, reliability, and true offline-first capability on constrained networks.

## Core Architectural Improvements

### WebRTC ICE Gathering Fix (Offline Hang Resolved)
Standard WebRTC implementations inherently wait for external STUN servers (like Google's) to resolve before establishing a connection. On a completely disconnected local network, this caused debilitating delays and hanging connections. We have introduced explicit WebRTC Configuration (`peerOpts`) that injects a short-circuit policy. By enforcing Trickle ICE with an `iceTransportPolicy` of `all` and `iceCandidatePoolSize: 0`, the plugin immediately prioritizes host (LAN) candidates. Connections over offline Android hotspots now occur in milliseconds.

### Strict Obsidian Lifecycle Memory Management
Obsidian's fluid workspace model means users frequently switch, split, and close panes. Previous iterations left orphaned `Y.Doc` and `WebrtcProvider` instances running in the background when a file was closed, leading to memory leaks and "ghost cursors". We implemented a strict garbage collection routine hooked directly into Obsidian's `layout-change` event. The plugin now actively monitors all panes; if a synchronized file is no longer active in any leaf, its WebRTC channels are immediately disconnected and the CRDT document is destroyed.

### Prevented Subnet Sweep Socket Exhaustion
To bypass Android mDNS blocking, the plugin utilizes an aggressive 255-address subnet sweep using raw WebSockets. In v1.2.1, we introduced a socket cleanup mechanism. As soon as `Promise.any` resolves the single winning connection to the host, the remaining 254 pending WebSocket connections are instantly aborted via `.close()`. This strictly prevents socket exhaustion and memory saturation on constrained mobile devices.

### Debounced Disk Sync Loop
Synchronizing an in-memory CRDT with physical `.md` files poses the risk of an infinite feedback loop (CRDT writes to disk -> disk modify triggers CRDT -> CRDT writes to disk). We have wrapped the Obsidian `vault.on('modify')` listener in a strict 300ms debounce loop per file. This ensures rapid disk writes are throttled, providing safe, bidirectional state reconciliation between the Yjs document and the physical file system without crashing the editor.

### TypeScript Compilation Target
Upgraded the compilation target and library to `ES2021` to provide native support for modern JavaScript APIs (`Promise.any`), ensuring cleaner compiled output and stability.
