/**
 * Article-level chat panel host in the main window: floating window that can be
 * dragged, snapped/docked to the left or right edge, collapsed to a bubble or an
 * edge tab, expanded again and resized. Content is chrome://zoteropi/content/chat.html.
 */
import { getPref, setPref } from "../config";
import { clamp, ensureStylesheet, h } from "./dom";

type Mode = "floating" | "left" | "right";

interface PanelState {
  visible: boolean;
  collapsed: boolean;
  mode: Mode;
  x: number;
  y: number;
  w: number;
  hgt: number;
  dockWidth: number;
  bubbleX: number;
  bubbleY: number;
}

const DEFAULT_STATE: PanelState = {
  visible: true,
  collapsed: false,
  mode: "right",
  x: -1,
  y: -1,
  w: 420,
  hgt: 600,
  dockWidth: 420,
  bubbleX: -1,
  bubbleY: -1,
};

const SNAP_DIST = 28;
const MIN_W = 320;
const MIN_H = 280;

export class ChatPanel {
  private win: any;
  private doc: Document;
  private root!: HTMLElement;
  private panel!: HTMLElement;
  private frame!: HTMLIFrameElement;
  private titleEl!: HTMLElement;
  private bubble!: HTMLElement;
  private tab!: HTMLElement;
  private snap!: HTMLElement;
  private state: PanelState;
  private onResize = () => this.layout();
  private onKey = (e: KeyboardEvent) => {
    const accel = Zotero.isMac ? e.metaKey : e.ctrlKey;
    if (accel && e.shiftKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      this.toggle();
    }
  };

  constructor(win: any) {
    this.win = win;
    this.doc = win.document;
    this.state = this.loadState();
    this.build();
    this.layout();
    win.addEventListener("resize", this.onResize);
    win.addEventListener("keydown", this.onKey, true);
  }

  private loadState(): PanelState {
    try {
      const raw = getPref<string>("panelState");
      if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
    return { ...DEFAULT_STATE };
  }

  private saveState(): void {
    setPref("panelState", JSON.stringify(this.state));
  }

  private build(): void {
    const doc = this.doc;
    ensureStylesheet(doc);
    this.root = h(doc, "div", { id: "zoteropi-root", class: "zp-root" });

    this.titleEl = h(doc, "span", { class: "zp-title", text: "Pi Agent" });
    const btn = (label: string, title: string, fn: () => void, extra: Record<string, string> = {}) => {
      const b = h(doc, "button", { class: "zp-btn", title, text: label, ...extra });
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      return b;
    };
    const header = h(doc, "div", { class: "zp-header" }, [
      h(doc, "span", { class: "zp-logo", text: "π" }),
      this.titleEl,
      btn("⇤", "停靠到左侧", () => this.dock("left"), { "data-act": "left" }),
      btn("❐", "浮动窗口", () => this.dock("floating"), { "data-act": "floating" }),
      btn("⇥", "停靠到右侧", () => this.dock("right"), { "data-act": "right" }),
      btn("–", "收起", () => this.setCollapsed(true)),
      btn("✕", "关闭 (⌘/Ctrl+Shift+L 重新打开)", () => this.hide()),
    ]);
    header.addEventListener("pointerdown", (e) => this.startDrag(e as PointerEvent));
    header.addEventListener("dblclick", () => this.dock(this.state.mode === "floating" ? "right" : "floating"));

    this.frame = h(doc, "iframe", { class: "zp-frame", src: "chrome://zoteropi/content/chat.html?mode=panel" }) as HTMLIFrameElement;
    const shield = h(doc, "div", { class: "zp-shield" });
    this.panel = h(doc, "div", { class: "zp-panel" }, [header, this.frame, shield]);
    for (const dir of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
      const rh = h(doc, "div", { class: "zp-rh", "data-dir": dir });
      rh.addEventListener("pointerdown", (e) => this.startResize(e as PointerEvent, dir));
      this.panel.append(rh);
    }

    this.bubble = h(doc, "div", { class: "zp-bubble", title: "展开 Pi Agent（可拖动）", text: "π" });
    this.bubble.addEventListener("pointerdown", (e) => this.startBubbleDrag(e as PointerEvent));

    this.tab = h(doc, "div", { class: "zp-tab", title: "展开 Pi Agent", text: "π Agent" });
    this.tab.addEventListener("click", () => this.setCollapsed(false));

    this.snap = h(doc, "div", { class: "zp-snap", hidden: "true" });
    this.root.append(this.panel, this.bubble, this.tab, this.snap);
    doc.documentElement.appendChild(this.root);
  }

  // ---------------------------------------------------------------- layout

  private contentRect(): { top: number; bottom: number; left: number; right: number } {
    const browser = this.doc.getElementById("browser");
    const W = this.win.innerWidth;
    const H = this.win.innerHeight;
    if (!browser) return { top: 0, bottom: H, left: 0, right: W };
    const r = browser.getBoundingClientRect();
    return { top: Math.max(0, r.top), bottom: Math.min(H, r.bottom || H), left: 0, right: W };
  }

  private setBrowserMargin(side: "left" | "right" | null, px: number): void {
    const browser = this.doc.getElementById("browser") as HTMLElement | null;
    if (!browser) return;
    browser.style.marginLeft = side === "left" ? `${px}px` : "";
    browser.style.marginRight = side === "right" ? `${px}px` : "";
  }

  layout(): void {
    const s = this.state;
    const W = this.win.innerWidth;
    const H = this.win.innerHeight;
    const docked = s.mode !== "floating";
    const showPanel = s.visible && !s.collapsed;
    this.panel.hidden = !showPanel;
    this.bubble.hidden = !(s.visible && s.collapsed && !docked);
    this.tab.hidden = !(s.visible && s.collapsed && docked);
    this.panel.setAttribute("data-mode", s.mode);
    for (const b of Array.from(this.panel.querySelectorAll("[data-act]"))) {
      b.setAttribute("data-active", String(b.getAttribute("data-act") === s.mode));
    }

    if (docked) {
      const c = this.contentRect();
      s.dockWidth = clamp(s.dockWidth, MIN_W, Math.max(MIN_W, W - 200));
      Object.assign(this.panel.style, {
        top: `${c.top}px`,
        height: `${c.bottom - c.top}px`,
        width: `${s.dockWidth}px`,
        left: s.mode === "left" ? "0px" : "",
        right: s.mode === "right" ? "0px" : "",
      });
      this.setBrowserMargin(showPanel ? (s.mode as "left" | "right") : null, s.dockWidth);
      this.tab.setAttribute("data-side", s.mode);
      this.tab.style.top = `${c.top + (c.bottom - c.top) / 2 - 42}px`;
    } else {
      this.setBrowserMargin(null, 0);
      s.w = clamp(s.w, MIN_W, Math.max(MIN_W, W - 20));
      s.hgt = clamp(s.hgt, MIN_H, Math.max(MIN_H, H - 20));
      if (s.x < 0 || s.y < 0) {
        s.x = W - s.w - 40;
        s.y = 90;
      }
      s.x = clamp(s.x, 0, Math.max(0, W - 120));
      s.y = clamp(s.y, 0, Math.max(0, H - 40));
      Object.assign(this.panel.style, {
        top: `${s.y}px`,
        left: `${s.x}px`,
        right: "",
        width: `${s.w}px`,
        height: `${s.hgt}px`,
      });
      if (s.bubbleX < 0) {
        s.bubbleX = W - 70;
        s.bubbleY = H - 90;
      }
      s.bubbleX = clamp(s.bubbleX, 0, W - 44);
      s.bubbleY = clamp(s.bubbleY, 0, H - 44);
      this.bubble.style.left = `${s.bubbleX}px`;
      this.bubble.style.top = `${s.bubbleY}px`;
    }
  }

  // ---------------------------------------------------------------- public

  setTitle(title: string): void {
    this.titleEl.textContent = title || "Pi Agent";
    this.titleEl.setAttribute("title", title || "");
  }

  get isOpen(): boolean {
    return this.state.visible && !this.state.collapsed;
  }

  show(): void {
    this.state.visible = true;
    this.state.collapsed = false;
    this.layout();
    this.saveState();
  }

  hide(): void {
    this.state.visible = false;
    this.layout();
    this.saveState();
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  setCollapsed(collapsed: boolean): void {
    this.state.visible = true;
    this.state.collapsed = collapsed;
    this.layout();
    this.saveState();
  }

  dock(mode: Mode): void {
    this.state.mode = mode;
    this.state.collapsed = false;
    this.state.visible = true;
    this.layout();
    this.saveState();
  }

  /** Post a message to the chat iframe (e.g. insert quote). */
  postToFrame(msg: any): void {
    try {
      this.frame.contentWindow?.postMessage(msg, "*");
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------- drag

  private startDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    const s = this.state;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = this.panel.getBoundingClientRect();
    let offX = startX - rect.left;
    let offY = startY - rect.top;
    let moved = false;
    target.setPointerCapture(e.pointerId);
    this.root.classList.add("zp-dragging");

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved && s.mode !== "floating") {
        // undock: keep floating size, center under pointer
        s.mode = "floating";
        offX = Math.min(offX, s.w / 2);
        offY = 14;
      }
      moved = true;
      s.x = ev.clientX - offX;
      s.y = ev.clientY - offY;
      this.layout();
      this.showSnapPreview(this.snapSide(ev.clientX));
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      this.root.classList.remove("zp-dragging");
      this.showSnapPreview(null);
      if (moved) {
        const side = this.snapSide(ev.clientX);
        if (side) s.mode = side;
        this.layout();
        this.saveState();
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  private snapSide(x: number): "left" | "right" | null {
    if (x <= SNAP_DIST) return "left";
    if (x >= this.win.innerWidth - SNAP_DIST) return "right";
    return null;
  }

  private showSnapPreview(side: "left" | "right" | null): void {
    if (!side) {
      this.snap.hidden = true;
      return;
    }
    const c = this.contentRect();
    Object.assign(this.snap.style, {
      top: `${c.top}px`,
      height: `${c.bottom - c.top}px`,
      width: `${this.state.dockWidth}px`,
      left: side === "left" ? "0px" : "",
      right: side === "right" ? "0px" : "",
    });
    this.snap.hidden = false;
  }

  private startResize(e: PointerEvent, dir: string): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const s = this.state;
    const start = { x: e.clientX, y: e.clientY, sx: s.x, sy: s.y, w: s.w, h: s.hgt, dw: s.dockWidth };
    target.setPointerCapture(e.pointerId);
    this.root.classList.add("zp-dragging");
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (s.mode === "right") s.dockWidth = start.dw - dx;
      else if (s.mode === "left") s.dockWidth = start.dw + dx;
      else {
        if (dir.includes("e")) s.w = Math.max(MIN_W, start.w + dx);
        if (dir.includes("s")) s.hgt = Math.max(MIN_H, start.h + dy);
        if (dir.includes("w")) {
          s.w = Math.max(MIN_W, start.w - dx);
          s.x = start.sx + (start.w - s.w);
        }
        if (dir.includes("n")) {
          s.hgt = Math.max(MIN_H, start.h - dy);
          s.y = start.sy + (start.h - s.hgt);
        }
      }
      this.layout();
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      this.root.classList.remove("zp-dragging");
      this.saveState();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  private startBubbleDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    const s = this.state;
    const start = { x: e.clientX, y: e.clientY, bx: s.bubbleX, by: s.bubbleY };
    let moved = false;
    this.bubble.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      s.bubbleX = start.bx + dx;
      s.bubbleY = start.by + dy;
      this.layout();
    };
    const up = () => {
      this.bubble.removeEventListener("pointermove", move);
      this.bubble.removeEventListener("pointerup", up);
      if (moved) this.saveState();
      else this.setCollapsed(false);
    };
    this.bubble.addEventListener("pointermove", move);
    this.bubble.addEventListener("pointerup", up);
  }

  destroy(): void {
    this.win.removeEventListener("resize", this.onResize);
    this.win.removeEventListener("keydown", this.onKey, true);
    this.setBrowserMargin(null, 0);
    this.root.remove();
    this.doc.getElementById("zoteropi-css")?.remove();
  }
}
