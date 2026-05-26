import { App, requestUrl, Notice } from 'obsidian';

export interface FileManifest {
  [filePath: string]: {
    size: number;
    mtime: number;
    device?: string;
  };
}

function deepMerge(target: any, source: any): any {
  if (typeof target !== 'object' || target === null || typeof source !== 'object' || source === null) {
    return source !== undefined ? source : target;
  }
  if (Array.isArray(target) || Array.isArray(source)) {
    return source;
  }
  const merged = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object && key in target) {
      merged[key] = deepMerge(target[key], source[key]);
    } else {
      merged[key] = source[key];
    }
  }
  return merged;
}

/**
 * Filter mechanism to ignore temporary, transient, or large system files that 
 * cause conflict spam or should not be synced.
 */
function shouldIgnore(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  
  // Ephemeral/System directories
  if (
    normalized.startsWith('.git/') || normalized === '.git' ||
    normalized.startsWith('.trash/') || normalized === '.trash' ||
    normalized.startsWith('node_modules/') || normalized === 'node_modules' ||
    normalized.startsWith('Sync Conflicts/') || normalized === 'Sync Conflicts'
  ) {
    return true;
  }

  // Specific noise files
  if (
    normalized === '.obsidian/workspace.json' ||
    normalized.endsWith('/.DS_Store') || normalized === '.DS_Store' ||
    normalized.endsWith('/thumbs.db') || normalized === 'thumbs.db'
  ) {
    return true;
  }

  return false;
}

export class ConfigSyncEngine {
  private static isSyncing = false;

  constructor(
    private app: App,
    private serverUrl: string,
    private user: string,
    private pass: string,
    private workspace: string = 'default-workspace',
    private deviceName: string = 'Unknown Device'
  ) {}

  private getApiUrl(endpoint: string): string {
    let httpUrl = this.serverUrl.replace(/^ws/, 'http');
    httpUrl = httpUrl.replace(/\/sync\/?$/, '');
    return `${httpUrl}/api${endpoint}`;
  }

  private async getRemoteManifest(): Promise<FileManifest> {
    const url = `${this.getApiUrl('/manifest')}?user=${this.user}&pass=${this.pass}&workspace=${this.workspace}`;
    const res = await requestUrl({ url, method: 'GET' });
    if (res.status !== 200) throw new Error('Failed to fetch manifest');
    return res.json as FileManifest;
  }

  private async uploadFile(relativePath: string, data: ArrayBuffer, mtime: number) {
    const url = `${this.getApiUrl('/upload')}?user=${this.user}&pass=${this.pass}&workspace=${this.workspace}&path=${encodeURIComponent(relativePath)}&mtime=${mtime}`;
    const res = await requestUrl({
      url,
      method: 'POST',
      body: data,
    });
    if (res.status !== 200) throw new Error(`Upload failed: ${res.text}`);
  }

  private async downloadFile(relativePath: string): Promise<ArrayBuffer> {
    const url = `${this.getApiUrl('/download')}?user=${this.user}&pass=${this.pass}&workspace=${this.workspace}&path=${encodeURIComponent(relativePath)}`;
    const res = await requestUrl({ url, method: 'GET' });
    if (res.status !== 200) throw new Error('Download failed');
    return res.arrayBuffer;
  }

  /**
   * Writes binary data directly to the Obsidian vault using low-level adapter APIs 
   * to bypass standard hidden-file limitations of app.vault.
   */
  private async writeToVaultUI(relPath: string, data: ArrayBuffer) {
    await this.app.vault.adapter.writeBinary(relPath, data);
  }

  /**
   * Ensures parent directories exist recursively using the raw file system adapter.
   */
  private async ensureDirExists(relPath: string, configDir: string) {
    const parts = relPath.split('/');
    let cur = configDir;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] as string;
      cur = cur ? cur + '/' + part : part;
      if (shouldIgnore(cur)) continue;
      const exists = await this.app.vault.adapter.exists(cur);
      if (!exists) {
        await this.app.vault.adapter.mkdir(cur).catch(() => {});
      }
    }
  }

  /**
   * Performs an incremental, database-free whole-vault configuration and file sync.
   * Compares the local file system manifest with the server manifest, pushing and pulling 
   * updates as needed, and resolving conflicts automatically.
   */
  public async syncConfig(silent: boolean = false) {
    if (ConfigSyncEngine.isSyncing) {
      if (!silent) new Notice('Sync already in progress...');
      return;
    }
    ConfigSyncEngine.isSyncing = true;
    if (!silent) new Notice('Syncing vault files...', 2000);

    try {
      const remoteManifest = await this.getRemoteManifest();
      const localFiles: { path: string, stat: any }[] = [];

      // Recursive local scan starting from the vault root ""
      const scanDir = async (dir: string) => {
        if (shouldIgnore(dir)) return;

        const list = await this.app.vault.adapter.list(dir);
        for (const file of list.files) {
          if (shouldIgnore(file)) continue;
          const stat = await this.app.vault.adapter.stat(file);
          if (stat) localFiles.push({ path: file, stat });
        }
        for (const folder of list.folders) {
          await scanDir(folder);
        }
      };

      await scanDir("");

      // Map local files by relative path for unified syncing
      const localMap = new Map<string, { path: string, stat: any }>();
      for (const local of localFiles) {
        const relPath = local.path.replace(/\\/g, '/');
        localMap.set(relPath, local);
      }

      // Collect all unique relative paths across local and remote
      const allPaths = new Set<string>([
        ...localMap.keys(),
        ...Object.keys(remoteManifest)
      ]);

      let actionsCount = 0;

      for (const relPath of allPaths) {
        const local = localMap.get(relPath);
        const remote = remoteManifest[relPath];

        if (local && !remote) {
          // File exists only locally -> Upload
          const data = await this.app.vault.adapter.readBinary(local.path);
          await this.uploadFile(relPath, data, local.stat.mtime);
          actionsCount++;
        } else if (!local && remote) {
          // File exists only remotely -> Download
          await this.ensureDirExists(relPath, '');
          const data = await this.downloadFile(relPath);
          await this.writeToVaultUI(relPath, data);
          actionsCount++;
        } else if (local && remote) {
          // File exists in both -> Check for modification differences
          const timeDiff = Math.abs(local.stat.mtime - remote.mtime);
          
          if (timeDiff > 2000) {
            // Contents or timestamps differ. Let's read both.
            const localData = await this.app.vault.adapter.readBinary(local.path);
            const remoteData = await this.downloadFile(relPath);

            // Compare binary content quickly
            const localBytes = new Uint8Array(localData);
            const remoteBytes = new Uint8Array(remoteData);
            let contentsMatch = localBytes.length === remoteBytes.length;
            if (contentsMatch) {
              for (let i = 0; i < localBytes.length; i++) {
                if (localBytes[i] !== remoteBytes[i]) {
                  contentsMatch = false;
                  break;
                }
              }
            }

            if (contentsMatch) {
              // Contents match exactly; just align the timestamps to the newest modified time
              if (local.stat.mtime > remote.mtime) {
                await this.uploadFile(relPath, localData, local.stat.mtime);
              } else {
                await this.writeToVaultUI(relPath, remoteData);
              }
            } else {
              // Conflict: Contents are different and timestamps differ.
              if (relPath.endsWith('.json')) {
                // Elegant automatic JSON merge
                try {
                  const decoder = new TextDecoder('utf-8');
                  const encoder = new TextEncoder();

                  const localJson = JSON.parse(decoder.decode(localBytes));
                  const remoteJson = JSON.parse(decoder.decode(remoteBytes));

                  const mergedJson = deepMerge(localJson, remoteJson);
                  const mergedData = encoder.encode(JSON.stringify(mergedJson, null, 2)).buffer;
                  
                  const mergedMtime = Math.max(local.stat.mtime, remote.mtime);

                  // Save merged file locally and upload to remote
                  await this.writeToVaultUI(relPath, mergedData);
                  await this.uploadFile(relPath, mergedData, mergedMtime);
                  actionsCount++;
                  console.log(`[LiveCursor] Automatically merged JSON conflict for config file: ${relPath}`);
                } catch (jsonErr) {
                  // Fall back to mtime-based resolution if parsing fails
                  console.warn(`[LiveCursor] JSON merge failed for ${relPath}, falling back to mtime:`, jsonErr);
                  const remoteDevice = remote.device || 'Remote';
                  const localConflictPath = `Sync Conflicts/${this.deviceName}/${relPath}`;
                  const remoteConflictPath = `Sync Conflicts/${remoteDevice}/${relPath}`;
                  
                  await this.ensureDirExists(localConflictPath, '');
                  await this.writeToVaultUI(localConflictPath, localData);
                  
                  await this.ensureDirExists(remoteConflictPath, '');
                  await this.writeToVaultUI(remoteConflictPath, remoteData);

                  if (local.stat.mtime > remote.mtime) {
                    await this.uploadFile(relPath, localData, local.stat.mtime);
                  } else {
                    await this.writeToVaultUI(relPath, remoteData);
                  }
                  actionsCount++;
                }
              } else {
                // Non-JSON files: Resolve silently via latest modification time (mtime)
                const remoteDevice = remote.device || 'Remote';
                const localConflictPath = `Sync Conflicts/${this.deviceName}/${relPath}`;
                const remoteConflictPath = `Sync Conflicts/${remoteDevice}/${relPath}`;
                  
                await this.ensureDirExists(localConflictPath, '');
                await this.writeToVaultUI(localConflictPath, localData);
                  
                await this.ensureDirExists(remoteConflictPath, '');
                await this.writeToVaultUI(remoteConflictPath, remoteData);

                if (local.stat.mtime > remote.mtime) {
                  await this.uploadFile(relPath, localData, local.stat.mtime);
                } else {
                  await this.writeToVaultUI(relPath, remoteData);
                }
                actionsCount++;
              }
            }
          }
        }
      }

      if (!silent) new Notice(actionsCount > 0 ? `Sync complete (${actionsCount} updated)` : 'Vault in sync.', 2000);
    } catch (e: any) {
      console.error('[LiveCursor] Sync Error:', e);
      if (!silent) new Notice(`Sync failed. Check server connection.`, 2000);
    } finally {
      ConfigSyncEngine.isSyncing = false;
    }
  }
}