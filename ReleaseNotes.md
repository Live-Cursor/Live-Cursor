# Release Notes - Version 1.2.5

Version 1.2.5 brings crucial network optimization and stability fixes to make local network collaboration seamless and reliable, especially on mobile devices.

## Highlights of 1.2.5

### 🚀 Batched Subnet Sweeping (Mobile Network Fix)
Previously, the "Find Local Host on Subnet" feature fired 254 simultaneous WebSocket connection attempts to scan the local subnet. While this works on powerful desktop environments, mobile WebViews (on both iOS and Android) have strict browser-level concurrent socket limits. This led to silent connection queueing, timeouts, and failure to discover the host even when it was on the same network. 
* We have refactored the discovery engine to scan in **highly efficient, controlled batches of 30 concurrent sockets**.
* This avoids mobile OS throttling, prevents browser socket exhaustion, and allows the phone to find your PC's local server in seconds.

### 🛠️ TypeScript & IDE Environment Stability
* Fixed an issue where the IDE/compiler could report `"Cannot find name 'require'"` due to empty typescript types.
* Updated `tsconfig.json` to explicitly register Node typings while retaining standard bundler settings.
