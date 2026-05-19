import Database from 'better-sqlite3';
import * as Y from 'yjs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface StorageOptions {
  dbPath: string;
  backupDir: string;
  flushIntervalMs?: number;
}

export class LazyStorage {
  private db: Database.Database;
  private dbPath: string;
  private backupDir: string;
  private flushIntervalMs: number;
  private flushTimers: Map<string, NodeJS.Timeout>;
  private s3: S3Client | null = null;
  private lastS3Backup = 0;
  private s3ThrottleMs = 15 * 60 * 1000; // Throttle to maximum once every 15 minutes

  constructor(options: StorageOptions) {
    this.db = new Database(options.dbPath);
    this.dbPath = options.dbPath;
    this.backupDir = options.backupDir;
    this.flushIntervalMs = options.flushIntervalMs || 5 * 60 * 1000; // Default 5 minutes
    this.flushTimers = new Map();

    this.initDb();
    this.initS3();
  }

  private initDb() {
    this.db.pragma('journal_mode = WAL'); // Better concurrency
    this.db.pragma('synchronous = NORMAL'); // Balance between safety and speed

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        room_id TEXT,
        update_blob BLOB,
        timestamp INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_room ON sync_logs(room_id);

      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password_hash TEXT
      );
    `);
  }

  private initS3() {
    if (process.env.S3_BUCKET) {
      this.s3 = new S3Client({
        endpoint: process.env.S3_ENDPOINT, // e.g. https://<account-id>.r2.cloudflarestorage.com
        region: process.env.S3_REGION || 'auto',
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        }
      });
      console.log('[S3 Backup] Automated cloud backup service enabled.');
    }
  }

  /**
   * Safe S3 backup trigger
   */
  public async backupDbToS3(force = false) {
    if (!this.s3) return;
    const now = Date.now();
    if (!force && now - this.lastS3Backup < this.s3ThrottleMs) {
      return; // Throttled to prevent flooding
    }

    try {
      console.log('[S3 Backup] Copying SQLite DB for cloud upload...');
      const dbContent = await fs.readFile(this.dbPath);
      const key = `backups/live-cursor-backup-${new Date().toISOString().split('T')[0]}.db`;

      console.log(`[S3 Backup] Uploading to S3 bucket: ${process.env.S3_BUCKET}`);
      await this.s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: dbContent,
        ContentType: 'application/x-sqlite3'
      }));

      this.lastS3Backup = now;
      console.log(`[S3 Backup] Cloud backup successful: ${key}`);
    } catch (error) {
      console.error('[S3 Backup] Cloud upload failed:', error);
    }
  }

  /**
   * Simple user registration (for first-time setup or self-hosted admin script)
   */
  public registerUser(username: string, passwordHash: string) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO users (username, password_hash) VALUES (?, ?)');
    stmt.run(username, passwordHash);
  }

  /**
   * Verify user credentials
   */
  public verifyUser(username: string, passwordHash: string): boolean {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE username = ?').get(username) as { password_hash: string } | undefined;
    if (!row) return false;
    return row.password_hash === passwordHash;
  }

  /**
   * List all registered users
   */
  public listUsers(): string[] {
    const rows = this.db.prepare('SELECT username FROM users').all() as { username: string }[];
    return rows.map(r => r.username);
  }

  /**
   * Append a binary update to the SQLite log.
   */
  public appendUpdate(roomId: string, updateBlob: Uint8Array) {
    const stmt = this.db.prepare('INSERT INTO sync_logs (room_id, update_blob, timestamp) VALUES (?, ?, ?)');
    stmt.run(roomId, Buffer.from(updateBlob), Date.now());

    // Reset the idle timer for this room
    this.scheduleFlush(roomId);
  }

  /**
   * Load a Y.Doc for a room by applying all stored updates.
   */
  public async loadDoc(roomId: string): Promise<Y.Doc> {
    const doc = new Y.Doc();
    const rows = this.db.prepare('SELECT update_blob FROM sync_logs WHERE room_id = ? ORDER BY timestamp ASC').all(roomId) as { update_blob: Buffer }[];
    
    this.db.transaction(() => {
      for (const row of rows) {
        Y.applyUpdate(doc, new Uint8Array(row.update_blob));
      }
    })();

    return doc;
  }

  /**
   * Compact the logs for a room.
   * Merges all updates into a single snapshot and deletes the old logs.
   * Call this when all clients disconnect from a room.
   */
  public async compactRoom(roomId: string) {
    const doc = await this.loadDoc(roomId);
    const stateVector = Y.encodeStateAsUpdate(doc);

    const deleteStmt = this.db.prepare('DELETE FROM sync_logs WHERE room_id = ?');
    const insertStmt = this.db.prepare('INSERT INTO sync_logs (room_id, update_blob, timestamp) VALUES (?, ?, ?)');

    // Execute as an atomic transaction
    this.db.transaction(() => {
      deleteStmt.run(roomId);
      insertStmt.run(roomId, Buffer.from(stateVector), Date.now());
    })();

    // Attempt backup to cloud
    this.backupDbToS3().catch(e => console.error(e));
  }

  /**
   * Schedule the lazy flush. If a timer already exists, cancel it and start a new one.
   */
  private scheduleFlush(roomId: string) {
    const existingTimer = this.flushTimers.get(roomId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      await this.flushToMarkdown(roomId);
      this.flushTimers.delete(roomId);
    }, this.flushIntervalMs);

    // Unref so the timer doesn't keep the Node process alive indefinitely
    timer.unref(); 
    this.flushTimers.set(roomId, timer);
  }

  /**
   * Generates the human-readable Markdown backup file.
   */
  public async flushToMarkdown(roomId: string) {
    try {
      const doc = await this.loadDoc(roomId);
      const textType = doc.getText('content');
      const markdownContent = textType.toString();

      // Ensure the backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });

      const safeFilename = encodeURIComponent(roomId) + '.md';
      const filePath = path.join(this.backupDir, safeFilename);

      await fs.writeFile(filePath, markdownContent, 'utf-8');
      console.log(`[Storage] Flushed ${roomId} to ${filePath}`);

      // Attempt S3 backup on successful flush
      this.backupDbToS3().catch(e => console.error(e));
    } catch (error) {
      console.error(`[Storage] Failed to flush ${roomId} to Markdown:`, error);
    }
  }

  public async close() {
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
    this.db.close();
  }
}
