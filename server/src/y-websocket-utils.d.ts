declare module 'y-websocket/bin/utils' {
  import * as Y from 'yjs';
  import { WebSocket } from 'ws';
  import { IncomingMessage } from 'http';

  export function setupWSConnection(conn: WebSocket, req: IncomingMessage, options?: any): void;
  export function setPersistence(persistence: {
    bindState: (docName: string, ydoc: Y.Doc) => Promise<void>;
    writeState: (docName: string, ydoc: Y.Doc) => Promise<void>;
  }): void;
  export const docs: Map<string, Y.Doc>;
}

declare module 'y-websocket' {
  import * as Y from 'yjs';
  export class WebsocketProvider {
    constructor(serverUrl: string, roomName: string, doc: Y.Doc, options?: any);
    wsconnected: boolean;
    connect(): void;
    disconnect(): void;
    on(event: string, cb: Function): void;
  }
}
