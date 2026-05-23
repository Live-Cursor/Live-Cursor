import { App, requestUrl, Notice } from 'obsidian';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';

export interface FileManifest {
  [filePath: string]: {
    size: number;
    mtime: number;
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

export class ConfigSyncEngine {
  constructor(
    private app: App,
    private serverUrl: string,
    private user: string,
    private pass: string,
    private workspace: string = 'default-workspace'
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


  private async writeToVaultUI(relPath: string, data: ArrayBuffer) {
    const file = this.app.vault.getAbstractFileByPath(relPath);
    if (file) {
      await this.app.vault.modifyBinary(file as any, data);
    } else {
      await this.app.vault.createBinary(relPath, data);
    }
  }

  private async ensureDirExists(relPath: string, configDir: string) {
    if (configDir && !(await this.app.vault.adapter.exists(configDir))) {
      await this.app.vault.adapter.mkdir(configDir);
    }
    const parts = relPath.split('/');
    let cur = configDir;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] as string;
      cur = cur ? cur + '/' + part : part;
      if (!(await this.app.vault.adapter.exists(cur))) {
        await this.app.vault.adapter.mkdir(cur);
      }
    }
  }

  public async syncConfig() {
    new Notice('Syncing configurations...');
    const configDir = this.app.vault.configDir;

    try {
      const remoteManifest = await this.getRemoteManifest();
      const localFiles: { path: string, stat: any }[] = [];

      // Recursive local scan
      const scanDir = async (dir: string) => {
        const list = await this.app.vault.adapter.list(dir);
        for (const file of list.files) {
          const stat = await this.app.vault.adapter.stat(file);
          if (stat) localFiles.push({ path: file, stat });
        }
        for (const folder of list.folders) {
          await scanDir(folder);
        }
      };

      if (await this.app.vault.adapter.exists(configDir)) {
        await scanDir(configDir);
      }

      // Map local files by relative path for unified syncing
      const localMap = new Map<string, { path: string, stat: any }>();
      for (const local of localFiles) {
        const relPath = local.path.substring(configDir.length + 1).replace(/\\/g, '/');
        localMap.set(relPath, local);
      }

      // Collect all unique relative paths across local and remote
      const allPaths = new Set<string>([
        ...localMap.keys(),
        ...Object.keys(remoteManifest)
      ]);

            new Notice(`Found ${localFiles.length} local files. Comparing with mesh...`, 3000);
      let actionsCount = 0;
      let downloadCount = 0;
      let uploadCount = 0;

      for (const relPath of allPaths) {
        const local = localMap.get(relPath);
        const remote = remoteManifest[relPath];
        const fullLocalPath = `${configDir}/${relPath}`;

        if (local && !remote) {
          // File exists only locally -> Upload
          const data = await this.app.vault.adapter.readBinary(local.path);
          await this.uploadFile(relPath, data, local.stat.mtime);
          actionsCount++;
          uploadCount++;
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
                  const conflictDir = 'Sync Conflicts';
                  await this.ensureDirExists(relPath, conflictDir);
                  await this.writeToVaultUI(`${conflictDir}/${relPath}.local.bak`, localData);
                  await this.writeToVaultUI(`${conflictDir}/${relPath}.remote.bak`, remoteData);

                  if (local.stat.mtime > remote.mtime) {
                    await this.uploadFile(relPath, localData, local.stat.mtime);
                  } else {
                    await this.writeToVaultUI(relPath, remoteData);
                  }
                  actionsCount++;
                }
              } else {
                // Non-JSON files: Resolve silently via latest modification time (mtime)
                const conflictDir = 'Sync Conflicts';
                await this.ensureDirExists(relPath, conflictDir);
                await this.writeToVaultUI(`${conflictDir}/${relPath}.local.bak`, localData);
                await this.writeToVaultUI(`${conflictDir}/${relPath}.remote.bak`, remoteData);

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

      new Notice(actionsCount > 0 ? 'Configurations updated successfully!' : 'Configurations in sync.');
    } catch (e: any) {
      // Keep it professional and non-intrusive
      console.error('[LiveCursor] Config Sync Error:', e);
      new Notice(`Sync completed (offline/standby).`);
    }
  }

  public async syncConfigViaWebrtc(doc: any) {
    new Notice('Syncing full vault via WebRTC Mesh...', 5000);
    
    try {
      if (!doc) {
         new Notice('WebRTC mesh not connected yet. Check settings.');
         return;
      }
      const configDir = '';
      
      const manifestMap = doc.getMap('manifest');
      const filesMap = doc.getMap('files');

      const remoteManifest = manifestMap.toJSON() as FileManifest;
      const localFiles: { path: string, stat: any }[] = [];

      // Recursive local scan of entire vault
      const scanDir = async (dir: string) => {
        const list = await this.app.vault.adapter.list(dir);
        for (const file of list.files) {
          if (file.endsWith('workspace.json') || file.endsWith('workspace-mobile.json') || file.endsWith('.DS_Store')) continue;
          const stat = await this.app.vault.adapter.stat(file);
          if (stat) localFiles.push({ path: file, stat });
        }
        for (const folder of list.folders) {
          if (folder.includes('.git') || folder.includes('node_modules') || folder.includes('Sync Conflicts') || folder.includes('.obsidian-test')) continue;
          await scanDir(folder);
        }
      };

      await scanDir('');

      // Map local files by relative path for unified syncing
      const localMap = new Map<string, { path: string, stat: any }>();
      for (const local of localFiles) {
        const relPath = local.path.startsWith('/') ? local.path.substring(1) : local.path;
        localMap.set(relPath, local);
      }

      // Collect all unique relative paths across local and remote
      const allPaths = new Set<string>([
        ...localMap.keys(),
        ...Object.keys(remoteManifest)
      ]);

      let actionsCount = 0;


      const uploadFileFn = async (relPath: string, data: ArrayBuffer, mtime: number) => {
        filesMap.set(relPath, new Uint8Array(data));
        manifestMap.set(relPath, { size: data.byteLength, mtime });
      };

      const downloadFileFn = async (relPath: string): Promise<ArrayBuffer> => {
        const data = filesMap.get(relPath) as Uint8Array;
        if (!data) throw new Error('File missing in mesh');
        return data.buffer as ArrayBuffer;
      };

      for (const relPath of allPaths) {
        const local = localMap.get(relPath);
        const remote = remoteManifest[relPath];
        const fullLocalPath = relPath;

        if (local && !remote) {
          // File exists only locally -> Upload to mesh
          const data = await this.app.vault.adapter.readBinary(local.path);
          await uploadFileFn(relPath, data, local.stat.mtime);
          actionsCount++;
        } else if (!local && remote) {
          // File exists only remotely -> Download from mesh
          await this.ensureDirExists(relPath, '');
          const data = await downloadFileFn(relPath);
          await this.writeToVaultUI(relPath, data);
          actionsCount++;
        } else if (local && remote) {
          // File exists in both -> Check for modification differences
          const timeDiff = Math.abs(local.stat.mtime - remote.mtime);
          
          if (timeDiff > 2000) {
            // Contents or timestamps differ. Let's read both.
            const localData = await this.app.vault.adapter.readBinary(local.path);
            const remoteData = await downloadFileFn(relPath);

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
              // Contents are identical. Do NOT write to disk to avoid mtime bounce.
              // Just update the mesh manifest silently so timestamps match.
              if (local.stat.mtime > remote.mtime) {
                await uploadFileFn(relPath, localData, local.stat.mtime);
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
                  await uploadFileFn(relPath, mergedData, mergedMtime);
                  actionsCount++;
                  console.log(`[LiveCursor] Automatically merged JSON conflict for config file: ${relPath}`);
                } catch (jsonErr) {
                  // Fall back to mtime-based resolution if parsing fails
                  console.warn(`[LiveCursor] JSON merge failed for ${relPath}, falling back to mtime:`, jsonErr);
                  const conflictDir = 'Sync Conflicts';
                  await this.ensureDirExists(relPath, conflictDir);
                  await this.writeToVaultUI(`${conflictDir}/${relPath}.local.bak`, localData);
                  await this.writeToVaultUI(`${conflictDir}/${relPath}.remote.bak`, remoteData);

                  if (local.stat.mtime > remote.mtime) {
                    await uploadFileFn(relPath, localData, local.stat.mtime);
                  } else {
                    await this.writeToVaultUI(relPath, remoteData);
                  }
                  actionsCount++;
                }
              } else {
                // Non-JSON files: Resolve silently via latest modification time (mtime)
                const conflictDir = 'Sync Conflicts';
                await this.ensureDirExists(relPath, conflictDir);
                await this.writeToVaultUI(`${conflictDir}/${relPath}.local.bak`, localData);
                await this.writeToVaultUI(`${conflictDir}/${relPath}.remote.bak`, remoteData);

                if (local.stat.mtime > remote.mtime) {
                  await uploadFileFn(relPath, localData, local.stat.mtime);
                } else {
                  await this.writeToVaultUI(relPath, remoteData);
                }
                actionsCount++;
              }
            }
          }
        }
      }

      new Notice(actionsCount > 0 ? `Mesh Sync: ${actionsCount} files updated!` : 'Vault is completely in sync!');
      

      
    } catch (e: any) {
      console.error('[LiveCursor] WebRTC Config Sync Error:', e);
      new Notice(`Mesh Sync completed (standby).`);
    }
  }

  public setupBackgroundListener(doc: any) {
    if (!doc) return;
    const manifestMap = doc.getMap('manifest');
    manifestMap.observe(async (event: any) => {
      // Ignore local changes
      if (event.transaction.local) return;
      
      console.log('[LiveCursor] Remote vault manifest changed. Automatically syncing...');
      new Notice('Incoming files from WebRTC Mesh...', 3000);
      try {
        await this.syncConfigViaWebrtc(doc);
      } catch (e) {
        console.error('[LiveCursor] Background Sync Error:', e);
      }
    });
  }

}