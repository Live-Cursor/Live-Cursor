import { LazyStorage } from './lazyStorage';
import * as path from 'path';
import * as crypto from 'crypto';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'live-cursor.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: npx tsx src/registerUser.ts <username> <password>');
  process.exit(1);
}

const username = args[0]!;
const password = args[1]!;

const storage = new LazyStorage({
  dbPath: DB_PATH,
  backupDir: BACKUP_DIR,
});

try {
  const passHash = crypto.createHash('sha256').update(password).digest('hex');
  storage.registerUser(username, passHash);
  console.log(`[Success] Registered user "${username}" successfully!`);
} catch (e: any) {
  console.error('[Error] Failed to register user:', e.message);
} finally {
  storage.close();
}
