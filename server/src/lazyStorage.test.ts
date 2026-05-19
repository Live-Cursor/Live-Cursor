import { LazyStorage } from './lazyStorage';
import * as Y from 'yjs';
import * as fs from 'fs/promises';
import * as path from 'path';

const DB_PATH = path.join(__dirname, 'test.db');
const BACKUP_DIR = path.join(__dirname, 'backups');

async function runTests() {
  console.log('--- Starting LazyStorage Tests ---');
  
  // Cleanup old test data
  try { await fs.unlink(DB_PATH); } catch (e) {}
  try { await fs.rm(BACKUP_DIR, { recursive: true, force: true }); } catch (e) {}

  const storage = new LazyStorage({
    dbPath: DB_PATH,
    backupDir: BACKUP_DIR,
    flushIntervalMs: 500, // Short interval for testing
  });

  const roomId = 'test-room-1';

  try {
    // Test 1: Append and Load
    console.log('Test 1: Appending updates...');
    const doc1 = new Y.Doc();
    const text1 = doc1.getText('content');
    text1.insert(0, 'Hello');
    
    let update = Y.encodeStateAsUpdate(doc1);
    storage.appendUpdate(roomId, update);

    const doc2 = new Y.Doc();
    const text2 = doc2.getText('content');
    Y.applyUpdate(doc2, update);
    text2.insert(5, ' World');
    
    update = Y.encodeStateAsUpdate(doc2);
    storage.appendUpdate(roomId, update);

    const loadedDoc = await storage.loadDoc(roomId);
    if (loadedDoc.getText('content').toString() !== 'Hello World') {
      throw new Error(`Load test failed, got: ${loadedDoc.getText('content').toString()}`);
    }
    console.log('✅ Test 1 Passed: loadDoc reconstructed state correctly.');

    // Test 2: Compaction
    console.log('Test 2: Compacting room...');
    await storage.compactRoom(roomId);
    
    const compactedDoc = await storage.loadDoc(roomId);
    if (compactedDoc.getText('content').toString() !== 'Hello World') {
      throw new Error(`Compaction test failed, got: ${compactedDoc.getText('content').toString()}`);
    }
    console.log('✅ Test 2 Passed: compactRoom preserved state.');

    // Test 3: Idle Flush
    console.log('Test 3: Waiting for idle flush to Markdown...');
    // We append one more update to trigger the scheduleFlush logic
    const doc3 = new Y.Doc();
    const text3 = doc3.getText('content');
    text3.insert(0, 'Test Flush!');
    const update3 = Y.encodeStateAsUpdate(doc3);
    storage.appendUpdate('flush-room', update3);

    // Wait for the 500ms timeout
    await new Promise((resolve) => setTimeout(resolve, 800));

    const backupFile = path.join(BACKUP_DIR, encodeURIComponent('flush-room') + '.md');
    const fileContent = await fs.readFile(backupFile, 'utf-8');
    
    if (fileContent !== 'Test Flush!') {
      throw new Error(`Flush test failed, file content was: ${fileContent}`);
    }
    console.log('✅ Test 3 Passed: Markdown flushed correctly after idle interval.');

  } catch (error) {
    console.error('❌ Test Failed:', error);
  } finally {
    await storage.close();
    // Cleanup
    try { await fs.unlink(DB_PATH); } catch (e) {}
    try { await fs.rm(BACKUP_DIR, { recursive: true, force: true }); } catch (e) {}
    console.log('--- Tests Completed ---');
  }
}

runTests();
