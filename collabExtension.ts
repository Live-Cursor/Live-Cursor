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
const collabTheme = EditorView.theme({
  // ── Cursor caret ────────────────────────────────────────────────────────────
  '.cm-ySelectionCaret': {
    position: 'relative !important',
    borderLeft: '2px solid !important', // colour is set inline by the library
    borderRight: 'none !important',
    marginLeft: '-1px !important',
    marginRight: '-1px !important',
    boxSizing: 'border-box !important',
    display: 'inline !important',
    cursor: 'text !important',
    zIndex: '200 !important'
  },
  // ── Dot at top of caret ─────────────────────────────────────────────────────
  '.cm-ySelectionCaretDot': {
    borderRadius: '50% !important',
    position: 'absolute !important',
    width: '8px !important',
    height: '8px !important',
    top: '-4px !important',
    left: '-4px !important',
    backgroundColor: 'inherit !important',
    boxShadow: '0 0 0 1.5px rgba(255,255,255,0.8) !important',
    transition: 'transform .15s ease !important',
    zIndex: '201 !important'
  },
  '.cm-ySelectionCaret:hover > .cm-ySelectionCaretDot': {
    transform: 'scale(0) !important'
  },
  // ── Username label ──────────────────────────────────────────────────────────
  '.cm-ySelectionInfo': {
    position: 'absolute !important',
    top: '-1.8em !important',
    left: '-2px !important',
    fontSize: '11px !important',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important',
    fontStyle: 'normal !important',
    fontWeight: '700 !important',
    lineHeight: '1.4 !important',
    userSelect: 'none !important',
    color: 'white !important',
    padding: '2px 6px !important',
    borderRadius: '4px 4px 4px 0 !important',
    zIndex: '201 !important',
    whiteSpace: 'nowrap !important',
    backgroundColor: 'inherit !important',
    boxShadow: '0 1px 4px rgba(0,0,0,0.25) !important',
    pointerEvents: 'none !important',
    // Always visible (override opacity:0 default)
    opacity: '1 !important',
    transition: 'none !important',
    transitionDelay: '0s !important'
  },
  '.cm-ySelectionCaret:hover > .cm-ySelectionInfo': {
    opacity: '1 !important',
    transitionDelay: '0s !important'
  },
  // ── Selection range highlight ───────────────────────────────────────────────
  '.cm-ySelection': {
    borderRadius: '2px !important'
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
