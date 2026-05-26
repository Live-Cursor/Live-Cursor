# Release Notes — Version 1.3.9

## What's New in 1.3.9

### 🐛 Critical Folder Creation Bug Fix (Android & iOS)
- **Bypassed Filter Blocks during writes**: Fixed a critical "parent folder not found" error during file download/sync. The directory creation utility (`ensureDirExists`) was mistakenly skipping the creation of parent folders (such as `Sync Conflicts`) if those folders were registered as "ignored" for the purposes of normal file scans.
- **Cross-Platform Path Normalization**: Added robust normalization to convert any Windows backslashes (`\`) to forward slashes (`/`) when evaluating directory paths on Android and iOS devices, ensuring consistent file writing behavior.
