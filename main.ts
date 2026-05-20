import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, MarkdownView, Modal, Notice, requestUrl } from 'obsidian';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { ConfigSyncEngine } from './configSync';

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
  cursorColor: '#6366f1' // Sleek Indigo accent
}

export default class LiveCursorPlugin extends Plugin {
  settings!: LiveCursorSettings;
  private activeSyncs: Map<string, { doc: Y.Doc, provider: WebsocketProvider }> = new Map();
  private editorExtensions: Extension[] = [];

  async onload() {
    await this.loadSettings();

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
            this.settings.workspaceName
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
  }

  private syncFile(file: TFile) {
    if (this.activeSyncs.has(file.path)) {
      return; // Already syncing
    }

    if (!this.settings.serverUrl || !this.settings.username || !this.settings.passwordHash) {
      return; // Missing settings
    }

    console.log(`[LiveCursor] Starting sync for ${file.path}`);
    const doc = new Y.Doc();
    const ytext = doc.getText('content');

    const roomName = encodeURIComponent(file.path);
    
    // Y-Websocket appends roomName to the URL. We must pass auth via params.
    const provider = new WebsocketProvider(this.settings.serverUrl, roomName, doc, {
      connect: true,
      params: {
        user: this.settings.username,
        pass: this.settings.passwordHash
      }
    });

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

    this.activeSyncs.set(file.path, { doc, provider });

    // Force an update to the editor so the yCollab extension picks up the new provider
    this.app.workspace.updateOptions();
  }

  /**
   * Creates a dynamic CodeMirror extension that binds yCollab to the currently active Yjs document
   */
  private createCollabExtension(): Extension {
    const plugin = this;

    return ViewPlugin.fromClass(class {
      constructor(public view: EditorView) {}
      update(update: ViewUpdate) { }
    }, {
      provide: pluginSpec => {
        // We use a compartment or dynamic state to inject yCollab
        return EditorView.updateListener.of((update) => {
           // This is just a placeholder listener. The actual injection of yCollab needs to happen
           // when the editor is created. We will handle this in Phase 4 properly.
        });
      }
    });
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

    // 1. Premium Header
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

    const isConfigured = this.plugin.settings.username && this.plugin.settings.passwordHash && this.plugin.settings.serverUrl;

    // 2. Onboarding Setup Card (Unconfigured State)
    if (!isConfigured) {
      const card = containerEl.createEl('div');
      card.style.background = 'var(--background-secondary)';
      card.style.border = '1px solid var(--text-accent)';
      card.style.borderRadius = '8px';
      card.style.padding = '20px';
      card.style.marginBottom = '24px';
      card.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.05)';

      const cardTitle = card.createEl('h3', { text: 'Setup Connection' });
      cardTitle.style.marginTop = '0';
      cardTitle.style.marginBottom = '8px';
      cardTitle.style.fontSize = '16px';
      cardTitle.style.color = 'var(--text-normal)';

      const cardDesc = card.createEl('p', { text: 'To begin, enter your credentials and the server address. If you are starting fresh, these will automatically be registered as your main security credentials.' });
      cardDesc.style.margin = '0 0 20px 0';
      cardDesc.style.fontSize = '12px';
      cardDesc.style.color = 'var(--text-muted)';

      let tempUser = this.plugin.settings.username || '';
      let tempPass = this.plugin.settings.passwordHash || '';
      let tempUrl = this.plugin.settings.serverUrl || 'ws://localhost:1234/sync';

      new Setting(card)
        .setName('Username')
        .setDesc('Choose a username for your sync profile.')
        .addText(text => text
          .setPlaceholder('e.g. Alice')
          .setValue(tempUser)
          .onChange(v => tempUser = v));

      new Setting(card)
        .setName('Password')
        .setDesc('Enter a secure password.')
        .addText(text => text
          .setPlaceholder('Enter secure password')
          .setValue(tempPass)
          .onChange(v => tempPass = v));

      new Setting(card)
        .setName('Server URL')
        .setDesc('Use the local background daemon or your custom cloud server address.')
        .addText(text => text
          .setPlaceholder('ws://localhost:1234/sync')
          .setValue(tempUrl)
          .onChange(v => tempUrl = v));

      const btnContainer = card.createEl('div');
      btnContainer.style.display = 'flex';
      btnContainer.style.justifyContent = 'flex-end';
      btnContainer.style.marginTop = '20px';

      const connectBtn = btnContainer.createEl('button', { text: 'Connect & Sync' });
      connectBtn.addClass('mod-cta');
      connectBtn.style.padding = '8px 18px';
      connectBtn.style.fontSize = '13px';
      connectBtn.style.fontWeight = 'bold';
      connectBtn.style.borderRadius = '5px';

      connectBtn.addEventListener('click', async () => {
        if (!tempUser || !tempPass) {
          new Notice('Please fill in both Username and Password.');
          return;
        }

        let targetUrl = tempUrl.trim();
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

        // Auto-launch local server daemon if local address
        const isLocal = targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1');
        if (isLocal && !this.plugin.daemonProcess) {
          const launched = await this.plugin.startDaemon();
          if (launched) {
            new Notice('Local background sync server launched!');
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
            // Auto register fresh user as the primary credentials
            const registerUrl = `${httpUrl}/api/admin/create-user?user=${encodeURIComponent(tempUser)}&pass=${encodeURIComponent(tempPass)}&new_user=${encodeURIComponent(tempUser)}&new_pass=${encodeURIComponent(tempPass)}`;
            await requestUrl({ url: registerUrl, method: 'POST' });
          }

          this.plugin.settings.username = tempUser;
          this.plugin.settings.passwordHash = tempPass;
          this.plugin.settings.nickname = tempUser;
          await this.plugin.saveSettings();

          new Notice('Setup complete! Connected to collaboration sync.');
          this.display();
        } catch (err: any) {
          this.plugin.settings.username = tempUser;
          this.plugin.settings.passwordHash = tempPass;
          await this.plugin.saveSettings();
          new Notice(`Credentials saved. Connecting...`);
          this.display();
        }
      });
    }

    // 3. Active Connection Card (Configured State)
    if (isConfigured) {
      const activeCard = containerEl.createEl('div');
      activeCard.style.background = 'var(--background-secondary)';
      activeCard.style.border = '1px solid var(--color-green, #10b981)';
      activeCard.style.borderRadius = '8px';
      activeCard.style.padding = '20px';
      activeCard.style.marginBottom = '24px';
      activeCard.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.05)';

      const cardHeader = activeCard.createEl('div');
      cardHeader.style.display = 'flex';
      cardHeader.style.justifyContent = 'space-between';
      cardHeader.style.alignItems = 'center';
      cardHeader.style.marginBottom = '12px';

      const cardTitle = cardHeader.createEl('h3', { text: 'Active Connection' });
      cardTitle.style.margin = '0';
      cardTitle.style.fontSize = '15px';

      const statusBadge = cardHeader.createEl('span', { text: '● Live Syncing' });
      statusBadge.style.color = '#10b981';
      statusBadge.style.fontWeight = 'bold';
      statusBadge.style.fontSize = '12px';
      statusBadge.style.background = 'rgba(16, 185, 129, 0.1)';
      statusBadge.style.padding = '3px 8px';
      statusBadge.style.borderRadius = '20px';

      const detailsContainer = activeCard.createEl('div');
      detailsContainer.style.fontSize = '13px';
      detailsContainer.style.color = 'var(--text-muted)';
      detailsContainer.style.marginBottom = '20px';

      const serverLine = detailsContainer.createEl('div');
      serverLine.innerHTML = `<strong>Server:</strong> ${this.plugin.settings.serverUrl}`;
      serverLine.style.marginBottom = '4px';

      const userLine = detailsContainer.createEl('div');
      userLine.innerHTML = `<strong>User:</strong> ${this.plugin.settings.username}`;

      const actionRow = activeCard.createEl('div');
      actionRow.style.display = 'flex';
      actionRow.style.gap = '10px';

      const syncBtn = actionRow.createEl('button', { text: 'Sync Vault Settings' });
      syncBtn.addClass('mod-cta');
      syncBtn.style.padding = '6px 14px';
      syncBtn.style.fontSize = '12px';
      syncBtn.style.borderRadius = '4px';
      syncBtn.addEventListener('click', async () => {
        syncBtn.setDisabled(true);
        syncBtn.setButtonText('Syncing...');
        const engine = new ConfigSyncEngine(
          this.plugin.app,
          this.plugin.settings.serverUrl,
          this.plugin.settings.username,
          this.plugin.settings.passwordHash,
          this.plugin.settings.workspaceName
        );
        await engine.syncConfig();
        syncBtn.setDisabled(false);
        syncBtn.setButtonText('Sync Vault Settings');
      });

      const disconnectBtn = actionRow.createEl('button', { text: 'Disconnect' });
      disconnectBtn.style.padding = '6px 14px';
      disconnectBtn.style.fontSize = '12px';
      disconnectBtn.style.borderRadius = '4px';
      disconnectBtn.addEventListener('click', async () => {
        this.plugin.settings.username = '';
        this.plugin.settings.passwordHash = '';
        this.plugin.settings.serverUrl = '';
        await this.plugin.saveSettings();
        new Notice('Disconnected sync environment.');
        this.display();
      });
    }

    // 4. Collaborator Profile
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

    // 5. Collapsible Advanced Technical Settings (Power User Controls)
    containerEl.createEl('br');
    
    const details = containerEl.createEl('details');
    details.style.border = '1px solid var(--border-color)';
    details.style.borderRadius = '6px';
    details.style.padding = '12px';
    details.style.background = 'var(--background-primary)';
    
    const summary = details.createEl('summary', { text: 'Advanced Developer Settings' });
    summary.style.fontWeight = 'bold';
    summary.style.cursor = 'pointer';
    summary.style.color = 'var(--text-muted)';
    summary.style.fontSize = '13px';
    summary.style.outline = 'none';

    const advancedContainer = details.createEl('div');
    advancedContainer.style.marginTop = '12px';

    // Local background server control
    const daemonStatusText = this.plugin.daemonProcess 
      ? 'Local background daemon is running on port 1234.' 
      : 'Local background daemon is offline.';

    const daemonSetting = new Setting(advancedContainer)
      .setName('Local Background Daemon')
      .setDesc(daemonStatusText);

    if (this.plugin.daemonProcess) {
      daemonSetting.addButton(btn => btn
        .setButtonText('Stop Server')
        .onClick(() => {
          this.plugin.stopDaemon();
          this.display();
        }));
    } else {
      daemonSetting.addButton(btn => btn
        .setButtonText('Start Server')
        .onClick(async () => {
          const started = await this.plugin.startDaemon();
          if (started) this.display();
        }));
    }

    new Setting(advancedContainer)
      .setName('Credential Portals')
      .setDesc('Explicitly select role portals for diagnostic logging.')
      .addButton(btn => btn
        .setButtonText('Open Portal')
        .onClick(() => {
          new RoleSelectionModal(this.app, this.plugin, this).open();
        }));

    new Setting(advancedContainer)
      .setName('Self-Host Docker Compose')
      .setDesc('Generate copy-paste docker compose clusters.')
      .addButton(btn => btn
        .setButtonText('Generate Compose')
        .onClick(() => {
          new CreateServerModal(this.app).open();
        }));

    if (this.plugin.settings.username === 'admin') {
      new Setting(advancedContainer)
        .setName('Telemetry Dashboard')
        .setDesc('Diagnostics, active rooms, memory utilization, and users.')
        .addButton(btn => btn
          .setButtonText('Launch Dashboard')
          .onClick(() => {
            new AdminConsoleModal(this.app, this.plugin).open();
          }));
    }

    new Setting(advancedContainer)
      .setName('Developer Direct Inputs')
      .setDesc('Explicitly toggle low-level environment modifications.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.devMode)
        .onChange(async (value) => {
          this.plugin.settings.devMode = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.devMode) {
      new Setting(advancedContainer)
        .setName('Direct Server URL')
        .addText(text => text
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (val) => {
            this.plugin.settings.serverUrl = val;
            await this.plugin.saveSettings();
          }));

      new Setting(advancedContainer)
        .setName('Direct Username')
        .addText(text => text
          .setValue(this.plugin.settings.username)
          .onChange(async (val) => {
            this.plugin.settings.username = val;
            await this.plugin.saveSettings();
          }));

      new Setting(advancedContainer)
        .setName('Direct Password')
        .addText(text => text
          .setValue(this.plugin.settings.passwordHash)
          .onChange(async (val) => {
            this.plugin.settings.passwordHash = val;
            await this.plugin.saveSettings();
          }));

      new Setting(advancedContainer)
        .setName('Workspace Identifier')
        .addText(text => text
          .setValue(this.plugin.settings.workspaceName)
          .onChange(async (val) => {
            this.plugin.settings.workspaceName = val;
            await this.plugin.saveSettings();
          }));

      new Setting(advancedContainer)
        .setName('Debug Logging')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.debugLogging)
          .onChange(async (val) => {
            this.plugin.settings.debugLogging = val;
            await this.plugin.saveSettings();
          }));

      new Setting(advancedContainer)
        .setName('Auto-Sync On Load')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.autoSyncOnLoad)
          .onChange(async (val) => {
            this.plugin.settings.autoSyncOnLoad = val;
            await this.plugin.saveSettings();
          }));
    }
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

