import { PlatformService } from './PlatformService';

export class DesktopPlatform implements PlatformService {
  isMobile(): boolean {
    return false;
  }

  isDesktop(): boolean {
    return true;
  }

  async spawnDaemon(absolutePluginDir: string, envPath: string): Promise<any> {
    const cp = (window as any).require('child_process');
    const daemonScriptPath = `${absolutePluginDir}/server_daemon.js`;
    
    console.log(`[LiveCursor] Spawning desktop server daemon at: ${daemonScriptPath}`);
    
    const daemonProcess = cp.spawn('node', [daemonScriptPath], {
      env: {
        PORT: '1234',
        DB_DIR: `${absolutePluginDir}/data`,
        PATH: envPath
      }
    });

    return daemonProcess;
  }

  killDaemon(process: any): void {
    if (process && typeof process.kill === 'function') {
      console.log('[LiveCursor] Terminating background server daemon process...');
      process.kill();
    }
  }

  getLocalIPs(): string[] {
    const localIps: string[] = [];
    try {
      const os = (window as any).require('os');
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        const netInterface = interfaces[name];
        if (netInterface) {
          for (const iface of netInterface) {
            if (iface.family === 'IPv4' && !iface.internal) {
              localIps.push(iface.address);
            }
          }
        }
      }
    } catch (e) {
      console.error('[LiveCursor] Failed to retrieve network interfaces on desktop:', e);
    }
    return localIps;
  }
}
