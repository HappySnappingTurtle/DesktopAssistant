export interface MenuItem {
  label: string;
  checked?: boolean;
  onClick: () => void;
}

let menuEl: HTMLElement | null = null;
let onCloseCallback: (() => void) | null = null;

export function hideContextMenu() {
  menuEl?.remove();
  menuEl = null;
  onCloseCallback?.();
  onCloseCallback = null;
}

export function showContextMenu(
  x: number,
  y: number,
  items: MenuItem[],
  onClose?: () => void,
) {
  hideContextMenu();
  onCloseCallback = onClose ?? null;
  menuEl = document.createElement("div");
  menuEl.id = "ctx-menu";
  menuEl.style.cssText =
    "position:fixed;z-index:10000;min-width:150px;padding:6px;border-radius:12px;" +
    "background:rgba(28,28,34,.95);box-shadow:0 8px 28px rgba(0,0,0,.35);" +
    "font:13px -apple-system,sans-serif;color:#eee;backdrop-filter:blur(8px);";
  for (const item of items) {
    const row = document.createElement("div");
    row.textContent = (item.checked ? "✓ " : "") + item.label;
    row.style.cssText =
      "padding:7px 12px;border-radius:8px;cursor:pointer;user-select:none;";
    row.addEventListener("mouseenter", () => (row.style.background = "rgba(255,255,255,.12)"));
    row.addEventListener("mouseleave", () => (row.style.background = "transparent"));
    row.addEventListener("click", () => {
      hideContextMenu();
      item.onClick();
    });
    menuEl.appendChild(row);
  }
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  menuEl.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  setTimeout(() => {
    window.addEventListener("pointerdown", onAway, { once: true, capture: true });
  }, 0);
}

function onAway(e: Event) {
  if (menuEl && !menuEl.contains(e.target as Node)) hideContextMenu();
}
