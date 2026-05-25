# Release Notes - Version 1.2.7

Version 1.2.7 fixes a critical synchronization bug where starting the local rooms server did not automatically reconnect active editor tabs to the local signaling instance.

## Highlights of 1.2.7

### 🛠️ Fixed Host Reconnection (Start Syncing Instantly!)
* Previously, when you started the server on your PC using the ribbon icon, the active sync provider was not notified to reconnect. It remained connected to the public cloud server in the background, keeping both devices on separate servers.
* We have fixed this behavior so that clicking the "Host/Stop Local Room Server" action now instantly reinitializes and reconnects all active documents to the correct server.
* Connecting your PC and Phone will now occur immediately without needing to close and re-open files!
