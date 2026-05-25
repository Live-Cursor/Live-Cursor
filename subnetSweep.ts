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

  private async getMobileLocalIPs(): Promise<string[]> {
    return new Promise((resolve) => {
      const ips: string[] = [];
      try {
        const RTCPeerConnection =
          (window as any).RTCPeerConnection ||
          (window as any).webkitRTCPeerConnection ||
          (window as any).mozRTCPeerConnection;
        if (!RTCPeerConnection) {
          resolve([]);
          return;
        }
        
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer()
          .then((offer: any) => pc.setLocalDescription(offer))
          .catch(() => {});

        pc.onicecandidate = (ice: any) => {
          if (ice && ice.candidate && ice.candidate.candidate) {
            const candidate = ice.candidate.candidate;
            // Match IPv4 addresses
            const match = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(candidate);
            if (match && match[1]) {
              const ip = match[1];
              if (ip !== '127.0.0.1' && !ip.startsWith('0.')) {
                if (!ips.includes(ip)) {
                  ips.push(ip);
                }
              }
            }
          }
        };

        // Give WebRTC 800ms to gather local ICE candidates
        setTimeout(() => {
          try {
            pc.close();
          } catch (e) {}
          resolve(ips);
        }, 800);
      } catch (e) {
        resolve([]);
      }
    });
  }

  public async findHost(): Promise<string | null> {
    const localIPs = this.getLocalIPs();
    
    // Attempt dynamic WebRTC local IP gathering for mobile environments
    const mobileIPs = await this.getMobileLocalIPs();
    const allIPs = [...localIPs, ...mobileIPs];
    
    let bases = new Set<string>();
    allIPs.forEach(ip => {
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
    console.log('[LiveCursor] Local/Mobile IPs found:', allIPs);

    const subnets = Array.from(bases);

    for (const base of subnets) {
      console.log(`[LiveCursor] Sweeping subnet: ${base}`);
      const BATCH_SIZE = 30;
      
      for (let i = 1; i < 255; i += BATCH_SIZE) {
        const batchPromises: Promise<string>[] = [];
        const end = Math.min(i + BATCH_SIZE, 255);
        
        for (let j = i; j < end; j++) {
          const targetIP = `${base}${j}`;
          if (!localIPs.includes(targetIP)) {
            batchPromises.push(this.checkWebSocket(targetIP));
          }
        }
        
        try {
          // Promise.any will resolve as soon as any socket connects successfully
          const foundUrl = await Promise.any(batchPromises);
          this.closeAllSockets();
          return foundUrl;
        } catch (e) {
          // This batch failed, close sockets and move to the next batch
          this.closeAllSockets();
        }
      }
    }

    return null;
  }
}
