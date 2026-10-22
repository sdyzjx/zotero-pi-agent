/**
 * Tracks which paper the main window is currently showing: the paper open in
 * the selected reader tab, or the single selected item in the library view.
 */
import { Emitter } from "./events";
import { paperTitle, refFromItem, getItem, type PaperRef } from "./paper";

export interface PaperContext {
  ref: PaperRef;
  title: string;
  /** Reader attachment item ID if the paper is open in the selected tab. */
  attachmentID: number | null;
  source: "reader" | "library";
}

function sameCtx(a: PaperContext | null, b: PaperContext | null): boolean {
  if (!a || !b) return a === b;
  return a.ref.libraryID === b.ref.libraryID && a.ref.itemKey === b.ref.itemKey && a.attachmentID === b.attachmentID;
}

export class ContextTracker {
  readonly changes = new Emitter<PaperContext | null>();
  private current: PaperContext | null = null;
  private timer: any = null;
  private notifierID: string | null = null;

  start(): void {
    this.notifierID = Zotero.Notifier.registerObserver(
      { notify: () => setTimeout(() => this.refresh(), 50) },
      ["tab", "item"],
      "zoteropi-context",
    );
    // Library selection has no cheap global event; poll lightly.
    this.timer = setInterval(() => this.refresh(), 800);
    this.refresh();
  }

  stop(): void {
    if (this.notifierID) Zotero.Notifier.unregisterObserver(this.notifierID);
    clearInterval(this.timer);
    this.changes.clear();
  }

  get(): PaperContext | null {
    return this.current;
  }

  refresh(): void {
    const next = this.compute();
    if (!sameCtx(next, this.current)) {
      this.current = next;
      this.changes.emit(next);
    }
  }

  private compute(): PaperContext | null {
    const win = Zotero.getMainWindow();
    if (!win || !win.Zotero_Tabs) return null;
    try {
      const tabs = win.Zotero_Tabs;
      if (tabs.selectedType === "reader" || tabs.selectedType === "reader-unloaded") {
        const reader = Zotero.Reader.getByTabID(tabs.selectedID);
        const itemID = reader?.itemID ?? tabs._getTab?.(tabs.selectedID)?.tab?.data?.itemID;
        if (!itemID) return null;
        const att = Zotero.Items.get(itemID);
        const ref = att && refFromItem(att);
        if (!ref) return null;
        return { ref, title: paperTitle(getItem(ref)), attachmentID: itemID, source: "reader" };
      }
      if (tabs.selectedType === "library") {
        const items = win.ZoteroPane?.getSelectedItems?.() || [];
        if (items.length !== 1) return null;
        const ref = refFromItem(items[0]);
        if (!ref) return null;
        return { ref, title: paperTitle(getItem(ref)), attachmentID: null, source: "library" };
      }
    } catch (e) {
      Zotero.debug(`[ZoteroPi] context error: ${e}`);
    }
    return null;
  }
}
