import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { yCollab, yRemoteSelections } from 'y-codemirror.next';
import * as Y from 'yjs';

/**
 * Premium CSS theme injected into CodeMirror.
 * 
 * y-codemirror.next uses these class names:
 *   .cm-ySelectionCaret       — the cursor line element (has background-color set inline)
 *   .cm-ySelectionCaretDot    — small dot at top of cursor
 *   .cm-ySelectionInfo        — username label (shown on hover by default)
 *   .cm-ySelection            — selection highlight range
 * 
 * We override the default hide-until-hover behaviour so the name is always visible.
 */
const collabTheme = EditorView.baseTheme({
  // ── Cursor caret ────────────────────────────────────────────────────────────
  '.cm-ySelectionCaret': {
    position: 'relative',
    borderLeft: '2px solid',          // colour is set inline by the library
    borderRight: 'none',
    marginLeft: '-1px',
    marginRight: '-1px',
    boxSizing: 'border-box',
    display: 'inline',
    cursor: 'text',
    zIndex: '200'
  },
  // ── Dot at top of caret ─────────────────────────────────────────────────────
  '.cm-ySelectionCaretDot': {
    borderRadius: '50%',
    position: 'absolute',
    width: '6px',
    height: '6px',
    top: '-4px',
    left: '-4px',
    backgroundColor: 'inherit',
    boxShadow: '0 0 0 1.5px rgba(255,255,255,0.8)',
    transition: 'transform .15s ease',
    zIndex: '201'
  },
  '.cm-ySelectionCaret:hover > .cm-ySelectionCaretDot': {
    transform: 'scale(0)'
  },
  // ── Username label ──────────────────────────────────────────────────────────
  // Override the default hide-until-hover: always show the label
  '.cm-ySelectionInfo': {
    position: 'absolute',
    top: '-1.5em',
    left: '-2px',
    fontSize: '10px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontStyle: 'normal',
    fontWeight: '700',
    lineHeight: '1.4',
    userSelect: 'none',
    color: 'white',
    paddingLeft: '5px',
    paddingRight: '5px',
    paddingTop: '1px',
    paddingBottom: '2px',
    borderRadius: '3px 3px 3px 0',
    zIndex: '201',
    whiteSpace: 'nowrap',
    backgroundColor: 'inherit',
    boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
    pointerEvents: 'none',
    // Always visible (override opacity:0 default)
    opacity: '1',
    transition: 'none',
    transitionDelay: '0s'
  },
  '.cm-ySelectionCaret:hover > .cm-ySelectionInfo': {
    opacity: '1',
    transitionDelay: '0s'
  },
  // ── Selection range highlight ───────────────────────────────────────────────
  '.cm-ySelection': {
    borderRadius: '2px'
  }
});

/**
 * Returns the full collaboration extension bundle for Live Cursor.
 *
 * Uses the battle-tested y-codemirror.next library for cursor/selection sync.
 * Cursor positions are stored as Y.RelativePosition (CRDT-safe), which means
 * they automatically survive concurrent edits without any manual remapping.
 *
 * @param ytext   - The Y.Text instance shared across peers
 * @param awareness - The Yjs Awareness instance (must have user.name & user.color set)
 */
export function collaborationExtension(ytext: Y.Text, awareness: any): Extension[] {
  return [
    collabTheme,
    yCollab(ytext, awareness),
  ];
}

/**
 * Export yRemoteSelections as a named export so callers that only
 * need the rendering plugin can import it directly if needed.
 */
export { yRemoteSelections };
