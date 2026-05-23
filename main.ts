import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, MarkdownView, Modal, Notice, requestUrl } from 'obsidian';
import { WebsocketProvider } from 'y-websocket';
import { WebrtcProvider } from 'y-webrtc';
import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension, Compartment } from '@codemirror/state';
import { ConfigSyncEngine } from './configSync';

const collabCompartment = new Compartment();

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
  lastVersion: '0.0.0'
}

export default class LiveCursorPlugin extends Plugin {
  settings!: LiveCursorSettings;
  private activeSyncs: Map<string, { doc: Y.Doc, provider: any }> = new Map();
  private editorExtensions: Extension[] = [];
  public vaultSyncDoc: Y.Doc | null = null;
  public vaultSyncProvider: any = null;

  async onload() {
    await this.loadSettings();
    this.startVaultSyncMesh();

    if (this.settings.lastVersion !== '1.1.0') {
      setTimeout(() => {
        new Notice('Welcome to Live Cursor v1.1.0!\n\nNew Feature: Mobile WebRTC Sync! You can now host servers directly from your phone.', 10000);
      }, 2000);
      this.settings.lastVersion = '1.1.0';
      await this.saveSettings();
    }

    this.addSettingTab(new LiveCursorSettingTab(this.app, this));

    // Register a dynamic editor extension that injects yCollab if a provider exists for the file
    this.registerEditorExtension(this.createCollabExtension());

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
          await engine.syncConfig();
        } catch (e) {
          console.error('[LiveCursor] Startup sync failed:', e);
        }
      }, 3000); // 3s delay to ensure Obsidian indexes are warmed up
    }
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
      let cp: any;
      try {
        cp = (window as any).require('child_process');
      } catch {
        new Notice('Local background daemon only supported on desktop environments.');
        return false;
      }

      if (this.daemonProcess) {
        return true; // Already active
      }

      const adapter = this.app.vault.adapter as any;
      const pluginDir = this.manifest.dir;
      const absolutePluginDir = adapter.getFullPath(pluginDir);
      const daemonScriptPath = `${absolutePluginDir}/server_daemon.js`;

      console.log(`[LiveCursor] Spawning server daemon at: ${daemonScriptPath}`);
      
      const winProcess = (window as any).process;
      const envPath = winProcess ? winProcess.env.PATH : '';

      this.daemonProcess = cp.spawn('node', [daemonScriptPath], {
        env: {
          PORT: '1234',
          DB_DIR: `${absolutePluginDir}/data`,
          PATH: envPath
        }
      });

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
      console.log('[LiveCursor] Terminating background server daemon...');
      this.daemonProcess.kill();
      this.daemonProcess = null;
      new Notice('Local Server Stopped.');
    }
  }

  onunload() {
    this.stopDaemon();
    if (this.vaultSyncProvider) this.vaultSyncProvider.disconnect();
    if (this.vaultSyncDoc) this.vaultSyncDoc.destroy();
    for (const [path, sync] of this.activeSyncs.entries()) {
      sync.provider.disconnect();
      sync.doc.destroy();
    }
    this.activeSyncs.clear();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.startVaultSyncMesh();
  }

  public startVaultSyncMesh() {
    if (this.settings.syncMode !== 'webrtc' || !this.settings.webrtcRoomName) {
      if (this.vaultSyncProvider) {
        this.vaultSyncProvider.disconnect();
        this.vaultSyncProvider = null;
      }
      if (this.vaultSyncDoc) {
        this.vaultSyncDoc.destroy();
        this.vaultSyncDoc = null;
      }
      return;
    }

    if (!this.vaultSyncProvider) {
      console.log('[LiveCursor] Starting persistent WebRTC mesh for Vault Sync');
      this.vaultSyncDoc = new Y.Doc();
      const providerOptions: any = {
        signaling: ['wss://signaling.yjs.dev']
      };
      if (this.settings.webrtcPassword) {
        providerOptions.password = this.settings.webrtcPassword;
      }
      this.vaultSyncProvider = new WebrtcProvider(`vault-mesh-${this.settings.webrtcRoomName}`, this.vaultSyncDoc, providerOptions);
      this.vaultSyncProvider.on('status', (event: any) => {
        console.log('[LiveCursor] Vault Mesh Status:', event.status);
      });

      const engine = new ConfigSyncEngine(
        this.app,
        this.settings.serverUrl,
        this.settings.username,
        this.settings.passwordHash,
        this.settings.workspaceName,
        this.settings.nickname || 'Unknown Device'
      );
      engine.setupBackgroundListener(this.vaultSyncDoc);
    }
  }

  private configureEditorForFile(file: TFile) {
    const sync = this.activeSyncs.get(file.path);
    if (!sync) return;

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
        const cm = (leaf.view.editor as any).cm as EditorView;
        if (cm) {
          const ytext = sync.doc.getText('content');
          cm.dispatch({
            effects: collabCompartment.reconfigure(
              yCollab(ytext, sync.provider.awareness)
            )
          });
          console.log(`[LiveCursor] Bound yCollab to editor for ${file.path}`);
        }
      }
    });
  }

  private syncFile(file: TFile) {
    let sync = this.activeSyncs.get(file.path);

    if (!sync) {
      if (this.settings.syncMode !== 'webrtc' && (!this.settings.serverUrl || !this.settings.username || !this.settings.passwordHash)) {
        return; // Missing settings
      }

      console.log(`[LiveCursor] Starting sync for ${file.path}`);
      const doc = new Y.Doc();
      const ytext = doc.getText('content');

      const roomName = encodeURIComponent(file.path);
      
      let provider: any;
      if (this.settings.syncMode === 'webrtc') {
        const fullRoomName = `${this.settings.webrtcRoomName}-${roomName}`;
        const providerOptions: any = {
          signaling: ['wss://signaling.yjs.dev']
        };
        if (this.settings.webrtcPassword) {
          providerOptions.password = this.settings.webrtcPassword;
        }
        provider = new WebrtcProvider(fullRoomName, doc, providerOptions);
      } else {
        provider = new WebsocketProvider(this.settings.serverUrl, roomName, doc, {
          connect: true,
          params: {
            user: this.settings.username,
            pass: this.settings.passwordHash
          }
        });
      }

      // Dynamic collaborator profile injection for Live Cursors
      provider.awareness.setLocalStateField('user', {
        name: this.settings.nickname || this.settings.username || 'Collaborator',
        color: this.settings.cursorColor || '#6366f1',
        colorLight: (this.settings.cursorColor || '#6366f1') + '33'
      });

      provider.on('status', (event: any) => {
        console.log(`[LiveCursor] Provider status for ${file.path}: ${event.status}`);
      });

      provider.on('sync', async (isSynced: boolean) => {
        if (isSynced) {
          console.log(`[LiveCursor] Synced with server for ${file.path}`);
          
          // Ensure local content merges correctly with the server state.
          const localContent = await this.app.vault.read(file);
          
          if (ytext.toString().length === 0 && localContent.length > 0) {
            ytext.insert(0, localContent);
          } else if (ytext.toString() !== localContent) {
             // We received changes from the server that differ from local disk.
             // y-codemirror.next will update the editor DOM.
             // However, to ensure absolute durability (e.g. mobile sandbox),
             // we defensively write the Yjs truth to the Vault file.
             await this.app.vault.modify(file, ytext.toString());
          }

          this.configureEditorForFile(file);
        }
      });

      // Phase 4: Defensive Vault writing on network updates
      ytext.observe((event, transaction) => {
        // If the change came from a remote peer, save it to disk
        if (!transaction.local) {
           // Debounce this in a real scenario, but write to vault API
           this.app.vault.modify(file, ytext.toString()).catch(e => console.error(e));
        }
      });

      sync = { doc, provider };
      this.activeSyncs.set(file.path, sync);
    }

    // Force editor configuration on layout load
    setTimeout(() => this.configureEditorForFile(file), 100);
  }

  /**
   * Creates a dynamic CodeMirror extension that binds yCollab to the currently active Yjs document
   */
  private createCollabExtension(): Extension {
    return collabCompartment.of([]);
  }
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
    card.createEl('p', { text: 'Host a sync session directly on this computer. Other devices on your Wi-Fi or Tailscale network can join using the IPs below.', attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 16px;' } });

    const isRunning = !!this.plugin.daemonProcess;

    const statusEl = card.createEl('div');
    statusEl.style.marginBottom = '16px';
    statusEl.innerHTML = `<strong>Status:</strong> <span style="color: ${isRunning ? '#10b981' : 'var(--text-error)'}">${isRunning ? '● Active' : '○ Offline'}</span>`;

    if (isRunning) {
      let localIps: string[] = [];
      try {
        const os = (window as any).require('os');
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
          for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
              localIps.push(iface.address);
            }
          }
        }
      } catch {
        // Not on desktop
      }

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
      .setName('Room Password (Optional)')
      .setDesc('Encrypts the WebRTC connection.')
      .addText(text => text.setValue(this.plugin.settings.webrtcPassword).onChange(async v => { this.plugin.settings.webrtcPassword = v; await this.plugin.saveSettings(); }));
      
    new Setting(card)
      .addButton(btn => btn
        .setButtonText('Sync Entire Vault')
        .setCta()
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
          await engine.syncConfigViaWebrtc(this.plugin.vaultSyncDoc);
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

