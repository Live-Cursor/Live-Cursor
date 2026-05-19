const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const Y = require('yjs');
const utils = require('y-websocket/bin/utils');

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
const docs = utils.docs;

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

  // Credentials authorization gate for Admin APIs
  const authUser = query.user;
  const authPass = query.pass;
  if (!db.verifyUser(authUser, authPass)) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
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
  utils.setupConnection(ws, req, doc, roomName);

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

server.listen(port, () => {
  console.log(`[Daemon] Local Live Cursor sync daemon active on port ${port}`);
});
