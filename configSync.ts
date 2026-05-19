import { App, requestUrl, Notice } from 'obsidian';

export interface FileManifest {
  [filePath: string]: {
    size: number;
    mtime: number;
  };
}

export class ConfigSyncEngine {
  constructor(
    private app: App,
    private serverUrl: string, // e.g., ws://localhost:1234/sync (we will convert to http://localhost:1234/api)
    private user: string,
    private pass: string,
    private workspace: string = 'default-workspace'
  ) {}

  private getApiUrl(endpoint: string): string {
    // Convert ws:// or wss:// to http:// or https://
    let httpUrl = this.serverUrl.replace(/^ws/, 'http');
    // Remove trailing /sync
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

  public async syncConfig() {
    new Notice('Starting Config Sync...');
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

      await scanDir(configDir);

      let uploaded = 0;
      let downloaded = 0;

      // 1. Upload newer local files
      for (const local of localFiles) {
        // We only care about relative path inside configDir
        const relPath = local.path.substring(configDir.length + 1).replace(/\\/g, '/');
        const remote = remoteManifest[relPath];

        if (!remote || local.stat.mtime > remote.mtime + 2000) {
          // Upload
          const data = await this.app.vault.adapter.readBinary(local.path);
          await this.uploadFile(relPath, data, local.stat.mtime);
          uploaded++;
        }
      }

      // 2. Download newer remote files
      for (const [relPath, remote] of Object.entries(remoteManifest)) {
        const fullLocalPath = `${configDir}/${relPath}`;
        const localStat = await this.app.vault.adapter.stat(fullLocalPath);

        if (!localStat || remote.mtime > localStat.mtime + 2000) {
          // Download
          const data = await this.downloadFile(relPath);
          // Ensure directory exists
          const parts = relPath.split('/');
          let cur = configDir;
          for (let i = 0; i < parts.length - 1; i++) {
            cur += '/' + parts[i];
            if (!(await this.app.vault.adapter.exists(cur))) {
              await this.app.vault.adapter.mkdir(cur);
            }
          }
          await this.app.vault.adapter.writeBinary(fullLocalPath, data);
          downloaded++;
        }
      }

      new Notice(`Config Sync Complete: Uploaded ${uploaded}, Downloaded ${downloaded}`);
    } catch (e: any) {
      new Notice(`Config Sync Failed: ${e.message}`);
      console.error(e);
    }
  }
}
