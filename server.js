const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const { setupWSConnection } = require('y-websocket/bin/utils');

const port = process.env.PORT || 4444;
const dbDir = process.env.DB_DIR || path.join(__dirname, 'data');

// Create storage directories
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const roomsDir = path.join(dbDir, 'rooms');
if (!fs.existsSync(roomsDir)) {
  fs.mkdirSync(roomsDir, { recursive: true });
}

// Map of active documents
const docs = new Map();
const saveTimeouts = new Map();

// Helper to get room path for persistence
function getRoomPath(roomId) {
  const safeName = encodeURIComponent(roomId).replace(/%20/g, '_').slice(0, 100);
  return path.join(roomsDir, safeName + '.bin');
}

// Load document state from disk database
function loadDoc(roomId, doc) {
  const p = getRoomPath(roomId);
  if (fs.existsSync(p)) {
    try {
      const data = fs.readFileSync(p);
      Y.applyUpdate(doc, new Uint8Array(data));
      console.log(`[Database] Loaded persistent state for room: ${roomId}`);
    } catch (e) {
      console.error(`[Database] Failed to load room "${roomId}"`, e);
    }
  } else {
    console.log(`[Database] Room "${roomId}" not found in database. Initializing empty.`);
  }
}

// Save document state to disk database
function saveDoc(roomId, doc) {
  const p = getRoomPath(roomId);
  try {
    const state = Y.encodeStateAsUpdate(doc);
    fs.writeFileSync(p, Buffer.from(state.buffer, state.byteOffset, state.byteLength));
    console.log(`[Database] Saved state for room: ${roomId}`);
  } catch (e) {
    console.error(`[Database] Failed to save room "${roomId}"`, e);
  }
}

// Create standard HTTP server
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Live Cursor Sync Server (WebSocket + DB) is running.');
});

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let roomName = url.pathname.replace(/^\/sync\/?/, '');
  roomName = decodeURIComponent(roomName);

  console.log(`[+] Client connected to room: ${roomName}`);

  let doc = docs.get(roomName);
  if (!doc) {
    doc = new Y.Doc();
    loadDoc(roomName, doc);
    docs.set(roomName, doc);
    
    // Setup persistence observer on document updates
    doc.on('update', () => {
      let timeout = saveTimeouts.get(roomName);
      if (timeout) clearTimeout(timeout);
      
      timeout = setTimeout(() => {
        saveDoc(roomName, doc);
        saveTimeouts.delete(roomName);
      }, 2000); // Debounce saves by 2 seconds to optimize disk IO
      
      saveTimeouts.set(roomName, timeout);
    });
  }

  // Bind connection to standard y-websocket protocol
  setupWSConnection(ws, req, doc);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log('===================================================');
  console.log('      LIVE CURSOR PRIVATE SYNC & DATABASE SERVER     ');
  console.log('===================================================');
  console.log(`[*] Version: 1.3.1`);
  console.log(`[*] Mode: Production (Docker)`);
  console.log(`[*] Port: ${port}`);
  console.log(`[*] Database Directory: ${dbDir}`);
  console.log(`[*] Listening on: 0.0.0.0:${port}`);
  console.log('===================================================');
});
