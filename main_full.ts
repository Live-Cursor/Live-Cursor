import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, MarkdownView, Modal, Notice, requestUrl } from 'obsidian';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { yCollab } from 'y-codemirror.next';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension, Compartment, StateEffect } from '@codemirror/state';
import { ConfigSyncEngine } from './configSync';
import { getPlatform } from './platform';
import { reconcileYText } from './reconcile';
import { collaborationExtension } from './collabExtension';

interface LiveCursorSettings {
  serverUrl: string;
  username: string;
  passwordHash: string;
  devMode: boolean;
  workspaceName: string;
  debugLogging: boolean;
  autoSyncOnLoad: boolean;
  nickname: string;
  cursorColor: string;
  syncMode: 'cloud' | 'local' | 'webrtc';
  webrtcRoomName: string;
  webrtcPassword: string;
  hotspotHostIp: string;
  lastVersion: string;
}

const DEFAULT_SETTINGS: LiveCursorSettings = {
  serverUrl: 'ws://localhost:1234/sync',
  username: '',
  passwordHash: '',
  devMode: false,
  workspaceName: 'default-workspace',
  debugLogging: false,
  autoSyncOnLoad: false,
  nickname: '',
  cursorColor: '#6366f1',
  syncMode: 'local',
  webrtcRoomName: 'default-mesh-room',
  webrtcPassword: '',
  hotspotHostIp: '',
  lastVersion: '0.0.0'
}

export default class LiveCursorPlugin extends Plugin {
  settings!: LiveCursorSettings;
  private activeSyncs: Map<string, { doc: Y.Doc, provider: any, awareness: Awareness }> = new Map();
  private editorExtensions: Extension[] = [];
  public vaultSyncDoc: Y.Doc | null = null;
  public vaultSyncProvider: any = null;
  private simulatorInterval: any = null;
  private statusBarItem: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    // Initialize premium status bar sync indicator
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar();

    // Add ribbon icon to simulate collaborator
    this.addRibbonIcon('users', 'Simulate Collaborator Activity', () => {
      this.toggleSimulator();
    });

    // Add command to simulate collaborator
    this.addCommand({
      id: 'toggle-collaborator-simulation',
      name: 'Simulate Remote Collaborator Activity',
      callback: () => {
        this.toggleSimulator();
      }
    });

    this.startVaultSyncMesh();

    if (this.settings.lastVersion !== '1.1.0') {
      setTimeout(() => {
        new Notice('Welcome to Live Cursor v1.1.0!\n\nNew Feature: Mobile WebRTC Sync! You can now host servers directly from your phone.', 10000);
      }, 2000);
      this.settings.lastVersion = '1.1.0';
      await this.saveSettings();
    }

    this.addSettingTab(new LiveCursorSettingTab(this.app, this));

    // We no longer register a global editor extension, compartments are managed per-instance

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

    // Listen to external/local file modifications to synchronize back into Yjs
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (file instanceof TFile) {
          const sync = this.activeSyncs.get(file.path);
          if (sync) {
            const diskContent = await this.app.vault.read(file);
            const currentYText = sync.doc.getText('content');
            if (currentYText.toString() !== diskContent) {
              reconcileYText(currentYText, diskContent);
            }
          }
        }
      })
    );

    // Initial sync for currently active file
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file) {
      this.syncFile(activeView.file);
    }

    // Phase 4: Mobile Optimization - Background Wake/Reconnect Loop
    this.registerEvent(
      this.app.workspace.on('window-open', () => this.reconnectAll())
    );

    // Watch for visibility changes (mobile wake)
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('[LiveCursor] App resumed, forcing reconnection...');
        this.reconnectAll();
      }
    });

    // Watch for network coming back online
    this.registerDomEvent(window, 'online', () => {
      console.log('[LiveCursor] Network online, forcing reconnection...');
      this.reconnectAll();
    });

    // Auto sync configuration on startup if enabled
    if (this.settings.autoSyncOnLoad && this.settings.username && this.settings.passwordHash) {
      setTimeout(async () => {
        try {
          console.log('[LiveCursor] Triggering startup config auto-sync...');
          const engine = new ConfigSyncEngine(
            this.app,
            this.settings.serverUrl,
            this.settings.username,
            this.settings.passwordHash,
            this.settings.workspaceName,
            this.settings.nickname || 'Unknown Device'
          );
          await engine.syncConfig(true);
        } catch (e) {
          console.error('[LiveCursor] Startup sync failed:', e);
        }
      }, 3000); // 3s delay to ensure Obsidian indexes are warmed up
    }

    // Prevent Yjs Awareness from timing out clients in idle states (defaults to 30s)
    // We ping the local awareness state every 15 seconds to remain permanently visible
    this.registerInterval(
      window.setInterval(() => {
        const now = Date.now();
        for (const sync of this.activeSyncs.values()) {
          if (sync.awareness) {
            sync.awareness.setLocalStateField('keepAlive', now);
          }
        }
      }, 15000)
    );
  }

  public daemonProcess: any = null;

  private reconnectAll() {
    for (const [path, sync] of this.activeSyncs.entries()) {
      if (sync.provider.wsconnected === false) {
        sync.provider.connect();
      }
    }
  }

  async startDaemon(): Promise<boolean> {
    try {
      if (getPlatform().isMobile()) {
        new Notice('Local background daemon only supported on desktop environments.');
        return false;
      }

      if (this.daemonProcess) {
        return true; // Already active
      }

      const adapter = this.app.vault.adapter as any;
      const pluginDir = this.manifest.dir;
      const absolutePluginDir = adapter.getFullPath(pluginDir);

      const winProcess = (window as any).process;
      const envPath = winProcess ? winProcess.env.PATH : '';

      this.daemonProcess = await getPlatform().spawnDaemon(absolutePluginDir, envPath);
      if (!this.daemonProcess) {
        new Notice('Failed to launch background daemon.');
        return false;
      }

      this.daemonProcess.stdout.on('data', (data: any) => {
        console.log(`[Daemon stdout] ${data}`);
      });

      this.daemonProcess.stderr.on('data', (data: any) => {
        console.error(`[Daemon stderr] ${data}`);
      });

      this.daemonProcess.on('close', (code: any) => {
        console.log(`[Daemon] Process exited with code ${code}`);
        this.daemonProcess = null;
      });

      // Simple buffer to let backend warm up
      await new Promise(resolve => setTimeout(resolve, 800));
      return true;
    } catch (e: any) {
      new Notice(`Failed to launch background daemon: ${e.message}`);
      return false;
    }
  }

  stopDaemon() {
    if (this.daemonProcess) {
      getPlatform().killDaemon(this.daemonProcess);
      this.daemonProcess = null;
      new Notice('Local Server Stopped.');
    }
  }

  onunload() {
    if (this.simulatorInterval) {
      clearInterval(this.simulatorInterval);
      this.simulatorInterval = null;
    }
    this.stopDaemon();
    if (this.vaultSyncProvider) this.vaultSyncProvider.disconnect();
    if (this.vaultSyncDoc) this.vaultSyncDoc.destroy();
    for (const [path, sync] of this.activeSyncs.entries()) {
      if (sync.provider) sync.provider.disconnect();
      sync.doc.destroy();
    }
    this.activeSyncs.clear();
  }

  toggleSimulator() {
    if (this.simulatorInterval) {
      clearInterval(this.simulatorInterval);
      this.simulatorInterval = null;
      new Notice('Collaborator simulation stopped.');
      this.updateStatusBar();
      
      // Clean up mock state across all active docs
      for (const sync of this.activeSyncs.values()) {
        const mockClientId = 133742;
        sync.awareness.states.delete(mockClientId);
        sync.awareness.emit('change', [{
          added: [],
          updated: [],
          removed: [mockClientId]
        }]);
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
      const currentActiveView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!currentActiveView || !currentActiveView.file) return;
      const currentSync = this.activeSyncs.get(currentActiveView.file.path);
      if (!currentSync) return;

      const docLength = currentSync.doc.getText('content').length;
      if (docLength === 0) return;

      // Simulate movements and drag selections
      if (Math.random() < 0.2) {
        mockAnchor = Math.floor(Math.random() * docLength);
        mockHead = mockAnchor;
      } else {
        mockHead += typingDirection * Math.floor(Math.random() * 3 + 1);
        if (mockHead >= docLength) {
          mockHead = docLength;
          typingDirection = -1;
        } else if (mockHead <= 0) {
          mockHead = 0;
          typingDirection = 1;
        }

        if (Math.random() < 0.35) {
          mockAnchor = Math.max(0, mockHead - Math.floor(Math.random() * 20 + 5));
        } else {
          mockAnchor = mockHead;
        }
      }

      currentSync.awareness.states.set(mockClientId, {
        user: {
          name: 'Jane Doe (Simulated)',
          color: '#ec4899',
          colorLight: '#ec489922'
        },
        cursor: {
          anchor: mockAnchor,
          head: mockHead
        }
      });

      currentSync.awareness.emit('change', [{
        added: [],
        updated: [mockClientId],
        removed: []
      }]);
    }, 1000);

    new Notice('Collaborator simulation started (Jane Doe is active).');
    this.updateStatusBar();
  }

  updateStatusBar() {
    if (!this.statusBarItem) return;

    let activeConnections = 0;
    for (const sync of this.activeSyncs.values()) {
      if (sync.provider && (sync.provider.wsconnected || sync.provider.connected)) {
        activeConnections++;
      }
    }

    if (this.simulatorInterval) {
      this.statusBarItem.setText('🟢 Live Cursor (Simulating)');
    } else if (activeConnections > 0) {
      this.statusBarItem.setText(`🟢 Live Cursor (${activeConnections} online)`);
    } else {
      this.statusBarItem.setText('🟢 Live Cursor (Standby)');
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.startVaultSyncMesh();
  }

  public startVaultSyncMesh() {
    // WebRTC has been dropped in V2.
    // Configuration sync is now handled strictly via standard REST APIs to the Cloud/Local daemon.
    if (this.vaultSyncProvider) {
      this.vaultSyncProvider.disconnect();
      this.vaultSyncProvider = null;
    }
    if (this.vaultSyncDoc) {
      this.vaultSyncDoc.destroy();
      this.vaultSyncDoc = null;
    }
  }

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
              cm.dispatch({
                effects: StateEffect.appendConfig.of(compartment.of([]))
              });
            }

            const ytext = sync.doc.getText('content');
            cm.dispatch({
              effects: compartment.reconfigure([
                yCollab(ytext, null),
                collaborationExtension(sync.awareness)
              ])
            });
            console.log(`[LiveCursor] Successfully bound collaborationExtension to editor for ${file.path} on retry ${retries}`);
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

  private async syncFile(file: TFile) {
    let sync = this.activeSyncs.get(file.path);

    if (!sync) {
      console.log(`[LiveCursor] Starting local-first sync for ${file.path}`);
      const doc = new Y.Doc();

      // 1. Local CRDT persistence: load past CRDT state if it exists
      const configDir = this.app.vault.configDir;
      const stateDir = `${configDir}/live-cursor-states`;
      const statePath = `${stateDir}/${file.path.replace(/[/\\:]/g, '_')}.bin`;
      
      if (!await this.app.vault.adapter.exists(stateDir)) {
         await this.app.vault.adapter.mkdir(stateDir);
      }
      if (await this.app.vault.adapter.exists(statePath)) {
         try {
            const stateData = await this.app.vault.adapter.readBinary(statePath);
            Y.applyUpdate(doc, new Uint8Array(stateData));
         } catch(e) { console.error('Failed to load local CRDT state', e); }
      }

      const ytext = doc.getText('content');

      // 2. Reconcile current disk content to gracefully handle offline text edits
      const localContent = await this.app.vault.read(file);
      reconcileYText(ytext, localContent);

      // 3. Setup persistence loop for this doc
      let saveTimeout: any = null;
      doc.on('update', () => {
         if (saveTimeout) clearTimeout(saveTimeout);
         saveTimeout = setTimeout(async () => {
            try {
               const state = Y.encodeStateAsUpdate(doc);
               // Safely copy to a new ArrayBuffer to avoid SharedArrayBuffer type errors
               const buffer = new ArrayBuffer(state.byteLength);
               new Uint8Array(buffer).set(state);
               await this.app.vault.adapter.writeBinary(statePath, buffer);
            } catch(e) {}
         }, 1000);
      });

      // Create a local-first Yjs Awareness instance
      const awareness = new Awareness(doc);

      // Dynamic collaborator profile injection for Live Cursors
      awareness.setLocalStateField('user', {
        name: this.settings.nickname || this.settings.username || 'Collaborator',
        color: this.settings.cursorColor || '#6366f1',
        colorLight: (this.settings.cursorColor || '#6366f1') + '33'
      });

      const roomName = encodeURIComponent(file.path);
      
      let provider: any = null;
      let hasNetworkSettings = false;
      let targetServerUrl = '';

      if (this.settings.syncMode === 'cloud') {
         targetServerUrl = this.settings.serverUrl;
         hasNetworkSettings = !!(this.settings.serverUrl && this.settings.username && this.settings.passwordHash);
      } else if (this.settings.syncMode === 'webrtc') {
         const hostIp = this.settings.hotspotHostIp || '127.0.0.1';
         targetServerUrl = `ws://${hostIp}:1234/sync`;
         hasNetworkSettings = !!(this.settings.webrtcRoomName);
      }
      
      if (hasNetworkSettings) {
        provider = new WebsocketProvider(targetServerUrl, roomName, doc, {
          connect: true,
          awareness: awareness,
          params: {
            user: this.settings.username,
            pass: this.settings.webrtcPassword || this.settings.passwordHash
          }
        });
        provider.on('status', (event: any) => {
          console.log(`[LiveCursor] Provider status for ${file.path}: ${event.status}`);
          this.updateStatusBar();
        });

        provider.on('sync', async (isSynced: boolean) => {
          if (isSynced) {
            console.log(`[LiveCursor] Synced with network relay for ${file.path}`);
            this.configureEditorForFile(file);
            this.updateStatusBar();
          }
        });
      }

      // Defensive Vault writing on network updates
      ytext.observe((event, transaction) => {
        // If the change came from a remote peer, save it to disk ONLY if it's not actively open
        if (!transaction.local) {
          let isOpen = false;
          this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
              isOpen = true;
            }
          });
          
          if (!isOpen) {
             this.app.vault.modify(file, ytext.toString()).catch(e => console.error(e));
          }
        }
      });

      sync = { doc, provider, awareness };
      this.activeSyncs.set(file.path, sync);
      this.updateStatusBar();

      // 2. Immediately bind the local editor to the populated Yjs doc & awareness
      this.configureEditorForFile(file);
    } else {
      // Force editor configuration on layout load for existing sessions
      this.configureEditorForFile(file);
      this.updateStatusBar();
    }
  }

  // Dynamic extension generation removed in favor of per-instance compartments
}


class LiveCursorSettingTab extends PluginSettingTab {
  plugin: LiveCursorPlugin;

  constructor(app: App, plugin: LiveCursorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();

    const header = containerEl.createEl('div');
    header.style.marginBottom = '24px';
    const title = header.createEl('h2', {text: 'Live Cursor Collaboration'});
    title.style.margin = '0 0 6px 0';
    title.style.fontSize = '24px';
    title.style.background = 'linear-gradient(90deg, var(--text-accent) 0%, var(--interactive-accent-hover) 100%)';
    title.style.webkitBackgroundClip = 'text';
    title.style.webkitTextFillColor = 'transparent';

    const subtitle = header.createEl('p', {text: 'Zero-configuration real-time note editing and workspace synchronization.'});
    subtitle.style.margin = '0';
    subtitle.style.color = 'var(--text-muted)';
    subtitle.style.fontSize = '13px';

    containerEl.createEl('h3', { text: 'Connection Mode' });
    const modeContainer = containerEl.createEl('div');
    modeContainer.style.display = 'flex';
    modeContainer.style.gap = '10px';
    modeContainer.style.marginBottom = '24px';

    const modes = [
      { id: 'local', name: 'Host Local (LAN/Tailscale)' },
      { id: 'cloud', name: 'Cloud Server' },
      { id: 'webrtc', name: 'WebRTC P2P (Mobile Friendly)' }
    ];

    modes.forEach(m => {
      const btn = modeContainer.createEl('button', { text: m.name });
      if (this.plugin.settings.syncMode === m.id) {
        btn.addClass('mod-cta');
      }
      btn.addEventListener('click', async () => {
        this.plugin.settings.syncMode = m.id as any;
        await this.plugin.saveSettings();
        this.display();
      });
    });

    if (this.plugin.settings.syncMode === 'local') {
      this.renderLocalMode(containerEl);
    } else if (this.plugin.settings.syncMode === 'cloud') {
      this.renderCloudMode(containerEl);
    } else if (this.plugin.settings.syncMode === 'webrtc') {
      this.renderWebrtcMode(containerEl);
    }

    containerEl.createEl('h3', {text: 'Collaborator Profile'});
    
    new Setting(containerEl)
      .setName('Visual Nickname')
      .setDesc('Your display name shown to other editors in the vault.')
      .addText(text => text
        .setPlaceholder('Anonymous Editor')
        .setValue(this.plugin.settings.nickname)
        .onChange(async (val) => {
          this.plugin.settings.nickname = val;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Cursor Color')
      .setDesc('Your cursor color shown in real-time to other editors.')
      .addColorPicker(color => color
        .setValue(this.plugin.settings.cursorColor)
        .onChange(async (val) => {
          this.plugin.settings.cursorColor = val;
          await this.plugin.saveSettings();
        }));
  }

  renderLocalMode(containerEl: HTMLElement) {
    const card = containerEl.createEl('div');
    card.style.background = 'var(--background-secondary)';
    card.style.padding = '20px';
    card.style.borderRadius = '8px';
    card.style.marginBottom = '24px';
    card.style.border = '1px solid var(--text-accent)';

    card.createEl('h3', { text: 'Local Network Hosting', attr: { style: 'margin-top: 0;' } });
    
    if (getPlatform().isMobile()) {
      card.createEl('p', { 
        text: '⚠️ Local Network Hosting is only supported on Desktop. To collaborate offline from your phone, connect to a cloud server or desktop host.',
        attr: { style: 'font-size: 13px; color: var(--text-warning); line-height: 1.4;' } 
      });
      return;
    }

    card.createEl('p', { text: 'Host a sync session directly on this computer. Other devices on your Wi-Fi or Tailscale network can join using the IPs below.', attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 16px;' } });

    const isRunning = !!this.plugin.daemonProcess;

    const statusEl = card.createEl('div');
    statusEl.style.marginBottom = '16px';
    statusEl.innerHTML = `<strong>Status:</strong> <span style="color: ${isRunning ? '#10b981' : 'var(--text-error)'}">${isRunning ? '● Active' : '○ Offline'}</span>`;

    if (isRunning) {
      const localIps = getPlatform().getLocalIPs();

      if (localIps.length > 0) {
        card.createEl('strong', { text: 'Connect other devices to:' });
        const ipList = card.createEl('ul');
        ipList.style.marginTop = '8px';
        ipList.style.fontSize = '14px';
        ipList.style.fontFamily = 'monospace';
        
        localIps.forEach(ip => {
          ipList.createEl('li', { text: `ws://${ip}:1234/sync` });
        });
        
        card.createEl('p', { text: 'Make sure your Username and Password exactly match on joining devices.', attr: { style: 'font-size: 12px; color: var(--text-muted); margin-top: 12px;' } });
      }

      new Setting(card)
        .addButton(btn => btn
          .setButtonText('Sync Vault Configs')
          .onClick(async () => {
            const engine = new ConfigSyncEngine(
              this.plugin.app,
              this.plugin.settings.serverUrl,
              this.plugin.settings.username,
              this.plugin.settings.passwordHash,
              this.plugin.settings.workspaceName,
              this.plugin.settings.nickname || 'Unknown Device'
            );
            btn.setButtonText('Syncing...');
            await engine.syncConfig();
            btn.setButtonText('Sync Vault Configs');
          }))
        .addButton(btn => btn
          .setButtonText('Stop Host')
          .onClick(() => {
            this.plugin.stopDaemon();
            this.display();
          }));

    } else {
      new Setting(card)
        .setName('Username')
        .addText(text => text.setValue(this.plugin.settings.username).onChange(async v => { this.plugin.settings.username = v; await this.plugin.saveSettings(); }));

      new Setting(card)
        .setName('Password')
        .addText(text => text.setValue(this.plugin.settings.passwordHash).onChange(async v => { this.plugin.settings.passwordHash = v; await this.plugin.saveSettings(); }));

      new Setting(card)
        .addButton(btn => btn
          .setButtonText('Start Local Host')
          .setCta()
          .onClick(async () => {
            if (!this.plugin.settings.username || !this.plugin.settings.passwordHash) {
              new Notice('Please set Username and Password to secure the host.');
              return;
            }
            this.plugin.settings.serverUrl = 'ws://localhost:1234/sync';
            await this.plugin.saveSettings();
            await this.plugin.startDaemon();
            this.display();
          }));
    }
  }

  renderCloudMode(containerEl: HTMLElement) {
    const card = containerEl.createEl('div');
    card.style.background = 'var(--background-secondary)';
    card.style.padding = '20px';
    card.style.borderRadius = '8px';
    card.style.marginBottom = '24px';
    card.style.border = '1px solid var(--text-accent)';

    card.createEl('h3', { text: 'Cloud Server Connection', attr: { style: 'margin-top: 0;' } });
    card.createEl('p', { text: 'Connect to an external Live Cursor cloud server for remote collaboration.', attr: { style: 'font-size: 13px; color: var(--text-muted);' } });

    new Setting(card)
      .setName('Server URL')
      .addText(text => text.setValue(this.plugin.settings.serverUrl).onChange(async v => { this.plugin.settings.serverUrl = v; await this.plugin.saveSettings(); }));

    new Setting(card)
      .setName('Username')
      .addText(text => text.setValue(this.plugin.settings.username).onChange(async v => { this.plugin.settings.username = v; await this.plugin.saveSettings(); }));

    new Setting(card)
      .setName('Password')
      .addText(text => text.setValue(this.plugin.settings.passwordHash).onChange(async v => { this.plugin.settings.passwordHash = v; await this.plugin.saveSettings(); }));

    new Setting(card)
      .addButton(btn => btn
        .setButtonText('Sync Vault Configs')
        .onClick(async () => {
          const engine = new ConfigSyncEngine(
            this.plugin.app,
            this.plugin.settings.serverUrl,
            this.plugin.settings.username,
            this.plugin.settings.passwordHash,
            this.plugin.settings.workspaceName,
            this.plugin.settings.nickname || 'Unknown Device'
          );
          btn.setButtonText('Syncing...');
          await engine.syncConfig();
          btn.setButtonText('Sync Vault Configs');
        }))
      .addButton(btn => btn
        .setButtonText('Connect')
        .setCta()
        .onClick(async () => {
          new Notice('Cloud settings saved. Open a file to begin syncing.');
        }));
  }


  renderWebrtcMode(containerEl: HTMLElement) {
    const card = containerEl.createEl('div');
    card.style.background = 'var(--background-secondary)';
    card.style.padding = '20px';
    card.style.borderRadius = '8px';
    card.style.marginBottom = '24px';
    card.style.border = '1px solid var(--text-accent)';

    card.createEl('h3', { text: 'WebRTC P2P Mesh', attr: { style: 'margin-top: 0;' } });
    card.createEl('p', { text: 'True serverless synchronization. Works flawlessly on Mobile and Desktop. Just ensure all devices use the exact same Room Name and Password.', attr: { style: 'font-size: 13px; color: var(--text-muted);' } });

    new Setting(card)
      .setName('Room Name')
      .setDesc('A unique identifier for your vault mesh.')
      .addText(text => text.setValue(this.plugin.settings.webrtcRoomName).onChange(async v => { this.plugin.settings.webrtcRoomName = v; await this.plugin.saveSettings(); }));

    new Setting(card)
      .setName('Host IP Address (Optional)')
      .setDesc('If you are connecting via a Mobile Hotspot, enter the Host\'s IP address (e.g. 172.20.10.1). Leave blank if YOU are the host.')
      .addText(text => text.setValue(this.plugin.settings.hotspotHostIp).onChange(async v => { this.plugin.settings.hotspotHostIp = v; await this.plugin.saveSettings(); }));

    new Setting(card)
      .setName('Room Password (Optional)')
      .setDesc('Encrypts the P2P connection.')
      .addText(text => text.setValue(this.plugin.settings.webrtcPassword).onChange(async v => { this.plugin.settings.webrtcPassword = v; await this.plugin.saveSettings(); }));
      
    new Setting(card)
      .addButton(btn => btn
        .setButtonText('Sync Entire Vault')
        .setCta()
        .onClick(async () => {
          const hostIp = this.plugin.settings.hotspotHostIp || '127.0.0.1';
          const serverUrl = `ws://${hostIp}:1234/sync`;
          const engine = new ConfigSyncEngine(
            this.plugin.app,
            serverUrl,
            this.plugin.settings.username,
            this.plugin.settings.webrtcPassword || this.plugin.settings.passwordHash,
            this.plugin.settings.workspaceName,
            this.plugin.settings.nickname || 'Unknown Device'
          );
          btn.setButtonText('Syncing...');
          await engine.syncConfig();
          btn.setButtonText('Sync Entire Vault');
        }));
  }

}


class RoleSelectionModal extends Modal {
  constructor(app: App, private plugin: LiveCursorPlugin, private tab: LiveCursorSettingTab) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Select Your Role' });
    contentEl.createEl('p', { text: 'Choose your access level to proceed to the login page.' });

    new Setting(contentEl)
      .setName('Admin Portal')
      .setDesc('Access full administrative configurations.')
      .addButton(btn => btn
        .setButtonText('Login as Admin')
        .setCta()
        .onClick(() => {
          this.close();
          new LoginModal(this.app, this.plugin, 'Admin', this.tab).open();
        }));

    new Setting(contentEl)
      .setName('User Portal')
      .setDesc('Standard collaborative real-time editing workspace.')
      .addButton(btn => btn
        .setButtonText('Login as User')
        .onClick(() => {
          this.close();
          new LoginModal(this.app, this.plugin, 'User', this.tab).open();
        }));
  }
  onClose() {
    this.contentEl.empty();
  }
}

class LoginModal extends Modal {
  constructor(app: App, private plugin: LiveCursorPlugin, private role: 'Admin' | 'User', private tab: LiveCursorSettingTab) {
    super(app);
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: `${this.role} Login` });

    let username = this.plugin.settings.username;
    if (this.role === 'Admin' && !username) {
      username = 'admin';
    }
    let password = this.plugin.settings.passwordHash;

    new Setting(contentEl)
      .setName('Username')
      .addText(text => text
        .setValue(username)
        .onChange(v => username = v));

    new Setting(contentEl)
      .setName('Password')
      .addText(text => text
        .setValue(password)
        .onChange(v => password = v));

    let actionText = 'Login';
    if (this.role === 'Admin') {
      try {
        let httpUrl = this.plugin.settings.serverUrl.replace(/^ws/, 'http').replace(/\/sync\/?$/, '');
        const res = await requestUrl({ url: `${httpUrl}/api/admin-exists`, method: 'GET' });
        if (res.status === 200 && !res.json.exists) {
          actionText = 'Save';
        }
      } catch {
        actionText = 'Save';
      }
    }

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText(actionText)
        .setCta()
        .onClick(async () => {
          this.plugin.settings.username = username;
          this.plugin.settings.passwordHash = password;
          await this.plugin.saveSettings();
          this.tab.display();
          new Notice(`${this.role} credentials saved!`);
          this.close();
        }));
  }
  onClose() {
    this.contentEl.empty();
  }
}

class ConnectionModal extends Modal {
  constructor(app: App, private plugin: LiveCursorPlugin) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Server Connection' });

    let url = this.plugin.settings.serverUrl;

    new Setting(contentEl)
      .setName('Server URL')
      .setDesc('e.g. ws://localhost:1234/sync')
      .addText(text => text
        .setValue(url)
        .onChange(v => url = v));

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Save & Connect')
        .setCta()
        .onClick(async () => {
          this.plugin.settings.serverUrl = url;
          await this.plugin.saveSettings();
          new Notice('Server URL saved!');
          this.close();
        }));
  }
  onClose() {
    this.contentEl.empty();
  }
}

class CreateServerModal extends Modal {
  constructor(app: App) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Self-Host Live Cursor' });
    contentEl.createEl('p', { text: 'To deploy a secure, persistent Live Cursor Sync server, create a file named docker-compose.yml and paste the following content to start your server.' });

    const codeBlock = contentEl.createEl('pre');
    const code = codeBlock.createEl('code', { text: 
`version: "3.8"
services:
  live-cursor-server:
    image: ghcr.io/live-cursor/sync-server:latest
    container_name: live-cursor-server
    ports:
      - "1234:1234"
    volumes:
      - ./data:/app/data
      - ./backups:/app/backups
    restart: unless-stopped` 
    });
    code.style.display = 'block';
    code.style.padding = '10px';
    code.style.background = 'var(--background-secondary)';
    code.style.borderRadius = '5px';

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Copy to Clipboard')
        .setCta()
        .onClick(() => {
          navigator.clipboard.writeText(code.innerText);
          new Notice('Copied to clipboard!');
        }));
  }
  onClose() {
    this.contentEl.empty();
  }
}

class AdminConsoleModal extends Modal {
  private timer!: any;

  constructor(app: App, private plugin: LiveCursorPlugin) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Live Cursor Admin Dashboard' });

    const loading = contentEl.createEl('p', { text: 'Fetching server telemetry...' });

    let statsGrid: HTMLDivElement;
    let usersTableContainer: HTMLDivElement;

    const fetchStats = async () => {
      try {
        let httpUrl = this.plugin.settings.serverUrl.replace(/^ws/, 'http').replace(/\/sync\/?$/, '');
        const statusUrl = `${httpUrl}/api/admin/status?user=admin&pass=${this.plugin.settings.passwordHash}`;
        const usersUrl = `${httpUrl}/api/admin/users?user=admin&pass=${this.plugin.settings.passwordHash}`;

        const statusRes = await requestUrl({ url: statusUrl, method: 'GET' });
        const usersRes = await requestUrl({ url: usersUrl, method: 'GET' });

        if (statusRes.status !== 200 || usersRes.status !== 200) {
          throw new Error('Server returned non-200 status');
        }

        if (loading && loading.parentNode) {
          loading.remove();
        }

        const stats = statusRes.json;
        const users = usersRes.json as string[];

        if (!statsGrid) {
          statsGrid = contentEl.createEl('div');
          statsGrid.style.display = 'grid';
          statsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
          statsGrid.style.gap = '10px';
          statsGrid.style.marginBottom = '20px';
        } else {
          statsGrid.empty();
        }

        if (!usersTableContainer) {
          contentEl.createEl('h3', { text: 'Registered Users' });
          usersTableContainer = contentEl.createEl('div');
        } else {
          usersTableContainer.empty();
        }

        const addCard = (label: string, value: string, color: string) => {
          const card = statsGrid.createEl('div');
          card.style.background = 'var(--background-secondary)';
          card.style.border = `1px solid ${color}`;
          card.style.borderRadius = '6px';
          card.style.padding = '12px';
          card.style.textAlign = 'center';
          card.createEl('div', { text: label }).style.fontSize = '11px';
          card.createEl('div', { text: value }).style.fontSize = '20px';
        };

        const memMB = (stats.memoryHeapUsed / 1024 / 1024).toFixed(1);
        const dbKB = (stats.dbSize / 1024).toFixed(1);
        
        addCard('Server Uptime', `${stats.uptime}s`, 'var(--color-green)');
        addCard('Active Rooms', `${stats.activeRooms}`, 'var(--color-blue)');
        addCard('Memory (Heap)', `${memMB} MB`, 'var(--color-purple)');
        addCard('SQLite DB Size', `${dbKB} KB`, 'var(--color-orange)');

        const table = usersTableContainer.createEl('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.marginTop = '10px';

        const headerRow = table.createEl('tr');
        headerRow.style.borderBottom = '2px solid var(--border-color)';
        headerRow.createEl('th', { text: 'Username' }).style.textAlign = 'left';
        headerRow.createEl('th', { text: 'Role' }).style.textAlign = 'right';

        for (const u of users) {
          const row = table.createEl('tr');
          row.style.borderBottom = '1px solid var(--border-color)';
          const cellName = row.createEl('td', { text: u });
          cellName.style.padding = '8px 0';
          const cellRole = row.createEl('td', { text: u === 'admin' ? 'Admin' : 'User' });
          cellRole.style.textAlign = 'right';
          cellRole.style.padding = '8px 0';
          if (u === 'admin') {
            cellRole.style.fontWeight = 'bold';
            cellRole.style.color = 'var(--text-accent)';
          }
        }
      } catch (err) {
        if (loading && loading.parentNode) {
          loading.remove();
        }
        const errEl = contentEl.createEl('p', { text: 'Could not connect to sync server.' });
        errEl.style.color = 'var(--color-red)';
      }
    };

    await fetchStats();

    const formHeading = contentEl.createEl('h3', { text: 'Add New Collaborator' });
    formHeading.style.marginTop = '25px';

    let newUsername = '';
    let newPassword = '';
    let userTextComp: any;
    let passTextComp: any;

    new Setting(contentEl)
      .setName('Username')
      .addText(text => {
        userTextComp = text;
        text.onChange(v => newUsername = v);
      });

    new Setting(contentEl)
      .setName('Password')
      .addText(text => {
        passTextComp = text;
        text.onChange(v => newPassword = v);
      });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Create User')
        .setCta()
        .onClick(async () => {
          if (!newUsername || !newPassword) {
            new Notice('Please fill in both Username and Password fields.');
            return;
          }
          try {
            let httpUrl = this.plugin.settings.serverUrl.replace(/^ws/, 'http').replace(/\/sync\/?$/, '');
            const url = `${httpUrl}/api/admin/create-user?user=admin&pass=${this.plugin.settings.passwordHash}&new_user=${encodeURIComponent(newUsername)}&new_pass=${encodeURIComponent(newPassword)}`;
            const res = await requestUrl({ url, method: 'POST' });
            if (res.status === 200) {
              new Notice(`User "${newUsername}" created successfully!`);
              newUsername = '';
              newPassword = '';
              userTextComp.setValue('');
              passTextComp.setValue('');
              await fetchStats();
            } else {
              new Notice(`Failed to create user: ${res.text}`);
            }
          } catch (e: any) {
            new Notice(`Failed to create user: ${e.message}`);
          }
        }));

    this.timer = setInterval(fetchStats, 3000);
  }

  onClose() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.contentEl.empty();
  }
}

class SetupWizardModal extends Modal {
  private userText = '';
  private userPass = '';
  private serverUrl = '';

  constructor(app: App, private plugin: LiveCursorPlugin, private tab: LiveCursorSettingTab) {
    super(app);
    this.userText = this.plugin.settings.username || '';
    this.userPass = this.plugin.settings.passwordHash || '';
    this.serverUrl = this.plugin.settings.serverUrl || 'ws://localhost:1234/sync';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: 'Live Cursor Onboarding Setup' });
    contentEl.createEl('p', { text: 'Connect your device and start collaborating instantly.' });
    
    const card = contentEl.createEl('div');
    card.style.background = 'var(--background-secondary)';
    card.style.border = '1px solid var(--border-color)';
    card.style.borderRadius = '6px';
    card.style.padding = '20px';
    card.style.marginBottom = '20px';

    new Setting(card)
      .setName('Sync Username')
      .addText(text => text
        .setPlaceholder('e.g. Alice')
        .setValue(this.userText)
        .onChange(v => this.userText = v));

    new Setting(card)
      .setName('Sync Password')
      .addText(text => text
        .setPlaceholder('Enter secure password')
        .setValue(this.userPass)
        .onChange(v => this.userPass = v));

    new Setting(card)
      .setName('Sync Server URL')
      .addText(text => text
        .setPlaceholder('ws://localhost:1234/sync')
        .setValue(this.serverUrl)
        .onChange(v => this.serverUrl = v));

    const buttonContainer = contentEl.createEl('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.marginTop = '15px';

    new Setting(buttonContainer)
      .addButton(btn => btn
        .setButtonText('Connect & Start Syncing!')
        .setCta()
        .onClick(async () => {
          if (!this.userText || !this.userPass) {
            new Notice('Please fill in both username and password.');
            return;
          }

          let targetUrl = this.serverUrl.trim();
          if (!targetUrl) {
            targetUrl = 'ws://localhost:1234/sync';
          }
          if (!targetUrl.startsWith('ws://') && !targetUrl.startsWith('wss://')) {
            targetUrl = `ws://${targetUrl}`;
          }
          if (!targetUrl.endsWith('/sync') && !targetUrl.includes('/sync/')) {
            targetUrl = targetUrl.replace(/\/+$/, '') + '/sync';
          }

          this.plugin.settings.serverUrl = targetUrl;
          await this.plugin.saveSettings();

          new Notice('Initializing sync environment...');

          const isLocal = targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1');
          if (isLocal && !this.plugin.daemonProcess) {
            const launched = await this.plugin.startDaemon();
            if (launched) {
              new Notice('Local background sync daemon launched!');
            }
          }

          try {
            const httpUrl = targetUrl.replace(/^ws/, 'http').replace(/\/sync\/?$/, '');
            const checkUrl = `${httpUrl}/api/admin-exists`;
            
            let userExists = false;
            try {
              const checkRes = await requestUrl({ url: checkUrl, method: 'GET' });
              if (checkRes.status === 200) {
                userExists = checkRes.json.exists;
              }
            } catch (e) {
              console.log('Admin check failed, DB might be empty:', e);
            }

            if (!userExists) {
              const registerUrl = `${httpUrl}/api/admin/create-user?user=${encodeURIComponent(this.userText)}&pass=${encodeURIComponent(this.userPass)}&new_user=${encodeURIComponent(this.userText)}&new_pass=${encodeURIComponent(this.userPass)}`;
              await requestUrl({ url: registerUrl, method: 'POST' });
            }

            this.plugin.settings.username = this.userText;
            this.plugin.settings.passwordHash = this.userPass;
            this.plugin.settings.nickname = this.userText;
            await this.plugin.saveSettings();

            new Notice('Setup complete!');
            this.close();
            this.tab.display();
          } catch (err: any) {
            this.plugin.settings.username = this.userText;
            this.plugin.settings.passwordHash = this.userPass;
            await this.plugin.saveSettings();
            new Notice(`Saved credentials. Server connection pending.`);
            this.close();
            this.tab.display();
          }
        }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

