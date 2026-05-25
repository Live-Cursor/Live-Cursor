import { Extension, Compartment, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';

// 1. Define custom state effects for Yjs Awareness changes
const awarenessEffect = StateEffect.define<void>();

/**
 * Premium cursor widget rendering a dynamic blinking caret with a floating username badge.
 * Features automatic activity-based fade-out and hover-based recovery.
 */
class CursorWidget extends WidgetType {
  constructor(private name: string, private color: string) {
    super();
  }

  toDOM(): HTMLElement {
    const cursorContainer = document.createElement('span');
    cursorContainer.className = 'cm-remote-cursor-container';
    cursorContainer.style.position = 'relative';
    cursorContainer.style.userSelect = 'none';

    // The vertical colored caret line matching editor text size
    const cursorCaret = document.createElement('span');
    cursorCaret.className = 'cm-remote-cursor-caret';
    cursorCaret.style.borderLeft = `2px solid ${this.color}`;
    cursorCaret.style.position = 'absolute';
    cursorCaret.style.height = '1.2em';
    cursorCaret.style.top = '-0.1em';
    cursorCaret.style.zIndex = '100';

    // Small colored circle connector dot at the top of the caret
    const cursorDot = document.createElement('span');
    cursorDot.className = 'cm-remote-cursor-dot';
    cursorDot.style.position = 'absolute';
    cursorDot.style.width = '6px';
    cursorDot.style.height = '6px';
    cursorDot.style.borderRadius = '50%';
    cursorDot.style.background = this.color;
    cursorDot.style.top = '-3px';
    cursorDot.style.left = '-3px'; // Centered over 2px border caret line

    // Persistent floating username flag badge (never fades out)
    const cursorFlag = document.createElement('span');
    cursorFlag.className = 'cm-remote-cursor-flag';
    cursorFlag.textContent = this.name;
    cursorFlag.style.position = 'absolute';
    cursorFlag.style.left = '-1px'; // Aligns perfectly with the left border caret
    cursorFlag.style.bottom = 'calc(100% - 2px)'; // Fuses bottom of flag flush with top of caret/dot
    cursorFlag.style.background = this.color;
    cursorFlag.style.color = '#ffffff';
    cursorFlag.style.fontSize = '11px';
    cursorFlag.style.fontWeight = '600';
    cursorFlag.style.padding = '2px 6px';
    // Rounded bubble styling with bottom-left corner sharp to act as indicator pin
    cursorFlag.style.borderRadius = '0px 4px 4px 4px';
    cursorFlag.style.whiteSpace = 'nowrap';
    cursorFlag.style.opacity = '1'; // Persistent (always visible)
    cursorFlag.style.pointerEvents = 'none';
    cursorFlag.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.2)';
    cursorFlag.style.fontFamily = 'var(--font-interface), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    cursorFlag.style.lineHeight = '1.2';

    cursorCaret.appendChild(cursorDot);
    cursorCaret.appendChild(cursorFlag);
    cursorContainer.appendChild(cursorCaret);

    return cursorContainer;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// 2. Custom CSS animations and rules
const collabTheme = EditorView.theme({
  '@keyframes cm-cursor-blink': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.3 }
  },
  '.cm-remote-cursor-container': {
    display: 'inline-block',
    width: '0',
    overflow: 'visible',
    verticalAlign: 'middle'
  }
});

// 3. Selection Tracker: Writes local movements to Yjs Awareness
const localSelectionTracker = (awareness: any) =>
  ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.trackSelection(view);
      }

      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged) {
          this.trackSelection(update.view);
        }
      }

      trackSelection(view: EditorView) {
        const selection = view.state.selection.main;
        const currentCursor = awareness.getLocalStateField('cursor');

        // Prevent redundant state updates
        if (!currentCursor || currentCursor.anchor !== selection.anchor || currentCursor.head !== selection.head) {
          awareness.setLocalStateField('cursor', {
            anchor: selection.anchor,
            head: selection.head
          });
        }
      }
    }
  );

// 4. Awareness Remote Listener: Triggers CodeMirror updates on awareness change
const remoteAwarenessListener = (awareness: any) =>
  ViewPlugin.fromClass(
    class {
      private listener: () => void;

      constructor(private view: EditorView) {
        this.listener = () => {
          setTimeout(() => {
            if (!this.view.isDestroyed) {
              this.view.dispatch({
                effects: awarenessEffect.of()
              });
            }
          }, 0);
        };
        awareness.on('change', this.listener);
      }

      destroy() {
        awareness.off('change', this.listener);
      }
    }
  );

// 5. Presence Decorator StateField: Resolves active remote selections and cursors
const presenceStateField = (awareness: any) =>
  StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },

    update(decorations, tr) {
      // Step 1: Map existing decoration offsets to support local modifications gracefully
      decorations = decorations.map(tr.changes);

      // Step 2: Rebuild decorations on awareness changes or document updates
      const updatedByAwareness = tr.effects.some((e) => e.is(awarenessEffect));
      if (!updatedByAwareness && !tr.docChanged) {
        return decorations;
      }

      const docLength = tr.state.doc.length;
      const localClientId = awareness.clientID;
      const decos: any[] = [];

      // Loop through all active collaborator states
      for (const [clientId, state] of awareness.getStates().entries()) {
        if (clientId === localClientId) continue;

        const user = state.user;
        const cursor = state.cursor;

        if (!user || !cursor) continue;

        const anchor = cursor.anchor;
        const head = cursor.head;

        if (typeof anchor !== 'number' || typeof head !== 'number') continue;
        if (anchor < 0 || anchor > docLength || head < 0 || head > docLength) continue;

        const color = user.color || '#6366f1';
        const colorLight = user.colorLight || `${color}33`;

        // Render Selection Range Highlight
        if (anchor !== head) {
          const from = Math.min(anchor, head);
          const to = Math.max(anchor, head);
          decos.push({
            from,
            to,
            deco: Decoration.mark({
              attributes: {
                class: 'cm-remote-selection',
                style: `background-color: ${colorLight}; border-bottom: 1px dashed ${color}`
              }
            })
          });
        }

        // Render Cursor Widget at cursor head
        decos.push({
          from: head,
          to: head,
          deco: Decoration.widget({
            widget: new CursorWidget(user.name || 'Collaborator', color),
            side: 1
          })
        });
      }

      // CodeMirror requires decorations in the DecorationSet to be strictly sorted by start position
      decos.sort((a, b) => a.from - b.from);

      // Transform objects into CodeMirror Range decorators
      const cmDecos = decos.map((d) => d.deco.range(d.from, d.to));

      return Decoration.set(cmDecos, true);
    },

    provide(field) {
      return EditorView.decorations.from(field);
    }
  });

/**
 * Packaged collaboration extension bundle.
 * Binds CodeMirror 6 to Yjs Awareness.
 */
export function collaborationExtension(awareness: any): Extension[] {
  return [
    collabTheme,
    localSelectionTracker(awareness),
    remoteAwarenessListener(awareness),
    presenceStateField(awareness)
  ];
}
