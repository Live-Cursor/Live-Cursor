import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { Notice } from 'obsidian';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;
const pingTimeout = 30000;

export class LocalSignalingServer {
  private port: number;
  private wss: WebSocketServer | null = null;
  private server: http.Server | null = null;
  private topics: Map<string, Set<WebSocket>> = new Map();
  private pingIntervals: Map<WebSocket, any> = new Map();

  constructor(port: number = 4444) {
    this.port = port;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        resolve();
        return;
      }

      this.server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('okay');
      });

      this.wss = new WebSocketServer({ noServer: true });

      this.wss.on('connection', (conn: WebSocket) => {
        this.onConnection(conn);
      });

      this.server.on('upgrade', (request, socket, head) => {
        if (this.wss) {
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss?.emit('connection', ws, request);
          });
        }
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        console.log(`[LiveCursor] Local Signaling Server running on port ${this.port}`);
        new Notice(`Host Local Room started on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (err) => {
        console.error('[LiveCursor] Signaling server error:', err);
        new Notice(`Failed to start Local Room: ${err.message}`);
        reject(err);
      });
    });
  }

  public stop() {
    if (this.wss) {
      this.wss.clients.forEach(client => client.close());
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.topics.clear();
    for (const interval of this.pingIntervals.values()) {
      clearInterval(interval);
    }
    this.pingIntervals.clear();
    console.log('[LiveCursor] Local Signaling Server stopped');
    new Notice('Host Local Room stopped.');
  }

  public isRunning(): boolean {
    return this.server !== null;
  }

  private send(conn: WebSocket, message: any) {
    if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
      conn.close();
    }
    try {
      conn.send(JSON.stringify(message));
    } catch (e) {
      conn.close();
    }
  }

  private onConnection(conn: WebSocket) {
    const subscribedTopics = new Set<string>();
    let closed = false;
    let pongReceived = true;

    const pingInterval = setInterval(() => {
      if (!pongReceived) {
        conn.close();
        clearInterval(pingInterval);
        this.pingIntervals.delete(conn);
      } else {
        pongReceived = false;
        try {
          conn.ping();
        } catch (e) {
          conn.close();
        }
      }
    }, pingTimeout);
    
    this.pingIntervals.set(conn, pingInterval);

    conn.on('pong', () => {
      pongReceived = true;
    });

    conn.on('close', () => {
      subscribedTopics.forEach(topicName => {
        const subs = this.topics.get(topicName) || new Set();
        subs.delete(conn);
        if (subs.size === 0) {
          this.topics.delete(topicName);
        }
      });
      subscribedTopics.clear();
      closed = true;
      clearInterval(pingInterval);
      this.pingIntervals.delete(conn);
    });

    conn.on('message', (message: any) => {
      if (typeof message === 'string' || message instanceof Buffer) {
        try {
          message = JSON.parse(message.toString());
        } catch (e) {
          return;
        }
      }
      if (message && message.type && !closed) {
        switch (message.type) {
          case 'subscribe':
            (message.topics || []).forEach((topicName: string) => {
              if (typeof topicName === 'string') {
                if (!this.topics.has(topicName)) {
                  this.topics.set(topicName, new Set());
                }
                this.topics.get(topicName)!.add(conn);
                subscribedTopics.add(topicName);
              }
            });
            break;
          case 'unsubscribe':
            (message.topics || []).forEach((topicName: string) => {
              const subs = this.topics.get(topicName);
              if (subs) {
                subs.delete(conn);
              }
            });
            break;
          case 'publish':
            if (message.topic) {
              const receivers = this.topics.get(message.topic);
              if (receivers) {
                message.clients = receivers.size;
                receivers.forEach(receiver => {
                  this.send(receiver, message);
                });
              }
            }
            break;
          case 'ping':
            this.send(conn, { type: 'pong' });
            break;
        }
      }
    });
  }
}
