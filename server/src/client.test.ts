import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import WebSocket from 'ws';

// Polyfill WebSocket for y-websocket in Node
(global as any).WebSocket = WebSocket;

async function runClientTest() {
  console.log('--- Starting Client Test ---');
  
  const doc = new Y.Doc();
  
  // Valid credentials
  const url = 'ws://localhost:1234/sync';
  
  const wsProvider = new WebsocketProvider(url, 'test-workspace', doc, { 
    connect: false,
    params: { user: 'admin', pass: 'admin' }
  });
  
  wsProvider.on('status', (event: any) => {
    console.log('[Client] Status:', event.status);
  });

  wsProvider.connect();

  // Wait for connection
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const text = doc.getText('content');
  text.insert(0, 'Hello from WebSocket!');

  console.log('[Client] Inserted text. Waiting to sync...');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log('[Client] Disconnecting...');
  wsProvider.disconnect();
  
  // Let it close and server compact
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log('--- Client Test Complete ---');
}

runClientTest();
