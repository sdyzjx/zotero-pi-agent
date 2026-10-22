/**
 * Access to papers in the Zotero library: identity, metadata, page-aware full
 * text (cached), and annotations.
 */
import { detectHeadings, type Heading } from "./text";

export interface PaperRef {
  libraryID: number;
  /** Key of the top-level item (regular item, or standalone attachment). */
  itemKey: string;
}

export interface PaperText {
  pages: string[];
  headings: Heading[];
  totalPages: number;
  source: "pdf" | "fulltext" | "none";
}

export function paperKey(ref: PaperRef): string {
  return `${ref.libraryID}/${ref.itemKey}`;
}

/** Top-level item for any item (attachment → parent, annotation → paper). */
export function topLevelItem(item: any): any {
  let it = item;
  if (it?.isAnnotation?.()) it = it.parentItem;
  if (it && (it.isAttachment?.() || it.isNote?.()) && it.parentItem) it = it.parentItem;
  return it;
}

export function refFromItem(item: any): PaperRef | null {
  const top = topLevelItem(item);
  if (!top || top.isNote?.()) return null;
  return { libraryID: top.libraryID, itemKey: top.key };
}

export function getItem(ref: PaperRef): any {
  return Zotero.Items.getByLibraryAndKey(ref.libraryID, ref.itemKey) || null;
}

export function resolveItemKey(itemKey: string, defaultLibraryID: number): any {
  const key = itemKey.trim().replace(/^.*\//, "");
  let item = Zotero.Items.getByLibraryAndKey(defaultLibraryID, key);
  if (!item) {
    for (const lib of Zotero.Libraries.getAll()) {
      item = Zotero.Items.getByLibraryAndKey(lib.libraryID, key);
      if (item) break;
    }
  }
  return item ? topLevelItem(item) : null;
}

/** Best readable attachment of a paper (PDF preferred). */
export async function getMainAttachment(item: any): Promise<any> {
  if (!item) return null;
  if (item.isAttachment()) return item;
  const ids: number[] = item.getAttachments();
  const atts = Zotero.Items.get(ids).filter((a: any) => !a.deleted);
  const pdf = atts.find((a: any) => a.isPDFAttachment?.() && a.isFileAttachment());
  if (pdf) return pdf;
  try {
    const best = await item.getBestAttachment();
    if (best) return best;
  } catch {
    // ignore
  }
  return atts.find((a: any) => a.isFileAttachment()) || null;
}

export function creatorsString(item: any, max = 6): string {
  const creators = item.getCreators?.() || [];
  const names = creators.slice(0, max).map((c: any) => (c.firstName ? `${c.firstName} ${c.lastName}` : c.lastName));
  if (creators.length > max) names.push("et al.");
  return names.join(", ");
}

export function paperTitle(item: any): string {
  return item?.getDisplayTitle?.() || item?.getField?.("title") || "(untitled)";
}

export function paperMetadata(item: any): Record<string, string> {
  const get = (f: string) => {
    try {
      return item.getField(f) || "";
    } catch {
      return "";
    }
  };
  const meta: Record<string, string> = {
    itemKey: item.key,
    libraryID: String(item.libraryID),
    title: paperTitle(item),
    itemType: Zotero.ItemTypes.getName(item.itemTypeID),
    authors: creatorsString(item),
    year: get("year") || (get("date") || "").slice(0, 4),
    venue: get("publicationTitle") || get("proceedingsTitle") || get("conferenceName") || get("publisher") || get("repository"),
    DOI: get("DOI"),
    url: get("url"),
    abstract: get("abstractNote"),
  };
  const tags = (item.getTags?.() || []).map((t: any) => t.tag);
  if (tags.length) meta.tags = tags.join(", ");
  for (const k of Object.keys(meta)) if (!meta[k]) delete meta[k];
  return meta;
}

// ---------------------------------------------------------------------------
// Full text

const textCache = new Map<number, { at: number; text: PaperText }>();
const CACHE_MAX = 12;

export async function getPaperText(item: any): Promise<PaperText> {
  const att = await getMainAttachment(item);
  if (!att) return { pages: [], headings: [], totalPages: 0, source: "none" };
  const cached = textCache.get(att.id);
  if (cached) {
    cached.at = Date.now();
    return cached.text;
  }
  let result: PaperText;
  if (att.isPDFAttachment?.()) {
    const r = await Zotero.PDFWorker.getFullText(att.id, null, true);
    const pages = String(r.text || "")
      .split("\f")
      .map((p: string) => p.replace(/\n{3,}/g, "\n\n").trim());
    result = { pages, headings: detectHeadings(pages), totalPages: r.totalPages || pages.length, source: "pdf" };
  } else {
    let text = "";
    try {
      text = (await att.attachmentText) || "";
    } catch (e) {
      Zotero.logError(e);
    }
    // No real pages: chunk into ~3000 char pseudo-pages
    const pages: string[] = [];
    for (let i = 0; i < text.length; i += 3000) pages.push(text.slice(i, i + 3000));
    result = { pages, headings: detectHeadings(pages), totalPages: pages.length, source: text ? "fulltext" : "none" };
  }
  textCache.set(att.id, { at: Date.now(), text: result });
  if (textCache.size > CACHE_MAX) {
    const oldest = [...textCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    textCache.delete(oldest[0]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Annotations

export interface AnnotationInfo {
  key: string;
  type: string;
  text: string;
  comment: string;
  color: string;
  page: string;
  pageIndex: number | null;
  tags: string[];
  dateModified: string;
}

export async function getAnnotations(item: any): Promise<AnnotationInfo[]> {
  const out: AnnotationInfo[] = [];
  const atts = item.isAttachment() ? [item] : Zotero.Items.get(item.getAttachments());
  for (const att of atts) {
    if (!att.isFileAttachment?.()) continue;
    for (const a of att.getAnnotations()) {
      let pageIndex: number | null = null;
      try {
        pageIndex = JSON.parse(a.annotationPosition).pageIndex ?? null;
      } catch {
        // ignore
      }
      out.push({
        key: a.key,
        type: a.annotationType,
        text: a.annotationText || "",
        comment: a.annotationComment || "",
        color: a.annotationColor || "",
        page: a.annotationPageLabel || (pageIndex !== null ? String(pageIndex + 1) : ""),
        pageIndex,
        tags: a.getTags().map((t: any) => t.tag),
        dateModified: a.dateModified,
      });
    }
  }
  out.sort((a, b) => (a.pageIndex ?? 0) - (b.pageIndex ?? 0));
  return out;
}
