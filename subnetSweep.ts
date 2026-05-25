import * as os from 'os';
import { WebSocket } from 'ws';
import { Notice } from 'obsidian';

export class SubnetSweeper {
  private port: number;
  private timeoutMs: number;
  private activeSockets: WebSocket[] = [];

  constructor(port: number = 4444, timeoutMs: number = 2000) {
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  private getLocalIPs(): string[] {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]!) {
        // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
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

      ws.on('open', () => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timeout);
          resolve(url);
        }
      });

      ws.on('error', (err) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      });
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
    if (localIPs.length === 0) {
      new Notice('No local network interfaces found. Are you connected to Wi-Fi/Hotspot?');
      return null;
    }

    new Notice('Sweeping local network to find Host...');
    console.log('[LiveCursor] Local IPs found:', localIPs);

    const allPromises: Promise<string>[] = [];

    for (const localIP of localIPs) {
      const subnetIPs = this.generateSubnetIPs(localIP);
      for (const targetIP of subnetIPs) {
        if (targetIP !== localIP) {
          allPromises.push(this.checkWebSocket(targetIP));
        }
      }
    }

    try {
      // Promise.any resolves as soon as ANY of the websockets connects successfully
      const foundUrl = await Promise.any(allPromises);
      this.closeAllSockets();
      return foundUrl;
    } catch (e) {
      // AggregateError if all promises reject
      this.closeAllSockets();
      return null;
    }
  }
}
