import { Extension, Compartment, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';

// 1. Define custom state effects for Yjs Awareness changes
const awarenessEffect = StateEffect.define<void>();

/**
 * Premium cursor widget rendering a dynamic blinking caret with a floating username badge.
 */
class CursorWidget extends WidgetType {
  constructor(private name: string, private color: string) {
    super();
  }

  eq(other: CursorWidget): boolean {
    return other.name === this.name && other.color === this.color;
  }

  toDOM(): HTMLElement {
    const cursorContainer = document.createElement('span');
    cursorContainer.className = 'cm-remote-cursor-container';
    cursorContainer.setAttribute('data-collab-user', this.name);
    cursorContainer.style.cssText = 'position: relative; display: inline-block; width: 0; overflow: visible; vertical-align: text-bottom; pointer-events: none; z-index: 200;';

    // The vertical colored caret line
    const cursorCaret = document.createElement('span');
    cursorCaret.className = 'cm-remote-cursor-caret';
    cursorCaret.style.cssText = `
      position: absolute;
      border-left: 2px solid ${this.color};
      height: 1.35em;
      top: -0.05em;
      left: 0;
      z-index: 200;
      pointer-events: none;
      animation: cm-live-cursor-blink 1.2s step-start infinite;
    `;

    // Colored dot at top of caret
    const cursorDot = document.createElement('span');
    cursorDot.style.cssText = `
      position: absolute;
      width: 7px;
      height: 7px;
      border-radius: 50% 50% 50% 0;
      background: ${this.color};
      top: -7px;
      left: -1px;
    `;

    // Username label above the cursor
    const cursorFlag = document.createElement('span');
    cursorFlag.className = 'cm-remote-cursor-flag';
    cursorFlag.textContent = this.name;
    cursorFlag.style.cssText = `
      position: absolute;
      left: -1px;
      top: -1.7em;
      background: ${this.color};
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 5px 2px 5px;
      border-radius: 3px 3px 3px 0;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.4;
      z-index: 201;
      user-select: none;
    `;

    cursorCaret.appendChild(cursorDot);
    cursorCaret.appendChild(cursorFlag);
    cursorContainer.appendChild(cursorCaret);
    return cursorContainer;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// 2. CSS animations injected into CodeMirror theme
const collabTheme = EditorView.baseTheme({
  '@keyframes cm-live-cursor-blink': {
    '0%, 100%': { opacity: '1' },
    '50%': { opacity: '0.15' }
  },
  '.cm-remote-selection': {
    borderRadius: '2px'
  }
});

// 3. Broadcasts local cursor position to remote peers via Yjs Awareness.
//    Fires on every selection change or document update.
const localSelectionTracker = (awareness: any) =>
  ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        // Immediately broadcast on mount so remote peers see us right away
        this.pushCursor(view);
      }

      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged) {
          this.pushCursor(update.view);
        }
      }

      pushCursor(view: EditorView) {
        const sel = view.state.selection.main;
        awareness.setLocalStateField('cursor', {
          anchor: sel.anchor,
          head: sel.head
        });
      }

      destroy() {
        // Clear cursor so remote peers stop showing a stale cursor
        awareness.setLocalStateField('cursor', null);
      }
    }
  );

// 4. Remote Awareness Listener: re-triggers the StateField when any awareness event fires.
//    Uses setTimeout(0) to defer dispatch outside the current CM transaction cycle.
const remoteAwarenessListener = (awareness: any) =>
  ViewPlugin.fromClass(
    class {
      private listener: () => void;

      constructor(private view: EditorView) {
        this.listener = () => {
          // Immediately fire an initial sync when mounted
          setTimeout(() => {
            if (!this.view.isDestroyed) {
              this.view.dispatch({ effects: awarenessEffect.of() });
            }
          }, 0);
        };

        awareness.on('change', this.listener);

        // Fire once on mount to pick up any states already in awareness
        setTimeout(() => {
          if (!this.view.isDestroyed) {
            this.view.dispatch({ effects: awarenessEffect.of() });
          }
        }, 50);
      }

      destroy() {
        awareness.off('change', this.listener);
      }
    }
  );

// 5. Presence StateField: reads awareness and renders remote cursors and selections
const presenceStateField = (awareness: any) =>
  StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },

    update(_, tr) {
      // Only rebuild on awareness trigger OR doc change (to remap positions)
      const updatedByAwareness = tr.effects.some((e) => e.is(awarenessEffect));
      if (!updatedByAwareness && !tr.docChanged) {
        return _.map(tr.changes);
      }

      const docLength = tr.newDoc.length;
      const localClientId = awareness.clientID;
      const decos: Array<{ from: number; to: number; deco: any }> = [];

      const states = awareness.getStates();

      for (const [clientId, state] of states.entries()) {
        // Skip our own state
        if (clientId === localClientId) continue;

        const user = state?.user;
        const cursor = state?.cursor;

        if (!user?.name || !cursor) continue;
        if (cursor.head === null || cursor.head === undefined) continue;

        const anchor = Math.max(0, Math.min(cursor.anchor ?? cursor.head, docLength));
        const head   = Math.max(0, Math.min(cursor.head, docLength));

        const color      = user.color      || '#6366f1';
        const colorLight = user.colorLight || `${color}33`;

        // Render selection highlight if there's a range
        if (anchor !== head) {
          const from = Math.min(anchor, head);
          const to   = Math.max(anchor, head);
          decos.push({
            from,
            to,
            deco: Decoration.mark({
              class: 'cm-remote-selection',
              attributes: {
                style: `background-color: ${colorLight}; border-bottom: 1px dashed ${color};`
              }
            })
          });
        }

        // Render cursor widget at the head position
        decos.push({
          from: head,
          to:   head,
          deco: Decoration.widget({
            widget: new CursorWidget(user.name, color),
            side: 1,
            block: false
          })
        });
      }

      // Sort strictly by from position (required by CodeMirror)
      decos.sort((a, b) => a.from !== b.from ? a.from - b.from : a.to - b.to);

      const ranges = decos.map((d) => d.deco.range(d.from, d.to));

      try {
        return Decoration.set(ranges, true);
      } catch (e) {
        console.warn('[LiveCursor] Decoration.set failed, returning none:', e);
        return Decoration.none;
      }
    },

    provide(field) {
      return EditorView.decorations.from(field);
    }
  });

/**
 * Packaged collaboration extension bundle.
 * Binds CodeMirror 6 to Yjs Awareness for real-time cursor & selection rendering.
 */
export function collaborationExtension(awareness: any): Extension[] {
  return [
    collabTheme,
    localSelectionTracker(awareness),
    remoteAwarenessListener(awareness),
    presenceStateField(awareness)
  ];
}
