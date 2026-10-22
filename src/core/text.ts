/**
 * Pure text helpers (no Zotero dependencies) for progressive disclosure of
 * paper text and for locating quotes inside PDF character streams.
 */

export interface Heading {
  title: string;
  page: number; // 0-based page index
  offset: number; // char offset within the page text
}

const COMMON_SECTIONS =
  /^(abstract|introduction|background|related works?|preliminar(y|ies)|methods?|methodology|approach|model|experiments?|experimental (setup|results)|evaluation|results?( and discussion)?|discussion|analysis|limitations?|future work|conclusions?( and future work)?|summary|acknowledg(e)?ments?|references|bibliography|appendix|appendices|supplementary( material)?|摘要|引言|绪论|相关工作|方法|实验|结果|讨论|结论|参考文献|致谢|附录)\b/i;

const NUMBERED = /^((\d{1,2}(\.\d{1,2}){0,3})\.?|[IVXLC]{1,6}\.|[A-H](\.\d{1,2})*\.?)\s+\p{Lu}[^\n]{1,90}$/u;

/** Heuristic section heading detection over per-page text (paragraphs separated by \n). */
export function detectHeadings(pages: string[]): Heading[] {
  const out: Heading[] = [];
  pages.forEach((text, page) => {
    let offset = 0;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const start = offset + raw.indexOf(line);
      offset += raw.length + 1;
      if (line.length < 3 || line.length > 100) continue;
      if (/[.:;,]$/.test(line) && !/^\d/.test(line)) continue;
      const words = line.split(/\s+/).length;
      if (words > 14) continue;
      if (NUMBERED.test(line) && !/\d{3,}/.test(line.replace(/^\S+\s+/, "")) && !/\bet al\b|=|%/.test(line)) {
        // Avoid figure / table captions and numbered list items with long sentences
        if (/^(fig(ure)?|table|eq)/i.test(line.replace(/^\S+\s+/, ""))) continue;
        out.push({ title: line, page, offset: start });
      } else if (COMMON_SECTIONS.test(line) && words <= 6) {
        out.push({ title: line, page, offset: start });
      }
    }
  });
  // Drop duplicates that appear many times (running headers)
  const counts = new Map<string, number>();
  for (const h of out) counts.set(h.title.toLowerCase(), (counts.get(h.title.toLowerCase()) || 0) + 1);
  return out.filter((h) => (counts.get(h.title.toLowerCase()) || 0) <= 2);
}

export interface Snippet {
  page: number;
  offset: number;
  text: string;
}

/** Keyword / phrase search with context snippets. */
export function searchPages(pages: string[], query: string, maxResults = 8, context = 220): Snippet[] {
  const q = query.trim();
  if (!q) return [];
  const results: Snippet[] = [];
  const lowerPages = pages.map((p) => p.toLowerCase());
  const seen = new Set<string>();
  const push = (page: number, idx: number, len: number) => {
    const key = `${page}:${Math.floor(idx / (context * 2))}`;
    if (seen.has(key)) return;
    seen.add(key);
    const s = Math.max(0, idx - context);
    const e = Math.min(pages[page].length, idx + len + context);
    results.push({
      page,
      offset: idx,
      text: (s > 0 ? "…" : "") + pages[page].slice(s, e).replace(/\s+/g, " ").trim() + (e < pages[page].length ? "…" : ""),
    });
  };
  // 1. exact phrase
  const phrase = q.toLowerCase();
  for (let p = 0; p < pages.length && results.length < maxResults; p++) {
    let idx = lowerPages[p].indexOf(phrase);
    while (idx !== -1 && results.length < maxResults) {
      push(p, idx, phrase.length);
      idx = lowerPages[p].indexOf(phrase, idx + phrase.length);
    }
  }
  if (results.length >= maxResults) return results;
  // 2. all terms within a window, scored by number of distinct terms
  const terms = Array.from(new Set(phrase.split(/[\s,;，；、]+/).filter((t) => t.length >= 2)));
  if (terms.length < 2) return results;
  const candidates: { page: number; idx: number; score: number }[] = [];
  for (let p = 0; p < pages.length; p++) {
    const lp = lowerPages[p];
    for (const t of terms) {
      let idx = lp.indexOf(t);
      while (idx !== -1) {
        const win = lp.slice(Math.max(0, idx - 300), idx + 300);
        const score = terms.reduce((n, tt) => n + (win.includes(tt) ? 1 : 0), 0);
        if (score >= Math.min(2, terms.length)) candidates.push({ page: p, idx, score });
        idx = lp.indexOf(t, idx + t.length);
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.page - b.page || a.idx - b.idx);
  for (const c of candidates) {
    if (results.length >= maxResults) break;
    push(c.page, c.idx, 0);
  }
  return results;
}

/** Truncate with a hint about how to continue. */
export function sliceWithHint(text: string, offset: number, maxChars: number): { text: string; nextOffset: number | null; total: number } {
  const total = text.length;
  const start = Math.max(0, Math.min(offset, total));
  let end = Math.min(total, start + maxChars);
  // try not to cut mid-sentence
  if (end < total) {
    const cut = text.lastIndexOf("\n", end);
    if (cut > start + maxChars * 0.7) end = cut;
  }
  return { text: text.slice(start, end), nextOffset: end < total ? end : null, total };
}

// ---------------------------------------------------------------------------
// Quote matching against PDF characters

export interface PdfChar {
  u?: string;
  c?: string;
  rect: number[];
  inlineRect?: number[];
  rotation?: number;
  spaceAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  ignorable?: boolean;
}

const QUOTE_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "′": "'",
  "″": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "−": "-",
  "­": "",
};

/** Normalize a single string fragment for fuzzy comparison. Whitespace is dropped entirely. */
export function normalizeForMatch(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFKC").toLowerCase()) {
    const m = QUOTE_MAP[ch];
    const c = m !== undefined ? m : ch;
    if (!c || /\s/.test(c)) continue;
    out += c;
  }
  return out;
}

/**
 * Build a whitespace-free normalized string from chars with a mapping from
 * each normalized position back to the char index. Line-end hyphens are dropped.
 */
export function buildCharIndex(chars: PdfChar[]): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch.ignorable) continue;
    const raw = ch.u ?? ch.c ?? "";
    if (ch.lineBreakAfter && /^[-­‐‑]$/.test(raw)) continue; // hyphenation
    const n = normalizeForMatch(raw);
    for (const c of n) {
      text += c;
      map.push(i);
    }
  }
  return { text, map };
}

/** Find a quote in chars; returns [startCharIndex, endCharIndex] (inclusive) or null. */
export function findQuote(chars: PdfChar[], quote: string, index?: { text: string; map: number[] }): [number, number] | null {
  const idx = index || buildCharIndex(chars);
  const q = normalizeForMatch(quote).replace(/…|\.\.\./g, "");
  if (q.length < 3) return null;
  let pos = idx.text.indexOf(q);
  if (pos !== -1) return [idx.map[pos], idx.map[pos + q.length - 1]];
  // Fuzzy: anchor on prefix and suffix
  for (const frac of [0.4, 0.25]) {
    const n = Math.max(8, Math.floor(q.length * frac));
    if (n >= q.length) continue;
    const head = q.slice(0, n);
    const tail = q.slice(-n);
    let h = idx.text.indexOf(head);
    while (h !== -1) {
      const t = idx.text.indexOf(tail, h + n);
      if (t !== -1 && t + n - h <= q.length * 1.6) {
        return [idx.map[h], idx.map[t + n - 1]];
      }
      h = idx.text.indexOf(head, h + 1);
    }
  }
  return null;
}

function normRect(r: number[]): number[] {
  const [x1, y1, x2, y2] = r;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** Port of Zotero reader's getRangeRects: one rect per line. */
export function getRangeRects(chars: PdfChar[], start: number, end: number): number[][] {
  const rects: number[][] = [];
  let s = start;
  for (let i = start; i <= end; i++) {
    const ch = chars[i];
    if (!(ch.lineBreakAfter || i === end)) continue;
    const first = chars[s];
    const firstRect = normRect(first.rect);
    const lastRect = normRect(ch.rect);
    const inline = normRect(first.inlineRect || first.rect);
    const rot = first.rotation ?? 0;
    const rect =
      rot === 90 || rot === 270
        ? [inline[0], firstRect[1], inline[2], lastRect[3]]
        : [firstRect[0], inline[1], lastRect[2], inline[3]];
    rects.push(rect.map((v) => Math.round(v * 1000) / 1000));
    s = i + 1;
  }
  return rects;
}

export function pageTextFromChars(chars: PdfChar[]): string {
  let out = "";
  for (const ch of chars) {
    if (ch.ignorable) continue;
    out += ch.u ?? ch.c ?? "";
    if (ch.paragraphBreakAfter) out += "\n";
    else if (ch.spaceAfter || ch.lineBreakAfter) out += " ";
  }
  return out;
}
