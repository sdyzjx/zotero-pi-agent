/**
 * Helpers around Zotero's reader internals (pdf.js document access, navigation).
 */
import type { PdfChar } from "./text";

export function waive<T = any>(x: any): T {
  return x && x.wrappedJSObject ? x.wrappedJSObject : x;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function findReader(attachmentID: number): any {
  return Zotero.Reader._readers.find((r: any) => r.itemID === attachmentID) || null;
}

/** Find or open (in background) a reader for the attachment. */
export async function ensureReader(attachmentID: number): Promise<any> {
  let reader = findReader(attachmentID);
  if (!reader) {
    await Zotero.Reader.open(attachmentID, null, { openInBackground: true });
    for (let i = 0; i < 100 && !reader; i++) {
      reader = findReader(attachmentID);
      if (!reader) await sleep(100);
    }
  }
  if (!reader) throw new Error("无法打开 PDF 阅读器");
  await reader._initPromise;
  return reader;
}

export async function getPdfApp(reader: any): Promise<any> {
  for (let i = 0; i < 150; i++) {
    try {
      const ir = waive(reader._internalReader);
      const view = waive(ir?._primaryView);
      const win = waive(view?._iframeWindow);
      const app = waive(win?.PDFViewerApplication);
      if (app?.pdfDocument) return app;
    } catch {
      // not ready yet
    }
    await sleep(100);
  }
  throw new Error("PDF 文档尚未加载完成（只支持 PDF 附件）");
}

export interface PageData {
  chars: PdfChar[];
  viewBox: number[];
}

const pageDataCache = new WeakMap<any, Map<number, PageData>>();

export async function getPageData(reader: any, pageIndex: number): Promise<PageData> {
  let cache = pageDataCache.get(reader);
  if (!cache) {
    cache = new Map();
    pageDataCache.set(reader, cache);
  }
  const hit = cache.get(pageIndex);
  if (hit) return hit;
  const app = await getPdfApp(reader);
  const doc = waive(app.pdfDocument);
  // pdf.js forwards the argument to its worker (structured clone), so it must
  // live in the viewer's compartment rather than ours.
  const viewerWin = waive(waive(waive(reader._internalReader)._primaryView)._iframeWindow);
  const arg = Components.utils.cloneInto({ pageIndex }, viewerWin);
  const raw = waive(await doc.getPageData(arg));
  const data = JSON.parse(JSON.stringify({ chars: raw.chars || [], viewBox: raw.viewBox || null }));
  if (!data.viewBox) {
    const page = waive(await doc.getPage(pageIndex + 1));
    data.viewBox = Array.from(page.view as number[]);
  }
  cache.set(pageIndex, data);
  return data;
}

export async function getPageCount(reader: any): Promise<number> {
  const app = await getPdfApp(reader);
  return waive(app.pdfDocument).numPages;
}

export async function getPageLabel(reader: any, pageIndex: number): Promise<string> {
  try {
    const app = await getPdfApp(reader);
    const labels = await waive(app.pdfDocument).getPageLabels();
    if (labels && labels[pageIndex]) return String(labels[pageIndex]);
  } catch {
    // ignore
  }
  return String(pageIndex + 1);
}

export function getCurrentPageIndex(reader: any): number | null {
  try {
    const app = waive(waive(waive(waive(reader._internalReader)._primaryView)._iframeWindow).PDFViewerApplication);
    return app.pdfViewer.currentPageNumber - 1;
  } catch {
    return null;
  }
}

export async function navigateToPage(reader: any, pageIndex: number): Promise<void> {
  const app = await getPdfApp(reader);
  app.pdfViewer.currentPageNumber = pageIndex + 1;
}

export function selectReaderTab(reader: any): void {
  try {
    if (reader.tabID) Zotero.getMainWindow()?.Zotero_Tabs.select(reader.tabID);
  } catch {
    // ignore
  }
}
