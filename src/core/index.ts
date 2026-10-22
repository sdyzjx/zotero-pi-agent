import "./polyfill-install";
import { getSettings, saveSettings, type QuickAction, type Settings } from "./config";
import { ContextTracker } from "./context";
import { globalEvents } from "./events";
import { listModels, testConnection } from "./llm";
import { getItem, getMainAttachment, type PaperRef } from "./paper";
import { IMAGE_ACTIONS, QuickService, type Selection } from "./quick";
import { ensureReader, navigateToPage, selectReaderTab } from "./reader-utils";
import { SessionManager } from "./sessions";
import { closeStore, openStore } from "./store";
import { ChatPanel } from "./ui/panel";
import { QuickCard } from "./ui/quickcard";
import { injectToolbarIntoOpenReaders, registerReaderHooks, removeToolbarFromReaders } from "./ui/reader-hooks";
import { registerDevEndpoint, unregisterDevEndpoint } from "./dev";
import { selectRegion } from "./ui/region-select";
import { renderRegion, type RenderedRegion } from "./vision";
import { findReader } from "./reader-utils";

class ZoteroPiAddon {
  readonly pluginID = __PLUGIN_ID__;
  readonly version = __PLUGIN_VERSION__;
  readonly events = globalEvents;
  readonly sessions = new SessionManager();
  readonly context = new ContextTracker();
  readonly quick = new QuickService(this.sessions);
  panel: ChatPanel | null = null;
  card: QuickCard | null = null;
  private win: any = null;
  private menuItems: Element[] = [];
  private injectTimer: any = null;
  private onKey = (e: KeyboardEvent) => {
    const accel = Zotero.isMac ? e.metaKey : e.ctrlKey;
    if (accel && e.shiftKey && (e.key === "k" || e.key === "K")) {
      const reader = this.currentReader();
      if (reader) {
        e.preventDefault();
        this.startRegionAsk(reader);
      }
    }
  };
  private unsubs: (() => void)[] = [];

  async startup(): Promise<void> {
    await openStore();
    if (__DEV__) registerDevEndpoint(this);
    registerReaderHooks(this);
    injectToolbarIntoOpenReaders(this);
    // Readers restored from the previous session may still be loading.
    this.injectTimer = setTimeout(() => injectToolbarIntoOpenReaders(this), 3000);
    try {
      await Zotero.PreferencePanes.register({
        pluginID: this.pluginID,
        src: rootURI + "content/prefs.xhtml",
        label: "Pi Agent",
        image: rootURI + "content/icons/icon.svg",
      });
    } catch (e) {
      Zotero.logError(e);
    }
    this.context.start();
    this.unsubs.push(
      this.context.changes.on((ctx) => this.panel?.setTitle(ctx ? ctx.title : "Pi Agent")),
      this.quick.changes.on((job) => {
        if (!job) this.card?.close();
      }),
    );
    const win = Zotero.getMainWindow();
    if (win?.document?.readyState === "complete") this.onMainWindowLoad(win);
  }

  onMainWindowLoad(win: any): void {
    if (this.win === win) return;
    if (this.win) this.onMainWindowUnload(this.win);
    this.win = win;
    this.panel = new ChatPanel(win);
    this.panel.setTitle(this.context.get()?.title || "Pi Agent");
    this.card = new QuickCard(
      win,
      () => this.quick.cancel(),
      () => {
        const job = this.quick.job;
        this.panel?.show();
        if (job?.sessionId) this.panel?.postToFrame({ type: "zoteropi-open-session", sessionId: job.sessionId });
        this.card?.close();
      },
    );
    this.addMenu(win);
    win.addEventListener("keydown", this.onKey, true);
  }

  onMainWindowUnload(win: any): void {
    if (this.win !== win) return;
    win.removeEventListener("keydown", this.onKey, true);
    this.panel?.destroy();
    this.card?.destroy();
    for (const m of this.menuItems) m.remove();
    this.menuItems = [];
    this.panel = null;
    this.card = null;
    this.win = null;
  }

  private addMenu(win: any): void {
    const popup = win.document.getElementById("menu_ToolsPopup");
    if (!popup) return;
    const sep = win.document.createXULElement("menuseparator");
    const toggle = win.document.createXULElement("menuitem");
    toggle.setAttribute("label", "Pi Agent 聊天面板");
    toggle.addEventListener("command", () => this.togglePanel());
    const settings = win.document.createXULElement("menuitem");
    settings.setAttribute("label", "Pi Agent 设置…");
    settings.addEventListener("command", () => this.openSettings());
    popup.append(sep, toggle, settings);
    this.menuItems = [sep, toggle, settings];
  }

  async shutdown(): Promise<void> {
    for (const u of this.unsubs) u();
    clearTimeout(this.injectTimer);
    try {
      removeToolbarFromReaders();
    } catch (e) {
      Zotero.logError(e);
    }
    this.quick.cancel();
    this.context.stop();
    if (this.win) this.onMainWindowUnload(this.win);
    this.sessions.dispose();
    globalEvents.clear();
    for (const w of Services.wm.getEnumerator("zoteropi:settings")) w.close();
    if (__DEV__) unregisterDevEndpoint();
    await closeStore();
  }

  // ------------------------------------------------------------------ API used by the web UI

  getSettings(): Settings {
    return getSettings();
  }

  saveSettings(patch: Partial<Settings>): void {
    saveSettings(JSON.parse(JSON.stringify(patch)));
    this.sessions.refreshAll();
    globalEvents.emit({ type: "settings-changed" });
  }

  listModels() {
    return listModels();
  }

  testConnection() {
    return testConnection();
  }

  imageActions() {
    return IMAGE_ACTIONS;
  }

  togglePanel(): void {
    this.panel?.toggle();
  }

  openSettings(): void {
    const existing = Services.wm.getMostRecentWindow("zoteropi:settings");
    if (existing) {
      existing.focus();
      return;
    }
    Zotero.getMainWindow()?.openDialog(
      "chrome://zoteropi/content/settings.html",
      "zoteropi-settings",
      "chrome,centerscreen,resizable,dialog=no,width=780,height=860",
    );
  }

  launchURL(url: string): void {
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) Zotero.launchURL(url);
  }

  async openPage(ref: PaperRef, pageNumber: number): Promise<void> {
    const att = await getMainAttachment(getItem(ref));
    if (!att) return;
    const reader = await ensureReader(att.id);
    selectReaderTab(reader);
    await navigateToPage(reader, Math.max(0, pageNumber - 1));
  }

  async openAnnotation(libraryID: number, key: string): Promise<void> {
    const ann = Zotero.Items.getByLibraryAndKey(libraryID, key);
    if (!ann?.isAnnotation?.()) return;
    await Zotero.Reader.open(ann.parentItemID, { annotationID: key });
  }

  private currentReader(): any {
    const ctx = this.context.get();
    return ctx?.attachmentID ? findReader(ctx.attachmentID) : null;
  }

  /** 框图提问: drag a box on the PDF, then choose what to ask in the quick card. */
  async startRegionAsk(reader?: any): Promise<void> {
    reader = reader || this.currentReader();
    if (!reader || !this.win) return;
    this.card?.close();
    try {
      const sel = await selectRegion(this.win, reader);
      if (!sel) return;
      const img = await renderRegion(reader, sel.pageIndex, sel.rect);
      this.card?.open("框图提问 · π", { left: sel.screen.left, top: sel.screen.top, bottom: sel.screen.bottom });
      this.quick.startImage(reader.itemID, img);
    } catch (e) {
      Zotero.logError(e);
    }
  }

  /** Context menu on an existing image annotation. */
  async askImageAnnotation(reader: any, key: string): Promise<void> {
    const ann = Zotero.Items.getByLibraryAndKey(Zotero.Items.get(reader.itemID).libraryID, key);
    if (!ann) return;
    try {
      const pos = JSON.parse(ann.annotationPosition);
      const img = await renderRegion(reader, pos.pageIndex, pos.rects?.[0]);
      this.card?.open("图片批注 · π", null);
      this.quick.startImage(reader.itemID, img, key);
    } catch (e) {
      Zotero.logError(e);
    }
  }

  /** For the chat panel's 📷 button: capture a region of the open PDF. */
  async captureRegion(): Promise<RenderedRegion | null> {
    const reader = this.currentReader();
    if (!reader || !this.win) return null;
    const sel = await selectRegion(this.win, reader);
    if (!sel) return null;
    return renderRegion(reader, sel.pageIndex, sel.rect);
  }

  /** Called from the reader selection popup. */
  runQuickAction(reader: any, action: QuickAction | "ask" | "quote", sel: Selection, anchor: DOMRect | null): void {
    if (action === "quote") {
      this.panel?.show();
      this.panel?.postToFrame({ type: "zoteropi-insert-quote", text: sel.text, pageLabel: sel.pageLabel || "" });
      return;
    }
    const a = action === "ask" ? ({ id: "ask", label: "问 AI", mode: "ask", prompt: "" } as const) : action;
    this.card?.open(`${a.label} · π`, anchor ? { left: anchor.left, top: anchor.top, bottom: anchor.bottom } : null);
    void this.quick.start(a as any, reader.itemID, sel).catch((e) => Zotero.logError(e));
  }
}

// Expose for chat.html / settings.html (chrome pages) and bootstrap.js
const addon = new ZoteroPiAddon();
Zotero.ZoteroPi = addon;
export type { ZoteroPiAddon };
