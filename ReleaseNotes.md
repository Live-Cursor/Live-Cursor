# Release Notes — Version 1.3.10

## What's New in 1.3.10

### 📂 Side-by-Side Conflict Resolution
- **No More Root Folders**: Redesigned conflict copy behavior to save conflicting edits side-by-side inside the original directory instead of writing to a separate root directory.
- **Human-Readable Suffixes**: Conflicts are now written as `[Filename] (Conflict from [Device/User]).[Ext]` alongside the original file. This allows users to easily see conflicts, review/merge differences, and clean them up right from their vault file tree!

### 🔄 Fully Symmetric 2-Way Synchronization
- **Completed Multi-Device Sync**: Confirmed that the database-free sync successfully handles two-way updates (laptop -> server -> phone and phone -> server -> laptop).
- **Network Resiliency**: Fixed connection dropouts on the client that were causing partial/one-way-looking sync behaviors due to aborted transfers.
