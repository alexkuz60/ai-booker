/**
 * Creates a styled drag ghost element for audio drag-and-drop.
 * Attach via e.dataTransfer.setDragImage(el, offsetX, offsetY).
 * The element auto-removes after the drag ends.
 */
export function createDragGhost(label: string, category: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "position: fixed",
    "top: -1000px",
    "left: -1000px",
    "display: flex",
    "align-items: center",
    "gap: 6px",
    "padding: 6px 12px",
    "border-radius: 8px",
    "font-size: 11px",
    "font-family: system-ui, sans-serif",
    "white-space: nowrap",
    "max-width: 260px",
    "overflow: hidden",
    "pointer-events: none",
    "z-index: 99999",
    "background: hsl(var(--primary) / 0.9)",
    "color: hsl(var(--primary-foreground))",
    "box-shadow: 0 4px 12px hsl(var(--primary) / 0.3)",
    "backdrop-filter: blur(8px)",
  ].join(";");

  const icon = category === "music" ? "🎵" : category === "atmosphere" ? "🌊" : "🔊";
  el.textContent = `${icon} ${label.length > 30 ? label.slice(0, 30) + "…" : label}`;

  document.body.appendChild(el);

  // Auto-cleanup after drag
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 5000);
  });

  return el;
}
