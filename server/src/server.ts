import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { setupWSConnection, setPersistence, docs } from 'y-websocket/bin/utils';
import { LazyStorage } from './lazyStorage';
import { FileStorage } from './fileStorage';
import * as path from 'path';
import * as url from 'url';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';

const port = process.env.PORT || 1234;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'live-cursor.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const MIRROR_DIR = process.env.MIRROR_DIR || path.join(__dirname, '..', 'data', 'vault_mirror');

const storage = new LazyStorage({
  dbPath: DB_PATH,
  backupDir: BACKUP_DIR,
});

const fileStorage = new FileStorage(MIRROR_DIR);

// Setup default admin user for testing if no users exist
// In production, users should be created via an admin script.
const DEFAULT_USER = process.env.ADMIN_USER || 'admin';
const DEFAULT_PASS = process.env.ADMIN_PASS || '1234';
const defaultPassHash = crypto.createHash('sha256').update(DEFAULT_PASS).digest('hex');

const existingUsers = storage.listUsers();
if (!existingUsers.includes(DEFAULT_USER)) {
  storage.registerUser(DEFAULT_USER, defaultPassHash);
  console.log(`[Auth] Registered default user: ${DEFAULT_USER} (change in production)`);
} else {
  console.log(`[Auth] User directory is not empty. Preserving existing accounts.`);
}

// Integrate LazyStorage with y-websocket persistence
setPersistence({
  bindState: async (docName: string, ydoc: Y.Doc) => {
    // Load from DB
    const persistedDoc = await storage.loadDoc(docName);
    const stateVector = Y.encodeStateAsUpdate(persistedDoc);
    
    // Apply DB state to the current y-websocket shared doc
    Y.applyUpdate(ydoc, stateVector);

    // Whenever this doc gets updated, append to DB
    ydoc.on('update', (update: Uint8Array) => {
      storage.appendUpdate(docName, update);
    });
  },
  writeState: async (docName: string, ydoc: Y.Doc) => {
    // This is called when the doc is being destroyed (all clients left)
    console.log(`[Sync] Room ${docName} empty. Compacting DB.`);
    await storage.compactRoom(docName);
  }
});

const server = http.createServer(async (request, response) => {
  const reqUrl = url.parse(request.url!, true);
  
  if (reqUrl.pathname === '/api/admin-exists') {
    const users = storage.listUsers();
    const exists = users.includes('admin');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ exists }));
    return;
  }

  // Basic Auth Check for API routes
  if (reqUrl.pathname?.startsWith('/api/')) {
    const username = reqUrl.query.user as string;
    const password = reqUrl.query.pass as string;
    
    if (!username || !password) {
      response.writeHead(401);
      response.end('Unauthorized');
      return;
    }
    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    if (!storage.verifyUser(username, passHash)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    const workspace = (reqUrl.query.workspace as string) || 'default-workspace';

    try {
      if (reqUrl.pathname === '/api/manifest') {
        const manifest = await fileStorage.getManifest(workspace);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(manifest));
        return;
      }

      if (reqUrl.pathname === '/api/admin/users') {
        if (username !== 'admin') {
          response.writeHead(403); response.end('Forbidden'); return;
        }
        const usersList = storage.listUsers();
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(usersList));
        return;
      }

      if (reqUrl.pathname === '/api/admin/create-user') {
        if (username !== 'admin') {
          response.writeHead(403); response.end('Forbidden'); return;
        }
        const newUser = reqUrl.query.new_user as string;
        const newPass = reqUrl.query.new_pass as string;
        if (!newUser || !newPass) {
          response.writeHead(400); response.end('Missing fields'); return;
        }
        const newPassHash = crypto.createHash('sha256').update(newPass).digest('hex');
        storage.registerUser(newUser, newPassHash);
        response.writeHead(200);
        response.end('User created');
        return;
      }

      if (reqUrl.pathname === '/api/admin/status') {
        if (username !== 'admin') {
          response.writeHead(403); response.end('Forbidden'); return;
        }
        let dbSize = 0;
        try {
          const stats = await fs.stat(DB_PATH);
          dbSize = stats.size;
        } catch {}

        const statusReport = {
          uptime: Math.floor(process.uptime()),
          memoryHeapUsed: process.memoryUsage().heapUsed,
          memoryHeapTotal: process.memoryUsage().heapTotal,
          activeRooms: docs.size,
          dbSize
        };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(statusReport));
        return;
      }

      if (reqUrl.pathname === '/api/upload') {
        const filePath = reqUrl.query.path as string;
        const mtimeStr = reqUrl.query.mtime as string;
        if (!filePath) {
          response.writeHead(400); response.end('Missing path'); return;
        }
        
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', async () => {
          const buffer = Buffer.concat(chunks);
          const mtime = mtimeStr ? parseInt(mtimeStr, 10) : undefined;
          await fileStorage.saveFile(workspace, filePath, buffer, mtime);
          response.writeHead(200);
          response.end('Uploaded');
        });
        return;
      }

      if (reqUrl.pathname === '/api/download') {
        const filePath = reqUrl.query.path as string;
        if (!filePath) {
          response.writeHead(400); response.end('Missing path'); return;
        }
        const fileData = await fileStorage.readFile(workspace, filePath);
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        response.end(fileData);
        return;
      }
    } catch (e: any) {
      console.error('[API Error]', e);
      response.writeHead(500);
      response.end(e.message || 'Internal Server Error');
      return;
    }
  }

  // Default route
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Live Cursor Sync Server Running');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  try {
    const reqUrl = url.parse(request.url!, true);
    
    // Auth Check
    const username = reqUrl.query.user as string;
    const password = reqUrl.query.pass as string;

    console.log(`[Auth] Connection attempt for user: ${username}, room: ${reqUrl.pathname}, pass: '${password}'`);

    if (!username || !password) {
      console.log(`[Auth] Rejected: Missing credentials`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    
    if (!storage.verifyUser(username, passHash)) {
      console.log(`[Auth] Rejected: Invalid credentials for ${username}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Extract room ID from path, e.g. /sync/workspace1
    // We will use the username as part of the room or just the pathname
    let docName = reqUrl.pathname?.substring(1) || 'default-room';
    if (docName === 'sync') docName = 'default-room'; // fallback
    
    // Prefix with username to isolate workspaces if needed
    // docName = `${username}-${docName}`;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, docName);
    });
  } catch (error) {
    socket.destroy();
  }
});

wss.on('connection', async (conn: WebSocket, req: http.IncomingMessage, docName: string) => {
  // Use y-websocket's standard connection setup
  setupWSConnection(conn, req, { docName, gc: true });
});

server.listen(port, () => {
  console.log(`[Server] Live Cursor Sync Server listening on port ${port}`);
});

process.on('SIGINT', async () => {
  console.log('[Server] Shutting down...');
  await storage.close();
  process.exit(0);
});
