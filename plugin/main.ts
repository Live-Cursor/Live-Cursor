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

  private reconnectAll() {
    for (const [path, sync] of this.activeSyncs.entries()) {
      if (sync.provider.wsconnected === false) {
        sync.provider.connect();
      }
    }
  }

  onunload() {
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
    // If settings change, we might want to reconnect, but for now we just save.
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

    containerEl.createEl('h2', {text: 'Live Cursor Control Panel'});

    // 1. GENERAL CONFIGURATION SECTION
    containerEl.createEl('h3', {text: 'General Connection'});
    
    new Setting(containerEl)
      .setName('Option 1: Login Portal')
      .setDesc('Configure credentials (Admin or User access levels).')
      .addButton(btn => btn
        .setButtonText('Open Portal')
        .onClick(() => {
          new RoleSelectionModal(this.app, this.plugin, this).open();
        }));

    new Setting(containerEl)
      .setName('Option 2: Server Connection')
      .setDesc('Establish your server websocket gateway URL.')
      .addButton(btn => btn
        .setButtonText('Connect Server')
        .onClick(() => {
          new ConnectionModal(this.app, this.plugin).open();
        }));

    new Setting(containerEl)
      .setName('Option 3: Create Local Server')
      .setDesc('Self-host a secure private backend using Docker.')
      .addButton(btn => btn
        .setButtonText('Generate Script')
        .onClick(() => {
          new CreateServerModal(this.app).open();
        }));

    new Setting(containerEl)
      .setName('Option 4: Config Synchronization')
      .setDesc('Synchronize plugins, themes, and workspace state (.obsidian folder) with the server.')
      .addButton(button => button
        .setButtonText('Sync Now')
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText('Syncing...');
          const engine = new ConfigSyncEngine(
            this.plugin.app,
            this.plugin.settings.serverUrl,
            this.plugin.settings.username,
            this.plugin.settings.passwordHash,
            this.plugin.settings.workspaceName
          );
          await engine.syncConfig();
          button.setDisabled(false);
          button.setButtonText('Sync Now');
        }));

    if (this.plugin.settings.username === 'admin') {
      new Setting(containerEl)
        .setName('Option 5: Admin Console')
        .setDesc('View registered users, server resource consumption, and telemetry.')
        .addButton(btn => btn
          .setButtonText('Launch Dashboard')
          .setCta()
          .onClick(() => {
            new AdminConsoleModal(this.app, this.plugin).open();
          }));
    }

    // Collaborator Profile settings
    containerEl.createEl('br');
    containerEl.createEl('h3', {text: 'Collaborator Profile'});

    new Setting(containerEl)
      .setName('Visual Nickname')
      .setDesc('Your display name shown to other real-time editors in the vault.')
      .addText(text => text
        .setPlaceholder('Anonymous Editor')
        .setValue(this.plugin.settings.nickname)
        .onChange(async (val) => {
          this.plugin.settings.nickname = val;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Cursor Color')
      .setDesc('The color of your cursor and editor selections shown to others.')
      .addColorPicker(color => color
        .setValue(this.plugin.settings.cursorColor)
        .onChange(async (val) => {
          this.plugin.settings.cursorColor = val;
          await this.plugin.saveSettings();
        }));

    // 2. SYSTEM INTEGRATION & DEVELOPER MODE
    containerEl.createEl('br');
    containerEl.createEl('h3', {text: 'System Integration'});

    new Setting(containerEl)
      .setName('Developer Mode')
      .setDesc('Unlock advanced integration layouts, telemetry configuration, and direct text parameters.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.devMode)
        .onChange(async (value) => {
          this.plugin.settings.devMode = value;
          await this.plugin.saveSettings();
          this.display(); // Force-refresh settings view to toggle sub-settings
        }));

    if (this.plugin.settings.devMode) {
      containerEl.createEl('h4', {text: 'Advanced Settings'});

      new Setting(containerEl)
        .setName('Direct Server URL')
        .setDesc('Set connection URL without modal popups.')
        .addText(text => text
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (val) => {
            this.plugin.settings.serverUrl = val;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Direct Username')
        .setDesc('Set active session username directly.')
        .addText(text => text
          .setValue(this.plugin.settings.username)
          .onChange(async (val) => {
            this.plugin.settings.username = val;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Direct Password')
        .setDesc('Set active session password directly.')
        .addText(text => text
          .setValue(this.plugin.settings.passwordHash)
          .onChange(async (val) => {
            this.plugin.settings.passwordHash = val;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Workspace Identifier')
        .setDesc('Set unique isolation key for configuration sync.')
        .addText(text => text
          .setValue(this.plugin.settings.workspaceName)
          .onChange(async (val) => {
            this.plugin.settings.workspaceName = val;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Debug Logging')
        .setDesc('Print verbose synchronization telemetry in the developer console.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.debugLogging)
          .onChange(async (val) => {
            this.plugin.settings.debugLogging = val;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Auto-Sync On Load')
        .setDesc('Automatically run configuration sync when Obsidian registers the plugin.')
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
      .setDesc('Access full administrative configurations and mirrors.')
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

    // Pre-fill "admin" for admin role if username is currently empty
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

    // Dynamic button determination based on admin existence on the server
    let actionText = 'Login';
    if (this.role === 'Admin') {
      try {
        let httpUrl = this.plugin.settings.serverUrl.replace(/^ws/, 'http').replace(/\/sync\/?$/, '');
        const res = await requestUrl({ url: `${httpUrl}/api/admin-exists`, method: 'GET' });
        if (res.status === 200 && !res.json.exists) {
          actionText = 'Save'; // Admin doesn't exist on server yet, bootstrap save/register state
        }
      } catch {
        actionText = 'Save'; // Offline/Fallback state
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
          this.tab.display(); // Force-refresh settings panel!
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
  private timer!: NodeJS.Timeout;

  constructor(app: App, private plugin: LiveCursorPlugin) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Live Cursor Admin Dashboard' });

    const loading = contentEl.createEl('p', { text: 'Fetching server telemetry...' });

    // Persistent DOM elements so 3s intervals don't wipe active form inputs
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

        // Initialize persistent sections once
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
        const errEl = contentEl.createEl('p', { text: 'Could not connect to sync server. Make sure your server is online, and your admin credentials are correct.' });
        errEl.style.color = 'var(--color-red)';
      }
    };

    await fetchStats();

    // Add Collaborator Form (added once, unaffected by refresh interval)
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
              // Clear values
              newUsername = '';
              newPassword = '';
              userTextComp.setValue('');
              passTextComp.setValue('');
              // Immediately refresh user directory
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
