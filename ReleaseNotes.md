# Release Notes - Version 1.2.6

Version 1.2.6 introduces smart, dynamic subnet discovery for mobile clients, enabling automatic host detection even on custom cellular hotspots.

## Highlights of 1.2.6

### 📡 Dynamic WebRTC Local IP Detection
* Mobile devices historically cannot access Node's `os` network interface APIs. Because of this, the plugin had to rely on a hardcoded list of common hotspot subnets (like `192.168.43.x` or `172.20.10.x`).
* If a mobile carrier or device used a custom IP range (e.g. `10.231.66.x`), discovery would fail to scan the correct subnet.
* We have introduced a **dynamic WebRTC ICE local IP resolver** for mobile clients. The plugin will now temporarily query the browser's peer connection stack to determine the phone's exact local interface IP and automatically sweep the matching subnet base.
* This works automatically without requiring any manual entry or hardcoded lists!
