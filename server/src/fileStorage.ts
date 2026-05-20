import * as fs from 'fs/promises';
import * as path from 'path';

export interface FileManifest {
  [filePath: string]: {
    size: number;
    mtime: number;
  };
}

export class FileStorage {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Ensure a workspace directory exists.
   */
  private async ensureDir(dirPath: string) {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * Generate a recursive manifest of all files in a workspace.
   */
  public async getManifest(workspaceName: string): Promise<FileManifest> {
    const workspaceDir = path.join(this.baseDir, workspaceName);
    const manifest: FileManifest = {};

    try {
      await this.ensureDir(workspaceDir);
      await this.scanDir(workspaceDir, workspaceDir, manifest);
    } catch (e) {
      console.error(`[FileStorage] Failed to generate manifest for ${workspaceName}:`, e);
    }
    
    return manifest;
  }

  private async scanDir(rootDir: string, currentDir: string, manifest: FileManifest) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      // Compute relative path, always use forward slashes for cross-platform compatibility
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        await this.scanDir(rootDir, fullPath, manifest);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        manifest[relPath] = {
          size: stats.size,
          mtime: stats.mtimeMs
        };
      }
    }
  }

  /**
   * Safely resolve and validate a file path to prevent directory traversal attacks.
   */
  private resolveSafePath(workspaceName: string, relativeFilePath: string): string {
    const workspaceDir = path.resolve(path.join(this.baseDir, workspaceName));
    const fullPath = path.resolve(path.join(workspaceDir, relativeFilePath));
    
    if (!fullPath.startsWith(workspaceDir)) {
      throw new Error('Security Error: Path traversal attempt blocked.');
    }
    return fullPath;
  }

  /**
   * Save a file sent from the client.
   */
  public async saveFile(workspaceName: string, relativeFilePath: string, fileBuffer: Buffer, mtime?: number): Promise<void> {
    const fullPath = this.resolveSafePath(workspaceName, relativeFilePath);
    await this.ensureDir(path.dirname(fullPath));
    
    await fs.writeFile(fullPath, fileBuffer);
    
    // If the client provided the original mtime, preserve it so future syncs match
    if (mtime) {
      const timeSec = Math.floor(mtime / 1000);
      await fs.utimes(fullPath, timeSec, timeSec);
    }
  }

  /**
   * Read a file to send to the client.
   */
  public async readFile(workspaceName: string, relativeFilePath: string): Promise<Buffer> {
    const fullPath = this.resolveSafePath(workspaceName, relativeFilePath);
    return await fs.readFile(fullPath);
  }
}
