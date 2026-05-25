import { App } from 'obsidian';

export interface PlatformService {
  isMobile(): boolean;
  isDesktop(): boolean;
  spawnDaemon(absolutePluginDir: string, envPath: string): Promise<any>;
  killDaemon(process: any): void;
  getLocalIPs(): string[];
}
