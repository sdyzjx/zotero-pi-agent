/**
 * Create / update Zotero annotations from agent tool calls or the selection popup.
 */
import { getSettings } from "./config";
import { getMainAttachment } from "./paper";
import { ensureReader, getPageCount, getPageData, getPageLabel, getCurrentPageIndex } from "./reader-utils";
import { buildCharIndex, findQuote, getRangeRects, type PdfChar } from "./text";

const COLORS: Record<string, string> = {
  yellow: "#ffd400",
  red: "#ff6666",
  green: "#5fb236",
  blue: "#2ea8e5",
  purple: "#a28ae5",
  magenta: "#e56eee",
  orange: "#f19837",
  gray: "#aaaaaa",
};

export function resolveColor(color?: string): string {
  if (!color) return getSettings().annotationColor || "#a28ae5";
  const c = color.trim().toLowerCase();
  if (COLORS[c]) return COLORS[c];
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  return getSettings().annotationColor || "#a28ae5";
}

function sortIndex(pageIndex: number, charOffset: number, top: number): string {
  return [
    String(pageIndex).slice(0, 5).padStart(5, "0"),
    String(charOffset).slice(0, 6).padStart(6, "0"),
    String(Math.max(0, Math.floor(top))).slice(0, 5).padStart(5, "0"),
  ].join("|");
}

function aiTags(): { name: string }[] {
  const tag = getSettings().annotationTag.trim();
  return tag ? [{ name: tag }] : [];
}

async function pdfAttachmentOf(item: any): Promise<any> {
  const att = await getMainAttachment(item);
  if (!att || !att.isPDFAttachment?.()) throw new Error("该文献没有 PDF 附件，无法创建批注");
  return att;
}

function pageOrder(count: number, hint: number | null): number[] {
  const order: number[] = [];
  if (hint !== null && hint >= 0 && hint < count) {
    order.push(hint);
    for (let d = 1; d < count; d++) {
      if (hint - d >= 0) order.push(hint - d);
      if (hint + d < count) order.push(hint + d);
    }
  } else {
    for (let i = 0; i < count; i++) order.push(i);
  }
  return order;
}

interface Located {
  reader: any;
  attachment: any;
  pageIndex: number;
  start: number;
  end: number;
  chars: PdfChar[];
  rects: number[][];
  viewBox: number[];
}

async function locate(item: any, quote: string, page?: number): Promise<Located> {
  const attachment = await pdfAttachmentOf(item);
  const reader = await ensureReader(attachment.id);
  const count = await getPageCount(reader);
  const hint = typeof page === "number" ? page - 1 : getCurrentPageIndex(reader);
  for (const pageIndex of pageOrder(count, hint)) {
    const data = await getPageData(reader, pageIndex);
    if (!data.chars.length) continue;
    const m = findQuote(data.chars, quote, buildCharIndex(data.chars));
    if (m) {
      const rects = getRangeRects(data.chars, m[0], m[1]);
      return { reader, attachment, pageIndex, start: m[0], end: m[1], chars: data.chars, rects, viewBox: data.viewBox };
    }
  }
  throw new Error(
    "在 PDF 中没有找到这段原文。请使用 paper_read / paper_search 返回的原文逐字复制（单页内的一句或几句话），不要改写或翻译。",
  );
}

function charsText(chars: PdfChar[], start: number, end: number): string {
  let s = "";
  for (let i = start; i <= end; i++) {
    const ch = chars[i];
    if (ch.ignorable) continue;
    s += ch.u ?? ch.c ?? "";
    if (i < end && (ch.spaceAfter || ch.lineBreakAfter)) s += " ";
  }
  return s.replace(/-\s(?=\p{Ll})/gu, "").trim();
}

export interface CreatedAnnotation {
  key: string;
  pageLabel: string;
  pageIndex: number;
  text: string;
  attachmentID: number;
}

export async function createHighlight(
  item: any,
  opts: { quote: string; page?: number; comment?: string; color?: string; type?: "highlight" | "underline" },
): Promise<CreatedAnnotation> {
  const loc = await locate(item, opts.quote, opts.page);
  const top = loc.rects.reduce((m, r) => Math.max(m, r[3]), -Infinity);
  const pageHeight = loc.viewBox[3] - loc.viewBox[1];
  const text = charsText(loc.chars, loc.start, loc.end);
  const pageLabel = await getPageLabel(loc.reader, loc.pageIndex);
  const json = {
    key: Zotero.DataObjectUtilities.generateKey(),
    type: opts.type === "underline" ? "underline" : "highlight",
    text,
    comment: opts.comment || "",
    color: resolveColor(opts.color),
    pageLabel,
    sortIndex: sortIndex(loc.pageIndex, loc.start, pageHeight - top),
    position: { pageIndex: loc.pageIndex, rects: loc.rects },
    tags: aiTags(),
  };
  await Zotero.Annotations.saveFromJSON(loc.attachment, json);
  return { key: json.key, pageLabel, pageIndex: loc.pageIndex, text, attachmentID: loc.attachment.id };
}

export async function createNoteAnnotation(
  item: any,
  opts: { comment: string; page?: number; nearText?: string; color?: string },
): Promise<CreatedAnnotation> {
  const attachment = await pdfAttachmentOf(item);
  let pageIndex: number;
  let rect: number[];
  let offset = 0;
  let reader: any;
  let viewBox: number[];
  if (opts.nearText) {
    const loc = await locate(item, opts.nearText, opts.page);
    reader = loc.reader;
    pageIndex = loc.pageIndex;
    viewBox = loc.viewBox;
    offset = loc.start;
    // Put the note in the page margin next to the matched line (left column → left margin).
    const r = loc.rects[0];
    const size = 22;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const ch of loc.chars) {
      minX = Math.min(minX, ch.rect[0], ch.rect[2]);
      maxX = Math.max(maxX, ch.rect[0], ch.rect[2]);
    }
    const mid = (viewBox[0] + viewBox[2]) / 2;
    const x =
      r[0] < mid
        ? Math.max(viewBox[0] + 2, minX - size - 4)
        : Math.min(viewBox[2] - size - 2, maxX + 4);
    rect = [x, r[3] - size, x + size, r[3]];
  } else {
    reader = await ensureReader(attachment.id);
    const count = await getPageCount(reader);
    pageIndex = Math.min(Math.max((opts.page ?? 1) - 1, 0), count - 1);
    viewBox = (await getPageData(reader, pageIndex)).viewBox;
    rect = [viewBox[0] + 12, viewBox[3] - 34, viewBox[0] + 34, viewBox[3] - 12];
  }
  rect = rect.map((v) => Math.round(v * 1000) / 1000);
  const pageLabel = await getPageLabel(reader, pageIndex);
  const json = {
    key: Zotero.DataObjectUtilities.generateKey(),
    type: "note",
    comment: opts.comment,
    color: resolveColor(opts.color),
    pageLabel,
    sortIndex: sortIndex(pageIndex, offset, viewBox[3] - viewBox[1] - rect[3]),
    position: { pageIndex, rects: [rect] },
    tags: aiTags(),
  };
  await Zotero.Annotations.saveFromJSON(attachment, json);
  return { key: json.key, pageLabel, pageIndex, text: "", attachmentID: attachment.id };
}

/** Save the user's current text selection (from the reader popup) as a highlight. */
export async function saveSelectionAsHighlight(
  attachment: any,
  selection: { text: string; position: any; sortIndex?: string; pageLabel?: string },
  comment: string,
  color?: string,
): Promise<string> {
  const pageIndex = selection.position?.pageIndex ?? 0;
  const json = {
    key: Zotero.DataObjectUtilities.generateKey(),
    type: "highlight",
    text: selection.text,
    comment,
    color: resolveColor(color),
    pageLabel: selection.pageLabel || String(pageIndex + 1),
    sortIndex: selection.sortIndex || sortIndex(pageIndex, 0, 0),
    position: selection.position,
    tags: aiTags(),
  };
  await Zotero.Annotations.saveFromJSON(attachment, json);
  return json.key;
}

export async function updateAnnotationComment(libraryID: number, key: string, comment: string, mode: "replace" | "append"): Promise<void> {
  const ann = Zotero.Items.getByLibraryAndKey(libraryID, key);
  if (!ann || !ann.isAnnotation()) throw new Error(`找不到批注 ${key}`);
  ann.annotationComment = mode === "append" && ann.annotationComment ? `${ann.annotationComment}\n\n${comment}` : comment;
  await ann.saveTx();
}
