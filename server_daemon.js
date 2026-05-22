const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const Y = require('yjs');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');

// --- Inline y-websocket connection setup (no internal API dependency) ---
const docs = new Map();

const messageSync = 0;
const messageAwareness = 1;

const setupWSConnection = (conn, req, doc) => {
  conn.binaryType = 'arraybuffer';
  const awareness = new awarenessProtocol.Awareness(doc);

  // Send initial sync step 1
  const sendSyncStep1 = () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    conn.send(encoding.toUint8Array(encoder));
  };

  // Send awareness states
  const sendAwareness = () => {
    const states = Array.from(awareness.getStates().keys());
    if (states.length > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, states));
      conn.send(encoding.toUint8Array(encoder));
    }
  };

  conn.on('message', (message) => {
    try {
      const msg = message instanceof ArrayBuffer ? new Uint8Array(message) : message;
      const decoder = decoding.createDecoder(msg);
      const msgType = decoding.readVarUint(decoder);
      if (msgType === messageSync) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        if (encoding.length(encoder) > 1) {
          conn.send(encoding.toUint8Array(encoder));
        }
      } else if (msgType === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), conn);
      }
    } catch (e) {
      console.error('[Daemon] Message handling error:', e);
    }
  });

  conn.on('close', () => {
    awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], 'connection closed');
  });

  // Broadcast doc updates to this connection
  const docUpdateHandler = (update, origin) => {
    if (origin !== conn) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      conn.send(encoding.toUint8Array(encoder));
    }
  };

  // Broadcast awareness to this connection
  const awarenessUpdateHandler = ({ added, updated, removed }) => {
    const changedClients = added.concat(updated).concat(removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
    conn.send(encoding.toUint8Array(encoder));
  };

  doc.on('update', docUpdateHandler);
  awareness.on('update', awarenessUpdateHandler);

  conn.on('close', () => {
    doc.off('update', docUpdateHandler);
    awareness.off('update', awarenessUpdateHandler);
  });

  sendSyncStep1();
  sendAwareness();
};
// --- End inline setup ---

// 1. Pure-JS File Database implementation
class JSONStorage {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { users: {}, rooms: {} };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
        if (!this.data.users) this.data.users = {};
        if (!this.data.rooms) this.data.rooms = {};
      } else {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this.save();
      }
    } catch (e) {
      console.error('Failed to load DB:', e);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save DB:', e);
    }
  }

  registerUser(username, passwordHash) {
    this.data.users[username] = passwordHash;
    this.save();
  }

  verifyUser(username, passwordHash) {
    return this.data.users[username] === passwordHash;
  }

  listUsers() {
    return Object.keys(this.data.users);
  }

  appendUpdate(roomId, updateBase64) {
    if (!this.data.rooms[roomId]) {
      this.data.rooms[roomId] = [];
    }
    this.data.rooms[roomId].push(updateBase64);
    this.save();
  }

  getUpdates(roomId) {
    return this.data.rooms[roomId] || [];
  }

  compactRoom(roomId, stateVectorBase64) {
    this.data.rooms[roomId] = [stateVectorBase64];
    this.save();
  }
}

// 2. Initialize Telemetry and Storage
const port = process.env.PORT || 1234;
const dbDir = process.env.DB_DIR || path.join(__dirname, 'data');
const dbPath = path.join(dbDir, 'live-cursor-daemon.json');
const db = new JSONStorage(dbPath);
// docs map is defined above in the inline setup

console.log(`[Daemon] Local Storage loaded at: ${dbPath}`);

// 3. HTTP Server setup for APIs
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams.entries());

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Public check: Admin registry status
  if (url.pathname === '/api/admin-exists') {
    const exists = db.listUsers().includes('admin');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ exists }));
    return;
  }

  // Determine if this is the initial registration of the admin account when the user DB is empty
  const isInitialSetup = db.listUsers().length === 0 && url.pathname === '/api/admin/create-user';

  if (!isInitialSetup) {
    // Credentials authorization gate for Admin APIs
    const authUser = query.user;
    const authPass = query.pass;
    if (!db.verifyUser(authUser, authPass)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
  }

  // --- Workspace Sync APIs (Authenticated) ---
  if (url.pathname === '/api/manifest') {
    const workspace = query.workspace || 'default-workspace';
    const wsDir = path.join(dbDir, 'workspaces', workspace);
    const manifest = {};

    const readDirRecursive = (dir, currentSubPath = '') => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const relPath = currentSubPath ? `${currentSubPath}/${file}` : file;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          readDirRecursive(fullPath, relPath);
        } else {
          manifest[relPath] = {
            size: stat.size,
            mtime: stat.mtimeMs
          };
        }
      }
    };

    if (fs.existsSync(wsDir)) {
      readDirRecursive(wsDir);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(manifest));
    return;
  }

  if (url.pathname === '/api/upload' && req.method === 'POST') {
    const workspace = query.workspace || 'default-workspace';
    const relPath = query.path;
    const mtime = parseInt(query.mtime);

    if (!relPath) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing path parameter');
      return;
    }

    // Path traversal check
    const wsDir = path.resolve(path.join(dbDir, 'workspaces', workspace));
    const targetPath = path.resolve(path.join(wsDir, relPath));
    if (!targetPath.startsWith(wsDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden path');
      return;
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(targetPath, buffer);

        if (!isNaN(mtime)) {
          const mtimeSec = mtime / 1000;
          fs.utimesSync(targetPath, mtimeSec, mtimeSec);
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } catch (e) {
        console.error('[Daemon] Upload failed:', e);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal Server Error: ${e.message}`);
      }
    });
    return;
  }

  if (url.pathname === '/api/download') {
    const workspace = query.workspace || 'default-workspace';
    const relPath = query.path;

    if (!relPath) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing path parameter');
      return;
    }

    // Path traversal check
    const wsDir = path.resolve(path.join(dbDir, 'workspaces', workspace));
    const targetPath = path.resolve(path.join(wsDir, relPath));
    if (!targetPath.startsWith(wsDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden path');
      return;
    }

    if (!fs.existsSync(targetPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }

    try {
      const data = fs.readFileSync(targetPath);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(data);
    } catch (e) {
      console.error('[Daemon] Download failed:', e);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${e.message}`);
    }
    return;
  }

  // Create Standard User (Admin authenticated)
  if (url.pathname === '/api/admin/create-user' && req.method === 'POST') {
    const newUser = query.new_user;
    const newPass = query.new_pass;
    if (!newUser || !newPass) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing credentials parameters');
      return;
    }
    db.registerUser(newUser, newPass);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // Server Diagnostics (Admin authenticated)
  if (url.pathname === '/api/admin/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      uptime: Math.floor(process.uptime()),
      activeRooms: docs.size,
      memoryHeapUsed: process.memoryUsage().heapUsed,
      dbSize: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0
    }));
    return;
  }

  // User list directory (Admin authenticated)
  if (url.pathname === '/api/admin/users') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.listUsers()));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// 4. WebSocket Routing upgrade handler
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // y-websocket format is /sync/room-name. Extract room-name correctly.
  let roomName = url.pathname.replace(/^\/sync\/?/, '');
  roomName = decodeURIComponent(roomName);

  const params = Object.fromEntries(url.searchParams.entries());
  const user = params.user;
  const pass = params.pass;

  if (!db.verifyUser(user, pass)) {
    console.log(`[Daemon] Authentication failed for user: ${user}`);
    ws.close(4001, 'Unauthorized credentials');
    return;
  }

  console.log(`[Daemon] Client connected to room: ${roomName}`);

  // Load and apply Y.Doc from local file database
  let doc = docs.get(roomName);
  if (!doc) {
    doc = new Y.Doc();
    const storedUpdates = db.getUpdates(roomName);
    console.log(`[Daemon] Loaded ${storedUpdates.length} updates for room: ${roomName}`);
    
    for (const updateB64 of storedUpdates) {
      try {
        Y.applyUpdate(doc, Buffer.from(updateB64, 'base64'));
      } catch (e) {
        console.error('[Daemon] Failed to apply room update vector:', e);
      }
    }
    docs.set(roomName, doc);
  }

  // Bind connection to Yjs network synchronization loop
  setupWSConnection(ws, req, doc);

  // Persistence callback hook on document updates
  doc.on('update', (update) => {
    db.appendUpdate(roomName, Buffer.from(update).toString('base64'));
  });
});

// 5. Handle HTTP server protocol upgrade
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[Daemon] Local Live Cursor sync daemon active on port ${port}`);
});
