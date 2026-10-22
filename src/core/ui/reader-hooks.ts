/**
 * Reader integration: AI action row inside the text-selection popup, and a
 * toolbar button that toggles the chat panel.
 */
import { getSettings, type QuickAction } from "../config";
import { waive } from "../reader-utils";
import type { Selection } from "../quick";

export interface ReaderHookHost {
  pluginID: string;
  runQuickAction(reader: any, action: QuickAction | "ask" | "quote", sel: Selection, anchor: DOMRect | null): void;
  togglePanel(): void;
  startRegionAsk(reader: any): void;
  askImageAnnotation(reader: any, key: string): void;
}

function anchorRect(reader: any, el: Element): DOMRect | null {
  try {
    const r = el.getBoundingClientRect();
    const iframe = reader._iframe as Element | undefined;
    if (!iframe) return null;
    const f = iframe.getBoundingClientRect();
    return new (Zotero.getMainWindow().DOMRect)(f.left + r.left, f.top + r.top, r.width, r.height);
  } catch {
    return null;
  }
}

export function registerReaderHooks(host: ReaderHookHost): void {
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    (event: any) => {
      const { reader, doc, params, append } = event;
      let sel: Selection;
      try {
        const a = waive(params.annotation);
        sel = JSON.parse(JSON.stringify({ text: a.text, position: a.position, sortIndex: a.sortIndex, pageLabel: a.pageLabel }));
      } catch {
        return;
      }
      if (!sel.text?.trim()) return;
      const row = doc.createElement("div");
      row.setAttribute(
        "style",
        "display:flex;flex-wrap:wrap;gap:4px;padding:4px 2px 2px;border-top:1px solid rgba(127,127,127,.25);margin-top:2px;max-width:280px;",
      );
      const label = doc.createElement("span");
      label.textContent = "π";
      label.setAttribute("style", "font-weight:700;color:#6d5bd0;align-self:center;padding:0 4px;");
      row.append(label);
      const add = (text: string, title: string, fn: () => void) => {
        const b = doc.createElement("button");
        b.className = "toolbar-button wide-button";
        b.textContent = text;
        b.title = title;
        b.setAttribute("style", "width:auto;padding:0 8px;min-width:0;");
        b.addEventListener("click", (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        });
        row.append(b);
      };
      for (const action of getSettings().quickActions) {
        add(action.label, action.mode === "translate" ? "翻译选中文本" : action.prompt.slice(0, 80), () =>
          host.runQuickAction(reader, action, sel, anchorRect(reader, row)),
        );
      }
      add("问 AI…", "针对选中文本提问", () => host.runQuickAction(reader, "ask", sel, anchorRect(reader, row)));
      add("引用到聊天", "把选中文本作为引用加入聊天面板", () => host.runQuickAction(reader, "quote", sel, null));
      append(row);
    },
    host.pluginID,
  );

  Zotero.Reader.registerEventListener(
    "renderToolbar",
    (event: any) => {
      event.append(buildToolbarButtons(event.doc, host, event.reader));
    },
    host.pluginID,
  );

  Zotero.Reader.registerEventListener(
    "createAnnotationContextMenu",
    (event: any) => {
      const { reader, params, append } = event;
      const libraryID = Zotero.Items.get(reader.itemID)?.libraryID;
      const keys: string[] = Array.from(params.ids || []);
      const imageKey = keys.find((k) => Zotero.Items.getByLibraryAndKey(libraryID, k)?.annotationType === "image");
      if (!imageKey) return;
      append({
        label: "π 问 AI（这张图）",
        onCommand: () => host.askImageAnnotation(reader, imageKey),
      });
    },
    host.pluginID,
  );
}

const TOOLBAR_CLASS = "zoteropi-toolbar";

function buildToolbarButtons(doc: any, host: ReaderHookHost, reader: any): any {
  const b = doc.createElement("button");
  b.className = "toolbar-button";
  b.title = "Pi Agent 聊天面板 (⌘/Ctrl+Shift+L)";
  b.textContent = "π";
  b.setAttribute("style", "font-weight:700;font-size:15px;color:#6d5bd0;width:auto;padding:0 6px;");
  b.addEventListener("click", () => host.togglePanel());
  const r = doc.createElement("button");
  r.className = "toolbar-button";
  r.title = "框图提问：框选图表 / 公式 / 表格向 AI 提问 (⌘/Ctrl+Shift+K)";
  r.textContent = "π⬚";
  r.setAttribute("style", "font-weight:700;font-size:13px;color:#6d5bd0;width:auto;padding:0 6px;");
  r.addEventListener("click", () => host.startRegionAsk(reader));
  const wrap = doc.createElement("div");
  wrap.className = TOOLBAR_CLASS;
  wrap.setAttribute("style", "display:flex;flex-direction:row;align-items:center;gap:2px;");
  wrap.append(b, r);
  return wrap;
}

function readerDocs(): { reader: any; doc: any }[] {
  const out: { reader: any; doc: any }[] = [];
  for (const reader of Zotero.Reader._readers || []) {
    try {
      const doc = reader._iframeWindow?.document;
      if (doc) out.push({ reader, doc });
    } catch {
      // reader not ready / closed
    }
  }
  return out;
}

/**
 * Reader toolbars only fire "renderToolbar" when a reader is created, so tabs
 * that were already open when the plugin started (install / update) get the
 * buttons injected directly.
 */
export function injectToolbarIntoOpenReaders(host: ReaderHookHost): void {
  for (const { reader, doc } of readerDocs()) {
    const sections = doc.querySelector(".toolbar .end .custom-sections");
    if (!sections || sections.querySelector(`.${TOOLBAR_CLASS}`)) continue;
    const section = doc.createElement("div");
    section.className = "section";
    section.append(buildToolbarButtons(doc, host, reader));
    sections.append(section);
  }
}

/** Remove our buttons from open readers (on shutdown, so no dead buttons remain). */
export function removeToolbarFromReaders(): void {
  for (const { doc } of readerDocs()) {
    for (const el of Array.from(doc.querySelectorAll(`.${TOOLBAR_CLASS}`)) as any[]) {
      const section = el.parentElement;
      el.remove();
      if (section?.classList?.contains("section") && !section.childElementCount) section.remove();
    }
  }
}
