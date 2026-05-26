const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const { setupWSConnection, docs: yWSdocs } = require('y-websocket/bin/utils');

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
const configDir = path.join(dbDir, 'config');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
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

// Helper for parsing query params
function getQueryParams(reqUrl) {
  const urlObj = new URL(reqUrl, `http://localhost`);
  return Object.fromEntries(urlObj.searchParams.entries());
}

function getConfigWorkspacePath(workspace) {
  const safeWorkspace = encodeURIComponent(workspace || 'default').replace(/%20/g, '_');
  const wsDir = path.join(configDir, safeWorkspace);
  if (!fs.existsSync(wsDir)) {
    fs.mkdirSync(wsDir, { recursive: true });
  }
  return wsDir;
}

// Create standard HTTP server
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  console.log(`[HTTP] ${req.method} ${req.url} - Request received`);

  // --- GET /api/manifest ---
  if (pathname === '/api/manifest' && req.method === 'GET') {
    const params = getQueryParams(req.url);
    const wsDir = getConfigWorkspacePath(params.workspace);
    const manifest = {};

    function scanDir(dir) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else {
          const relPath = path.relative(wsDir, fullPath).replace(/\\/g, '/');
          manifest[relPath] = {
            size: stat.size,
            mtime: stat.mtimeMs,
            device: 'Server'
          };
        }
      }
    }
    
    try {
      scanDir(wsDir);
      console.log(`[HTTP] 200 OK /api/manifest - Scanned ${Object.keys(manifest).length} files for workspace: ${params.workspace}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(manifest));
    } catch (e) {
      console.error(`[HTTP] 500 Error /api/manifest: ${e.message}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- POST /api/upload ---
  if (pathname === '/api/upload' && req.method === 'POST') {
    const params = getQueryParams(req.url);
    const wsDir = getConfigWorkspacePath(params.workspace);
    const relPath = params.path;
    
    if (!relPath || relPath.includes('..')) {
      console.warn(`[HTTP] 400 Bad Request /api/upload - Invalid path: ${relPath}`);
      res.writeHead(400);
      return res.end('Invalid path');
    }

    const fullPath = path.join(wsDir, relPath);
    const targetDir = path.dirname(fullPath);
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileStream = fs.createWriteStream(fullPath);
    req.pipe(fileStream);

    req.on('end', () => {
      // Set the file's mtime to what the client sent, if provided
      if (params.mtime) {
        const mtime = parseInt(params.mtime) / 1000;
        try {
          fs.utimesSync(fullPath, mtime, mtime);
        } catch(e) {}
      }
      console.log(`[HTTP] 200 OK /api/upload - Path: ${relPath} for workspace: ${params.workspace}`);
      res.writeHead(200);
      res.end('Uploaded');
    });
    return;
  }

  // --- GET /api/download ---
  if (pathname === '/api/download' && req.method === 'GET') {
    const params = getQueryParams(req.url);
    const wsDir = getConfigWorkspacePath(params.workspace);
    const relPath = params.path;
    
    if (!relPath || relPath.includes('..')) {
      console.warn(`[HTTP] 400 Bad Request /api/download - Invalid path: ${relPath}`);
      res.writeHead(400);
      return res.end('Invalid path');
    }

    const fullPath = path.join(wsDir, relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[HTTP] 404 Not Found /api/download - Path: ${relPath}`);
      res.writeHead(404);
      return res.end('File not found');
    }

    console.log(`[HTTP] 200 OK /api/download - Path: ${relPath} for workspace: ${params.workspace}`);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    fs.createReadStream(fullPath).pipe(res);
    return;
  }
  // --- DELETE /api/delete ---
  if (pathname === '/api/delete' && req.method === 'DELETE') {
    const params = getQueryParams(req.url);
    const wsDir = getConfigWorkspacePath(params.workspace);
    const relPath = params.path;
    
    if (!relPath || relPath.includes('..')) {
      console.warn(`[HTTP] 400 Bad Request /api/delete - Invalid path: ${relPath}`);
      res.writeHead(400);
      return res.end('Invalid path');
    }

    const fullPath = path.join(wsDir, relPath);
    console.log(`[HTTP] DELETE /api/delete?user=${params.user}&workspace=${params.workspace}&path=${encodeURIComponent(relPath)} - Request received`);

    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`[HTTP] 200 OK /api/delete - Path: ${relPath} for workspace: ${params.workspace}`);
        res.writeHead(200);
        res.end('Deleted');
      } catch (e) {
        console.error(`[HTTP] 500 Error /api/delete: ${e.message}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    } else {
      console.log(`[HTTP] 200 OK /api/delete (Already missing) - Path: ${relPath}`);
      res.writeHead(200);
      res.end('Already deleted');
    }
    return;
  }


  // --- GET /api/room-state ---
  if (pathname === '/api/room-state' && req.method === 'GET') {
    const params = getQueryParams(req.url);
    const relPath = params.path;
    if (!relPath) {
      res.writeHead(400);
      return res.end('Missing path');
    }
    const roomName = `${params.workspace}-${encodeURIComponent(relPath)}`;
    const p = getRoomPath(roomName);
    
    console.log(`[HTTP] GET /api/room-state - Path: ${relPath} for workspace: ${params.workspace}`);
    
    if (fs.existsSync(p)) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from(new Uint8Array([0, 0])));
    }
    return;
  }

  // --- POST /api/room-state ---
  if (pathname === '/api/room-state' && req.method === 'POST') {
    const params = getQueryParams(req.url);
    const wsDir = getConfigWorkspacePath(params.workspace);
    const relPath = params.path;
    
    if (!relPath || relPath.includes('..')) {
      console.warn(`[HTTP] 400 Bad Request /api/room-state - Invalid path: ${relPath}`);
      res.writeHead(400);
      return res.end('Invalid path');
    }

    const roomName = `${params.workspace}-${encodeURIComponent(relPath)}`;
    console.log(`[HTTP] POST /api/room-state - Path: ${relPath} for workspace: ${params.workspace}`);

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const update = Buffer.concat(chunks);
      
      let doc = docs.get(roomName);
      let isNew = false;
      if (!doc) {
        doc = new Y.Doc();
        loadDoc(roomName, doc);
        isNew = true;
      }

      try {
        Y.applyUpdate(doc, new Uint8Array(update));
        saveDoc(roomName, doc);

        // Retrieve text
        const mergedText = doc.getText('content').toString();

        if (isNew) {
          doc.destroy();
        }

        // Also write plain text file to configuration folder so they are synced side-by-side
        const fullPath = path.join(wsDir, relPath);
        const targetDir = path.dirname(fullPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(fullPath, mergedText, 'utf-8');

        console.log(`[HTTP] 200 OK /api/room-state - Successfully merged CRDT for path: ${relPath}`);
        res.writeHead(200);
        res.end('Merged');
      } catch (err) {
        console.error(`[HTTP] 500 Error /api/room-state:`, err);
        if (isNew && doc) doc.destroy();
        res.writeHead(500);
        res.end(`Merge failed: ${err.message}`);
      }
    });
    return;
  }

  console.log(`[HTTP] 200 OK / (default root status check page)`);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Live Cursor Sync Server (WebSocket + DB) is running.');
});

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let roomName = url.pathname.replace(/^\/sync\/?/, '');
  roomName = decodeURIComponent(roomName);

  console.log(`[+] Client connected to room: ${roomName}`);

  // Bind connection to standard y-websocket protocol
  setupWSConnection(ws, req, { docName: roomName });

  // Retrieve the actual shared doc instance that y-websocket creates and manages
  const doc = yWSdocs.get(roomName);
  if (doc && !docs.has(roomName)) {
    loadDoc(roomName, doc);
    docs.set(roomName, doc);
    
    // Setup persistence observer on document updates
    doc.on('update', () => {
      let timeout = saveTimeouts.get(roomName);
      if (timeout) clearTimeout(timeout);
      
      timeout = setTimeout(() => {
        saveDoc(roomName, doc);
        saveTimeouts.delete(roomName);
      }, 500); // Debounce saves by 500ms for near-instant propagation
      
      saveTimeouts.set(roomName, timeout);
    });
  }
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

// Flush pending saves on server termination
function flushAllDocs() {
  console.log('[Database] Flushing all documents to disk before shutdown...');
  for (const [roomName, doc] of docs.entries()) {
    saveDoc(roomName, doc);
  }
}
process.on('SIGTERM', () => {
  flushAllDocs();
  process.exit(0);
});
process.on('SIGINT', () => {
  flushAllDocs();
  process.exit(0);
});
