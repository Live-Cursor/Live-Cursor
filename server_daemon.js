const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const Y = require('yjs');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');

const docs = new Map();
const messageSync = 0;
const messageAwareness = 1;

const setupWSConnection = (conn, req, doc) => {
  conn.binaryType = 'arraybuffer';
  const awareness = new awarenessProtocol.Awareness(doc);

  const sendSyncStep1 = () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    conn.send(encoding.toUint8Array(encoder));
  };

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

  const docUpdateHandler = (update, origin) => {
    if (origin !== conn) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      conn.send(encoding.toUint8Array(encoder));
    }
  };

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

class BinaryStorage {
  constructor(dbDir) {
    this.dbDir = dbDir;
    this.roomsDir = path.join(dbDir, 'rooms');
    this.usersFile = path.join(dbDir, 'users.json');
    this.users = {};
    if (!fs.existsSync(this.roomsDir)) fs.mkdirSync(this.roomsDir, { recursive: true });
    this.loadUsers();
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.usersFile)) {
        this.users = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
      } else {
        fs.writeFileSync(this.usersFile, '{}');
      }
    } catch (e) {
      console.error('[Daemon] Failed to load users', e);
    }
  }

  registerUser(u, p) { 
    this.users[u] = p; 
    fs.writeFileSync(this.usersFile, JSON.stringify(this.users)); 
  }

  verifyUser(u, p) { 
    return this.users[u] === p; 
  }

  listUsers() { 
    return Object.keys(this.users); 
  }

  getRoomPath(roomId) {
    const safeName = encodeURIComponent(roomId).replace(/%20/g, '_').slice(0, 100);
    return path.join(this.roomsDir, safeName + '.bin');
  }

  loadDoc(roomId, doc) {
    const p = this.getRoomPath(roomId);
    if (fs.existsSync(p)) {
      try {
        const data = fs.readFileSync(p);
        Y.applyUpdate(doc, new Uint8Array(data));
      } catch (e) { 
        console.error(`[Daemon] Failed to load room bin ${roomId}`, e); 
      }
    }
  }

  saveDoc(roomId, doc) {
    const p = this.getRoomPath(roomId);
    try {
      const state = Y.encodeStateAsUpdate(doc);
      fs.writeFileSync(p, Buffer.from(state.buffer, state.byteOffset, state.byteLength));
    } catch (e) { 
      console.error(`[Daemon] Failed to save room bin ${roomId}`, e); 
    }
  }
}

const port = process.env.PORT || 1234;
const dbDir = process.env.DB_DIR || path.join(__dirname, 'data');
const db = new BinaryStorage(dbDir);

console.log(`[Daemon] Local Storage loaded at: ${dbDir}`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams.entries());

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (url.pathname === '/api/admin-exists') {
    const exists = db.listUsers().includes('admin');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ exists }));
    return;
  }

  const isInitialSetup = db.listUsers().length === 0 && url.pathname === '/api/admin/create-user';

  if (!isInitialSetup) {
    const authUser = query.user;
    const authPass = query.pass;
    if (!db.verifyUser(authUser, authPass)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
  }

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

  if (url.pathname === '/api/admin/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      uptime: Math.floor(process.uptime()),
      activeRooms: docs.size,
      memoryHeapUsed: process.memoryUsage().heapUsed
    }));
    return;
  }

  if (url.pathname === '/api/admin/users') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.listUsers()));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocket.Server({ noServer: true });

// Map of doc save timeouts
const saveTimeouts = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
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

  let doc = docs.get(roomName);
  if (!doc) {
    doc = new Y.Doc();
    db.loadDoc(roomName, doc);
    docs.set(roomName, doc);
    
    // Setup debounced persistence hook on document updates
    doc.on('update', () => {
      let timeout = saveTimeouts.get(roomName);
      if (timeout) clearTimeout(timeout);
      
      timeout = setTimeout(() => {
        db.saveDoc(roomName, doc);
        saveTimeouts.delete(roomName);
      }, 2000);
      
      saveTimeouts.set(roomName, timeout);
    });
  }

  setupWSConnection(ws, req, doc);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[Daemon] Local Live Cursor sync daemon active on port ${port}`);
});
