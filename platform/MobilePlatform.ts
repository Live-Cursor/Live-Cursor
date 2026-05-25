import { PlatformService } from './PlatformService';

export class MobilePlatform implements PlatformService {
  isMobile(): boolean {
    return true;
  }

  isDesktop(): boolean {
    return false;
  }

  async spawnDaemon(absolutePluginDir: string, envPath: string): Promise<any> {
    console.warn('[LiveCursor] Spawning background server daemon is not supported on mobile.');
    return null;
  }

  killDaemon(process: any): void {
    // No-op
  }

  getLocalIPs(): string[] {
    return [];
  }
}
