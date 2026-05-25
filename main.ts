import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, MarkdownView, Notice, debounce } from 'obsidian';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import { EditorView } from '@codemirror/view';
import { Compartment, StateEffect } from '@codemirror/state';
import { collaborationExtension } from './collabExtension';
import { reconcileYText } from './reconcile';
import { ConfigSyncEngine } from './configSync';

// Electron/Node APIs — only available on desktop
declare const require: (module: string) => any;

interface LiveCursorSettings {
  nickname: string;
  cursorColor: string;
  roomName: string;
  signalingUrl: string;
}

const DEFAULT_SETTINGS: LiveCursorSettings = {
  nickname: 'Me',
  cursorColor: '#6366f1',
  roomName: 'default-live-cursor-room',
  signalingUrl: 'ws://localhost:4444'
}

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export default class LiveCursorPlugin extends Plugin {
  settings!: LiveCursorSettings;
  private activeSyncs: Map<string, { doc: Y.Doc, awareness: Awareness, provider?: WebsocketProvider }> = new Map();
  private simulatorInterval: any = null;
  private statusBarItem: HTMLElement | null = null;
  private diskDebouncers: Map<string, (file: TFile) => void> = new Map();
  private connectionStatus: ConnectionStatus = 'disconnected';
  private serverProcess: any = null;
  private retryTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private settingsTab: LiveCursorSettingTab | null = null;
  public configSyncEngine: ConfigSyncEngine | null = null;

  async onload() {
    await this.loadSettings();

    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar();

    const serverUrl = this.settings.signalingUrl.trim() || 'ws://localhost:4444';
    this.configSyncEngine = new ConfigSyncEngine(
      this.app,
      serverUrl,
      this.settings.nickname, // Basic auth placeholder
      'default-pass',
      this.settings.roomName, // Using room name as workspace name
      this.settings.nickname
    );

    // Commands
    this.addRibbonIcon('users', 'Simulate Collaborator Activity', () => {
      this.toggleSimulator();
    });

    // Commands
    this.addCommand({
      id: 'toggle-collaborator-simulation',
      name: 'Simulate Remote Collaborator Activity',
      callback: () => { this.toggleSimulator(); }
    });

    this.addCommand({
      id: 'start-local-server',
      name: 'Start Local Sync Server',
      callback: () => { this.startLocalServer(); }
    });

    this.addCommand({
      id: 'stop-local-server',
      name: 'Stop Local Sync Server',
      callback: () => { this.stopLocalServer(); }
    });

    this.addCommand({
      id: 'reconnect-all',
      name: 'Reconnect All Files',
      callback: () => { this.reconnectAll(); }
    });

    this.settingsTab = new LiveCursorSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    // Listen to file opens
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        if (!leaf) return;
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file) {
          this.syncFile(view.file);
        }
      })
    );

    // Clean up closed files
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        const openPaths = new Set<string>();
        this.app.workspace.iterateAllLeaves((leaf) => {
          if (leaf.view instanceof MarkdownView && leaf.view.file) {
            openPaths.add(leaf.view.file.path);
          }
        });

        for (const [path, sync] of this.activeSyncs.entries()) {
          if (!openPaths.has(path)) {
            console.log(`[LiveCursor] Cleaning up closed file: ${path}`);
            const retryTimeout = this.retryTimeouts.get(path);
            if (retryTimeout) clearTimeout(retryTimeout);
            this.retryTimeouts.delete(path);
            if (sync.provider) sync.provider.disconnect();
            sync.doc.destroy();
            this.activeSyncs.delete(path);
            this.diskDebouncers.delete(path);
          }
        }
        this.updateStatusBar();
      })
    );

    // Sync disk changes back into Yjs
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          let debouncer = this.diskDebouncers.get(file.path);
          if (!debouncer) {
            debouncer = debounce(async (f: TFile) => {
              const sync = this.activeSyncs.get(f.path);
              if (sync) {
                const diskContent = await this.app.vault.read(f);
                const currentYText = sync.doc.getText('content');
                if (currentYText.toString() !== diskContent) {
                  reconcileYText(currentYText, diskContent);
                }
              }
            }, 300, true);
            this.diskDebouncers.set(file.path, debouncer);
          }
          debouncer(file);
        }
      })
    );

    // Sync the currently active file
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file) {
      this.syncFile(activeView.file);
    }
  }

  // ─────────────────────────────────────────────
  // LOCAL SERVER MANAGEMENT (Desktop Only)
  // ─────────────────────────────────────────────

  isDesktop(): boolean {
    try {
      require('child_process');
      return true;
    } catch {
      return false;
    }
  }

  isServerRunning(): boolean {
    return this.serverProcess !== null;
  }

  async startLocalServer(): Promise<void> {
    if (!this.isDesktop()) {
      new Notice('Local server can only be started on desktop.');
      return;
    }
    if (this.serverProcess) {
      new Notice('Local server is already running on port 4444.');
      return;
    }

    try {
      const { spawn } = require('child_process');
      const path = require('path');

      // Find the plugin folder — server.js lives alongside main.js
      const pluginDir = (this.app.vault.adapter as any).getBasePath
        ? path.join((this.app.vault.adapter as any).getBasePath(), '.obsidian', 'plugins', 'live-cursor')
        : (this.manifest as any).dir || '';

      const serverPath = path.join(pluginDir, 'server.js');
      console.log(`[LiveCursor] Starting server at: ${serverPath}`);

      this.serverProcess = spawn('node', [serverPath], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.serverProcess.stdout.on('data', (data: Buffer) => {
        console.log(`[LiveCursor Server] ${data.toString().trim()}`);
      });

      this.serverProcess.stderr.on('data', (data: Buffer) => {
        console.error(`[LiveCursor Server ERR] ${data.toString().trim()}`);
      });

      this.serverProcess.on('error', (err: Error) => {
        console.error('[LiveCursor] Failed to start server:', err);
        new Notice(`❌ Failed to start server: ${err.message}`);
        this.serverProcess = null;
        this.settingsTab?.display();
      });

      this.serverProcess.on('exit', (code: number) => {
        console.log(`[LiveCursor] Server exited with code ${code}`);
        this.serverProcess = null;
        this.settingsTab?.display();
        this.updateStatusBar();
      });

      // Give it a moment to start, then reconnect
      setTimeout(() => {
        new Notice('🟢 Local server started on port 4444. Connecting...');
        this.settingsTab?.display();
        this.reconnectAll();
      }, 1500);

    } catch (err: any) {
      console.error('[LiveCursor] Cannot start server:', err);
      new Notice(`❌ Cannot start server: ${err.message}`);
    }
  }

  stopLocalServer(): void {
    if (!this.serverProcess) {
      new Notice('No local server is running.');
      return;
    }
    try {
      this.serverProcess.kill();
      this.serverProcess = null;
      new Notice('⏹ Local server stopped.');
      this.settingsTab?.display();
      this.updateStatusBar();
    } catch (err: any) {
      console.error('[LiveCursor] Failed to stop server:', err);
      new Notice(`❌ Failed to stop server: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────
  // RECONNECT
  // ─────────────────────────────────────────────

  reconnectAll() {
    // Clear all retry timers
    for (const timeout of this.retryTimeouts.values()) clearTimeout(timeout);
    this.retryTimeouts.clear();

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file) {
        const path = leaf.view.file.path;
        const sync = this.activeSyncs.get(path);
        if (sync?.provider) {
          sync.provider.disconnect();
          sync.provider.destroy();
        }
        // Remove from map to force re-create
        this.activeSyncs.delete(path);
        this.syncFile(leaf.view.file);
      }
    });
    this.updateStatusBar();
  }

  onunload() {
    if (this.simulatorInterval) {
      clearInterval(this.simulatorInterval);
      this.simulatorInterval = null;
    }
    for (const timeout of this.retryTimeouts.values()) clearTimeout(timeout);
    this.retryTimeouts.clear();

    for (const [, sync] of this.activeSyncs.entries()) {
      if (sync.provider) {
        sync.provider.disconnect();
        sync.provider.destroy();
      }
      sync.doc.destroy();
    }
    this.activeSyncs.clear();

    this.stopLocalServer();
  }

  // ─────────────────────────────────────────────
  // EDITOR BINDING
  // ─────────────────────────────────────────────

  private configureEditorForFile(file: TFile) {
    const sync = this.activeSyncs.get(file.path);
    if (!sync) return;

    let retries = 0;
    const bind = () => {
      let bound = false;
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
          const cm = (leaf.view.editor as any).cm as EditorView;
          if (cm) {
            let compartment = (cm as any)._liveCursorCompartment;
            if (!compartment) {
              compartment = new Compartment();
              (cm as any)._liveCursorCompartment = compartment;
              cm.dispatch({ effects: StateEffect.appendConfig.of(compartment.of([])) });
            }
            const ytext = sync.doc.getText('content');
            cm.dispatch({
              effects: compartment.reconfigure([
                yCollab(ytext, null),
                collaborationExtension(sync.awareness)
              ])
            });
            bound = true;
          }
        }
      });
      if (!bound && retries < 15) {
        retries++;
        setTimeout(bind, 50);
      }
    };
    bind();
  }

  // ─────────────────────────────────────────────
  // SYNC FILE
  // ─────────────────────────────────────────────

  private async syncFile(file: TFile) {
    if (this.activeSyncs.has(file.path)) {
      this.configureEditorForFile(file);
      this.updateStatusBar();
      return;
    }

    console.log(`[LiveCursor] Starting sync for ${file.path}`);
    const doc = new Y.Doc();
    const ytext = doc.getText('content');

    const awareness = new Awareness(doc);
    awareness.setLocalStateField('user', {
      name: this.settings.nickname,
      color: this.settings.cursorColor,
      colorLight: this.settings.cursorColor + '33'
    });

    const fileRoomName = `${this.settings.roomName}-${encodeURIComponent(file.path)}`;
    const serverUrl = this.settings.signalingUrl.trim() || 'ws://localhost:4444';

    const provider = new WebsocketProvider(serverUrl, fileRoomName, doc, { awareness });

    const sync = { doc, awareness, provider };
    this.activeSyncs.set(file.path, sync);
    this.updateStatusBar();

    // Prevent duplicate initializations and wait for WebSocket sync OR offline fallback
    let hasInitialized = false;
    const initializeCollab = async () => {
      if (hasInitialized) return;
      hasInitialized = true;

      const currentLocalContent = await this.app.vault.read(file);
      if (ytext.toString() === '') {
        ytext.insert(0, currentLocalContent);
      } else if (ytext.toString() !== currentLocalContent) {
        reconcileYText(ytext, currentLocalContent);
      }

      this.configureEditorForFile(file);

      // Write remote changes back to disk if the file isn't open
      ytext.observe((event, transaction) => {
        if (!transaction.local) {
          let isOpen = false;
          this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) isOpen = true;
          });
          if (!isOpen) {
            this.app.vault.modify(file, ytext.toString()).catch(e => console.error(e));
          }
        }
      });
    };

    provider.on('sync', (isSynced: boolean) => {
      if (isSynced) initializeCollab();
    });

    // ── Real connection status tracking ──
    provider.on('status', ({ status }: { status: string }) => {
      console.log(`[LiveCursor] Provider status for ${file.path}: ${status}`);

      if (status === 'connected') {
        this.connectionStatus = 'connected';
        // Clear any pending retry for this file
        const t = this.retryTimeouts.get(file.path);
        if (t) { clearTimeout(t); this.retryTimeouts.delete(file.path); }
        
        // Trigger background vault sync if not already syncing
        if (this.configSyncEngine) {
          this.configSyncEngine.syncConfig(true);
        }
      } else if (status === 'connecting') {
        this.connectionStatus = 'connecting';
      } else if (status === 'disconnected') {
        this.connectionStatus = 'disconnected';
        this.scheduleRetry(file, fileRoomName, doc, awareness, 0);
        // If we fail to connect, initialize offline immediately
        initializeCollab();
      }
      this.updateStatusBar();
    });
  }

  // ─────────────────────────────────────────────
  // AUTO-RETRY WITH BACKOFF
  // ─────────────────────────────────────────────

  private scheduleRetry(file: TFile, roomName: string, doc: Y.Doc, awareness: Awareness, attempt: number) {
    // Don't retry if file was closed
    if (!this.activeSyncs.has(file.path)) return;

    const MAX_ATTEMPTS = 5;
    const DELAYS = [3000, 6000, 12000, 24000, 60000];

    if (attempt >= MAX_ATTEMPTS) {
      const url = this.settings.signalingUrl.trim() || 'ws://localhost:4444';
      const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
      if (isLocal) {
        new Notice(
          '⚠️ Live Cursor: Cannot connect to local server.\n' +
          'Go to Settings → Live Cursor → click "▶ Start Local Server".',
          8000
        );
      } else {
        new Notice(`⚠️ Live Cursor: Cannot connect to ${url}. Check the server is running.`, 8000);
      }
      return;
    }

    const delay = DELAYS[attempt] ?? 60000;
    const t = setTimeout(() => {
      const sync = this.activeSyncs.get(file.path);
      if (!sync) return;

      console.log(`[LiveCursor] Retry ${attempt + 1}/${MAX_ATTEMPTS} for ${file.path}`);
      if (sync.provider) {
        sync.provider.connect();
      }
    }, delay);

    this.retryTimeouts.set(file.path, t);
  }

  // ─────────────────────────────────────────────
  // SIMULATOR
  // ─────────────────────────────────────────────

  toggleSimulator() {
    if (this.simulatorInterval) {
      clearInterval(this.simulatorInterval);
      this.simulatorInterval = null;
      new Notice('Collaborator simulation stopped.');
      this.updateStatusBar();

      for (const sync of this.activeSyncs.values()) {
        const mockClientId = 133742;
        sync.awareness.states.delete(mockClientId);
        sync.awareness.emit('change', [{ added: [], updated: [], removed: [mockClientId] }]);
      }
      return;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      new Notice('Please open a note to simulate collaboration.');
      return;
    }

    const sync = this.activeSyncs.get(activeView.file.path);
    if (!sync) {
      new Notice('Active note is not synced. Opening session...');
      this.syncFile(activeView.file);
      return;
    }

    const mockClientId = 133742;
    let typingDirection = 1;
    let mockAnchor = 0;
    let mockHead = 0;

    this.simulatorInterval = setInterval(() => {
      const currentView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!currentView || !currentView.file) return;
      const currentSync = this.activeSyncs.get(currentView.file.path);
      if (!currentSync) return;

      const docLength = currentSync.doc.getText('content').length;
      if (docLength === 0) return;

      if (Math.random() < 0.2) {
        mockAnchor = Math.floor(Math.random() * docLength);
        mockHead = mockAnchor;
      } else {
        mockHead += typingDirection * Math.floor(Math.random() * 3 + 1);
        if (mockHead >= docLength) { mockHead = docLength; typingDirection = -1; }
        else if (mockHead <= 0) { mockHead = 0; typingDirection = 1; }

        if (Math.random() < 0.35) {
          mockAnchor = Math.max(0, mockHead - Math.floor(Math.random() * 20 + 5));
        } else {
          mockAnchor = mockHead;
        }
      }

      currentSync.awareness.states.set(mockClientId, {
        user: { name: 'Jane Doe (Simulated)', color: '#ec4899', colorLight: '#ec489922' },
        cursor: { anchor: mockAnchor, head: mockHead }
      });
      currentSync.awareness.emit('change', [{ added: [], updated: [mockClientId], removed: [] }]);
    }, 1000);

    new Notice('Collaborator simulation started (Jane Doe is active).');
    this.updateStatusBar();
  }

  // ─────────────────────────────────────────────
  // STATUS BAR
  // ─────────────────────────────────────────────

  updateStatusBar() {
    if (!this.statusBarItem) return;

    if (this.simulatorInterval) {
      this.statusBarItem.setText('Live Cursor 🟣 Simulating');
      return;
    }

    let connected = 0;
    let connecting = 0;
    for (const sync of this.activeSyncs.values()) {
      if (!sync.provider) continue;
      if (sync.provider.wsconnected) connected++;
      else if (!sync.provider.wsconnected && sync.provider.shouldConnect) connecting++;
    }

    if (connected > 0) {
      this.statusBarItem.setText(`Live Cursor 🟢 ${connected} synced`);
    } else if (connecting > 0) {
      this.statusBarItem.setText('Live Cursor 🟡 Connecting...');
    } else if (this.activeSyncs.size > 0) {
      this.statusBarItem.setText('Live Cursor 🔴 Disconnected');
    } else {
      this.statusBarItem.setText('Live Cursor ⚪ Standby');
    }
  }

  // ─────────────────────────────────────────────
  // SETTINGS
  // ─────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ─────────────────────────────────────────────────────────────────
// SETTINGS TAB
// ─────────────────────────────────────────────────────────────────

class LiveCursorSettingTab extends PluginSettingTab {
  plugin: LiveCursorPlugin;

  constructor(app: App, plugin: LiveCursorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Header ──
    const header = containerEl.createEl('div');
    header.style.marginBottom = '24px';
    const title = header.createEl('h2', { text: 'Live Cursor Settings' });
    title.style.margin = '0 0 6px 0';
    const subtitle = header.createEl('p', { text: 'Real-time collaborative editing for your Obsidian vault.' });
    subtitle.style.margin = '0';
    subtitle.style.fontSize = 'var(--font-ui-small)';
    subtitle.style.color = 'var(--text-muted)';

    // ── Section: Profile ──
    containerEl.createEl('h3', { text: '👤 Your Profile', attr: { style: sectionHeaderStyle() } });

    new Setting(containerEl)
      .setName('Collaborator Nickname')
      .setDesc('The name shown next to your cursor on other devices.')
      .addText(text => text
        .setPlaceholder('Anonymous Editor')
        .setValue(this.plugin.settings.nickname)
        .onChange(async (val) => {
          this.plugin.settings.nickname = val || 'Anonymous';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Cursor Color')
      .setDesc('Your cursor and selection highlight color.')
      .addColorPicker(color => color
        .setValue(this.plugin.settings.cursorColor)
        .onChange(async (val) => {
          this.plugin.settings.cursorColor = val;
          await this.plugin.saveSettings();
        }));

    // ── Section: Active Collaborators ──
    containerEl.createEl('h3', { text: '👥 Connected Collaborators', attr: { style: sectionHeaderStyle() } });

    const activeUsers = new Map<string, { name: string, color: string }>();
    for (const sync of this.plugin.activeSyncs.values()) {
      for (const [clientId, state] of sync.awareness.getStates().entries()) {
        if (clientId === sync.awareness.clientID) continue;
        if (state.user?.name) {
          activeUsers.set(state.user.name, state.user);
        }
      }
    }

    const usersContainer = containerEl.createEl('div');
    usersContainer.style.cssText = 'padding: 10px 14px; background: var(--background-secondary); border-radius: 8px; border: 1px solid var(--background-modifier-border); margin-bottom: 16px;';

    if (activeUsers.size === 0) {
      const emptyMsg = usersContainer.createEl('div', { text: 'No other collaborators are currently connected.' });
      emptyMsg.style.color = 'var(--text-muted)';
      emptyMsg.style.fontStyle = 'italic';
      emptyMsg.style.fontSize = 'var(--font-ui-small)';
    } else {
      const listEl = usersContainer.createEl('ul', { attr: { style: 'margin: 0; padding-left: 0; list-style: none;' } });
      for (const user of activeUsers.values()) {
        const li = listEl.createEl('li');
        li.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
        
        const dot = li.createEl('span');
        dot.style.cssText = `display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${user.color}; box-shadow: 0 0 4px ${user.color}88;`;
        
        const nameEl = li.createEl('span', { text: user.name });
        nameEl.style.fontWeight = '500';
      }
      listEl.lastElementChild?.setAttribute('style', listEl.lastElementChild.getAttribute('style') + ' margin-bottom: 0;');
    }

    // ── Section: Local Server ──
    containerEl.createEl('h3', { text: '🖥️ Local Sync Server', attr: { style: sectionHeaderStyle() } });

    // Server status indicator
    const statusEl = containerEl.createEl('div');
    statusEl.style.cssText = 'padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: var(--font-ui-small); display: flex; align-items: center; gap: 10px;';

    const isRunning = this.plugin.isServerRunning();
    if (isRunning) {
      statusEl.style.background = 'rgba(34, 197, 94, 0.12)';
      statusEl.style.border = '1px solid rgba(34, 197, 94, 0.3)';
      statusEl.innerHTML = '<span style="font-size:16px">🟢</span> <span><strong>Server running</strong> on port 4444 — your devices can connect.</span>';
    } else {
      statusEl.style.background = 'rgba(239, 68, 68, 0.1)';
      statusEl.style.border = '1px solid rgba(239, 68, 68, 0.25)';
      statusEl.innerHTML = '<span style="font-size:16px">🔴</span> <span><strong>Server not running.</strong> Start it below to enable local sync.</span>';
    }

    // Server start/stop buttons
    const serverButtonSetting = new Setting(containerEl)
      .setName('Local Server')
      .setDesc('Runs a private sync server on your PC. All your devices on the same network connect through it.');

    if (!isRunning) {
      serverButtonSetting.addButton(btn => btn
        .setButtonText('▶  Start Local Server')
        .setCta()
        .onClick(async () => {
          await this.plugin.startLocalServer();
        }));
    } else {
      serverButtonSetting.addButton(btn => btn
        .setButtonText('⏹  Stop Server')
        .setWarning()
        .onClick(() => {
          this.plugin.stopLocalServer();
        }));
    }

    // Show local IP hint
    const ipHint = containerEl.createEl('div');
    ipHint.style.cssText = 'margin: 0 0 16px 0; padding: 10px 14px; background: var(--background-secondary); border-radius: 8px; font-size: var(--font-ui-small); color: var(--text-muted);';
    ipHint.innerHTML = `
      <strong>📱 Connecting from mobile or another device?</strong><br>
      Find your PC's local IP with <code>ipconfig</code> (Windows) or <code>ifconfig</code> (Mac/Linux),
      then set the server URL below to <code>ws://YOUR_PC_IP:4444</code> on all devices.<br>
      <span style="opacity:0.7">Example: <code>ws://192.168.1.12:4444</code></span>
    `;

    // ── Section: Connection ──
    containerEl.createEl('h3', { text: '🔗 Connection & Room', attr: { style: sectionHeaderStyle() } });

    new Setting(containerEl)
      .setName('Room Name')
      .setDesc('All devices must use the exact same room name to collaborate together.')
      .addText(text => text
        .setPlaceholder('default-live-cursor-room')
        .setValue(this.plugin.settings.roomName)
        .onChange(async (val) => {
          this.plugin.settings.roomName = val || 'default-live-cursor-room';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Server Connection URL')
      .setDesc('The WebSocket server all your devices connect to. Default: ws://localhost:4444 (local server on this PC).')
      .addText(text => text
        .setPlaceholder('ws://localhost:4444')
        .setValue(this.plugin.settings.signalingUrl)
        .onChange(async (val) => {
          this.plugin.settings.signalingUrl = val;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Reconnect All Files')
      .setDesc('Force a reconnection to the server with current settings.')
      .addButton(btn => btn
        .setButtonText('🔄 Reconnect')
        .onClick(() => {
          this.plugin.reconnectAll();
          new Notice('Reconnecting to server...');
        }));

    // ── Section: Full Vault Sync ──
    containerEl.createEl('h3', { text: '📂 Full Vault Sync', attr: { style: sectionHeaderStyle() } });
    
    new Setting(containerEl)
      .setName('Sync Entire Vault Configurations')
      .setDesc('Synchronize plugins, themes, snippets, and all configuration files to the server database. This happens automatically in the background, but you can force it here.')
      .addButton(btn => btn
        .setButtonText('Sync Vault Now')
        .setCta()
        .onClick(async () => {
          if (!this.plugin.configSyncEngine) {
            new Notice('Sync engine not initialized.');
            return;
          }
          await this.plugin.configSyncEngine.syncConfig(false);
        }));
  }
}

function sectionHeaderStyle(): string {
  return 'margin-top: 24px; margin-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px; font-size: 1.05em;';
}
