import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, MarkdownView, Notice, debounce } from 'obsidian';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { WebrtcProvider } from 'y-webrtc';
import { yCollab } from 'y-codemirror.next';
import { EditorView } from '@codemirror/view';
import { Compartment, StateEffect } from '@codemirror/state';
import { collaborationExtension } from './collabExtension';
import { LocalSignalingServer } from './signalingServer';
import { SubnetSweeper } from './subnetSweep';
import { reconcileYText } from './reconcile';

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
  signalingUrl: 'wss://signaling.yjs.dev'
}

export default class LiveCursorPlugin extends Plugin {
  settings!: LiveCursorSettings;
  private activeSyncs: Map<string, { doc: Y.Doc, awareness: Awareness, provider?: WebrtcProvider }> = new Map();
  private simulatorInterval: any = null;
  private statusBarItem: HTMLElement | null = null;
  private localSignalingServer: LocalSignalingServer = new LocalSignalingServer(4444);
  private diskDebouncers: Map<string, (file: TFile) => void> = new Map();

  async onload() {
    await this.loadSettings();

    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar();

    // Add ribbon icon to simulate collaborator
    this.addRibbonIcon('users', 'Simulate Collaborator Activity', () => {
      this.toggleSimulator();
    });

    // Add ribbon icon for Host Local Room
    this.addRibbonIcon('server', 'Toggle Local Room Host', () => {
      this.toggleLocalServer();
    });

    // Add command to simulate collaborator
    this.addCommand({
      id: 'toggle-collaborator-simulation',
      name: 'Simulate Remote Collaborator Activity',
      callback: () => {
        this.toggleSimulator();
      }
    });

    // Add command to host local room
    this.addCommand({
      id: 'toggle-local-room',
      name: 'Host/Stop Local Room Server',
      callback: () => {
        this.toggleLocalServer();
      }
    });

    // Add command to find local host
    this.addCommand({
      id: 'find-local-host',
      name: 'Find Local Host on Subnet',
      callback: async () => {
        const sweeper = new SubnetSweeper(4444, 2000);
        const url = await sweeper.findHost();
        if (url) {
          this.settings.signalingUrl = url;
          await this.saveSettings();
          new Notice(`Host found at ${url}! Settings updated.`);
          this.reconnectAll();
        } else {
          new Notice('Could not find any active hosts on the local network.');
        }
      }
    });

    this.addSettingTab(new LiveCursorSettingTab(this.app, this));

    // Listen to file opens to inject dummy Y.Doc
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        if (!leaf) return;
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file) {
          this.syncFile(view.file);
        }
      })
    );

    // Listen to active leaves to clean up memory (No Cartoon Memory Leaks)
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
            console.log(`[LiveCursor] Cleaning up memory for closed file ${path}`);
            if (sync.provider) {
              sync.provider.disconnect();
            }
            sync.doc.destroy();
            this.activeSyncs.delete(path);
            this.diskDebouncers.delete(path);
          }
        }
        this.updateStatusBar();
      })
    );

    // Listen to external/local file modifications to synchronize back into Yjs
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

    // Initial sync for currently active file
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file) {
      this.syncFile(activeView.file);
    }
  }

  private reconnectAll() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file) {
        const sync = this.activeSyncs.get(leaf.view.file.path);
        if (sync && sync.provider) {
          // Re-initialize the provider with the new settings
          sync.provider.disconnect();
          const doc = sync.doc;
          const awareness = sync.awareness;
          
          const fileRoomName = `${this.settings.roomName}-${encodeURIComponent(leaf.view.file.path)}`;
          const signaling = this.settings.signalingUrl ? [this.settings.signalingUrl] : ['wss://signaling.yjs.dev'];
          
          sync.provider = new WebrtcProvider(fileRoomName, doc, {
            awareness,
            signaling,
            peerOpts: {
              config: {
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
                iceCandidatePoolSize: 0,
                iceTransportPolicy: 'all'
              }
            }
          });
        }
      }
    });
    this.updateStatusBar();
  }

  onunload() {
    if (this.simulatorInterval) {
      clearInterval(this.simulatorInterval);
      this.simulatorInterval = null;
    }
    for (const [path, sync] of this.activeSyncs.entries()) {
      if (sync.provider) {
        sync.provider.disconnect();
      }
      sync.doc.destroy();
    }
    this.activeSyncs.clear();
    this.localSignalingServer.stop();
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
      console.log(`[LiveCursor] Starting sync for ${file.path}`);
      const doc = new Y.Doc();
      const ytext = doc.getText('content');
      
      // Load current content into YText so it isn't empty
      const localContent = await this.app.vault.read(file);
      if (ytext.toString() !== localContent) {
        ytext.insert(0, localContent);
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

      const awareness = new Awareness(doc);

      // Set our own profile
      awareness.setLocalStateField('user', {
        name: this.settings.nickname,
        color: this.settings.cursorColor,
        colorLight: this.settings.cursorColor + '33'
      });

      // Construct a unique room name per file within the user's workspace
      const fileRoomName = `${this.settings.roomName}-${encodeURIComponent(file.path)}`;
      
      const signaling = this.settings.signalingUrl ? [this.settings.signalingUrl] : ['wss://signaling.yjs.dev'];

      // Initialize WebrtcProvider with custom peerOpts to prevent offline ICE hangs
      const provider = new WebrtcProvider(fileRoomName, doc, {
        awareness,
        signaling,
        peerOpts: {
          config: {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            iceCandidatePoolSize: 0,
            iceTransportPolicy: 'all'
          }
        }
      });

      sync = { doc, awareness, provider };
      this.activeSyncs.set(file.path, sync);
      this.updateStatusBar();

      this.configureEditorForFile(file);
    } else {
      this.configureEditorForFile(file);
      this.updateStatusBar();
    }
  }

  async toggleLocalServer() {
    if (this.localSignalingServer.isRunning()) {
      this.localSignalingServer.stop();
      this.settings.signalingUrl = 'wss://signaling.yjs.dev';
      await this.saveSettings();
      this.reconnectAll();
    } else {
      try {
        await this.localSignalingServer.start();
        // Automatically set the local setting to localhost if we are hosting
        this.settings.signalingUrl = 'ws://localhost:4444';
        await this.saveSettings();
        new Notice('Signaling URL updated to local host.');
        this.reconnectAll();
      } catch (e) {
        // Error is handled inside the start promise
      }
    }
    this.updateStatusBar();
  }

  toggleSimulator() {
    if (this.simulatorInterval) {
      clearInterval(this.simulatorInterval);
      this.simulatorInterval = null;
      new Notice('Collaborator simulation stopped.');
      this.updateStatusBar();
      
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
      if (sync.provider && sync.provider.connected) {
        activeConnections++;
      }
    }

    if (this.simulatorInterval) {
      this.statusBarItem.setText('🟢 Live Cursor (Simulating)');
    } else if (activeConnections > 0) {
      this.statusBarItem.setText(`🟢 Live Cursor (${activeConnections} synced)`);
    } else {
      this.statusBarItem.setText('🟢 Live Cursor (Standby)');
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

    new Setting(containerEl)
      .setName('Room Name')
      .setDesc('A unique identifier for your vault mesh. Keep this identical across devices.')
      .addText(text => text
        .setValue(this.plugin.settings.roomName)
        .onChange(async (val) => {
          this.plugin.settings.roomName = val;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Custom Signaling URL')
      .setDesc('The WebSocket URL of the signaling server (e.g., ws://192.168.1.5:4444). Leave blank to use defaults.')
      .addText(text => text
        .setValue(this.plugin.settings.signalingUrl)
        .onChange(async (val) => {
          this.plugin.settings.signalingUrl = val;
          await this.plugin.saveSettings();
        }));

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
}
