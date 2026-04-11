import { useRef, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────

export interface SelectionOffsets {
  start: number;
  end: number;
  text: string;
}

// ─── Hook ────────────────────────────────────────────────────
/**
 * Captures text selection before context-menu steals browser focus.
 *
 * Usage:
 *   const { capture, consume, peek } = useSelectionCapture(containerRef?);
 *   <div onContextMenu={capture}> ...
 *   // Inside menu handler:
 *   const sel = consume();  // returns & clears
 *
 * If `containerRef` is provided, computes start/end offsets relative
 * to that element's text content (for annotation-style use).
 * If omitted, captures plain selected text only.
 */
export function useSelectionCapture(containerRef?: React.RefObject<HTMLElement | null>) {
  const saved = useRef<SelectionOffsets | null>(null);

  const capture = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const selText = sel.toString().trim();
    if (!selText) return;

    // If container ref provided, compute offsets relative to it
    if (containerRef?.current) {
      const range = sel.getRangeAt(0);
      const container = containerRef.current;
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
        saved.current = { start: 0, end: selText.length, text: selText };
        return;
      }

      const fullText = container.textContent || "";

      // Fast path: indexOf
      const idx = fullText.indexOf(selText);
      if (idx >= 0) {
        saved.current = { start: idx, end: idx + selText.length, text: selText };
        return;
      }

      // Slow path: TreeWalker for annotated/styled text
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let start = -1;
      let end = -1;
      let node: Node | null;

      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (parent?.classList.contains("select-none")) continue;
        const len = (node.textContent || "").length;
        if (node === range.startContainer) start = offset + range.startOffset;
        if (node === range.endContainer) end = offset + range.endOffset;
        offset += len;
      }

      if (start >= 0 && end > start) {
        saved.current = { start, end, text: selText };
        return;
      }
    }

    // Fallback: just save the text
    saved.current = { start: 0, end: selText.length, text: selText };
  }, [containerRef]);

  /** Capture current live selection into saved ref (called internally) */
  const captureFromLive = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const selText = sel.toString().trim();
    if (!selText) return;

    if (containerRef?.current) {
      const range = sel.getRangeAt(0);
      const container = containerRef.current;
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
        saved.current = { start: 0, end: selText.length, text: selText };
        return;
      }
      const fullText = container.textContent || "";
      const idx = fullText.indexOf(selText);
      if (idx >= 0) {
        saved.current = { start: idx, end: idx + selText.length, text: selText };
        return;
      }
    }
    saved.current = { start: 0, end: selText.length, text: selText };
  }, [containerRef]);

  /** Get saved selection without clearing it; re-captures live selection if stale */
  const peek = useCallback((): SelectionOffsets | null => {
    if (!saved.current) captureFromLive();
    return saved.current;
  }, [captureFromLive]);

  /** Get saved selection and clear it */
  const consume = useCallback((): SelectionOffsets | null => {
    const val = saved.current;
    saved.current = null;
    return val;
  }, []);

  /** Get selected text (from saved or live selection) */
  const getSelectedText = useCallback((): string => {
    if (saved.current) return saved.current.text;
    const sel = window.getSelection();
    return sel?.toString().trim() || "";
  }, []);

  return { capture, peek, consume, getSelectedText };
}
