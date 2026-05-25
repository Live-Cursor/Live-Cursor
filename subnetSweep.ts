import { Notice, Platform } from 'obsidian';

export class SubnetSweeper {
  private port: number;
  private timeoutMs: number;
  private activeSockets: any[] = [];

  constructor(port: number = 4444, timeoutMs: number = 2000) {
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  private getLocalIPs(): string[] {
    const ips: string[] = [];
    if (Platform.isDesktopApp) {
      try {
        const os = require('os');
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
          for (const iface of interfaces[name]!) {
            // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
              ips.push(iface.address);
            }
          }
        }
      } catch (e) {
        // Fallback below
      }
    }
    return ips;
  }

  private generateSubnetIPs(ip: string): string[] {
    const parts = ip.split('.');
    if (parts.length !== 4) return [];
    const base = `${parts[0]}.${parts[1]}.${parts[2]}.`;
    const ips: string[] = [];
    for (let i = 1; i < 255; i++) {
      ips.push(`${base}${i}`);
    }
    return ips;
  }

  private checkWebSocket(ip: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = `ws://${ip}:${this.port}`;
      const ws = new WebSocket(url);
      this.activeSockets.push(ws);
      let isDone = false;

      const timeout = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          ws.close();
          reject(new Error('Timeout'));
        }
      }, this.timeoutMs);

      ws.onopen = () => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timeout);
          resolve(url);
        }
      };

      ws.onerror = (err: any) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      };
    });
  }

  private closeAllSockets() {
    for (const ws of this.activeSockets) {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
    }
    this.activeSockets = [];
  }

  public async findHost(): Promise<string | null> {
    const localIPs = this.getLocalIPs();
    
    let bases = new Set<string>();
    localIPs.forEach(ip => {
      const parts = ip.split('.');
      if (parts.length === 4) {
        bases.add(`${parts[0]}.${parts[1]}.${parts[2]}.`);
      }
    });
    
    // Add common Mobile Hotspot subnets
    bases.add('192.168.43.'); // standard android
    bases.add('192.168.49.'); // some android
    bases.add('192.168.1.');
    bases.add('192.168.0.');
    bases.add('172.20.10.');  // iOS

    new Notice('Sweeping local network to find Host...');
    console.log('[LiveCursor] Local IPs found:', localIPs);

    const subnets = Array.from(bases);

    for (const base of subnets) {
      const allPromises: Promise<string>[] = [];
      for (let i = 1; i < 255; i++) {
        const targetIP = `${base}${i}`;
        if (!localIPs.includes(targetIP)) {
          allPromises.push(this.checkWebSocket(targetIP));
        }
      }
      
      try {
        const foundUrl = await Promise.any(allPromises);
        this.closeAllSockets();
        return foundUrl;
      } catch (e) {
        // This subnet failed (timeout or error), clean up and try the next base
        this.closeAllSockets();
      }
    }

    return null;
  }
}
