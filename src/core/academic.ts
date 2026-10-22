/**
 * arXiv (API + HTML full text) and Google Scholar (with Semantic Scholar fallback).
 */
import { domToText, httpGet, parseHTML } from "./web";

export interface ArxivEntry {
  id: string;
  title: string;
  authors: string[];
  published: string;
  updated: string;
  categories: string[];
  summary: string;
  pdf: string;
  abs: string;
}

export function normalizeArxivId(input: string): string {
  const s = input.trim();
  const m =
    s.match(/arxiv\.org\/(?:abs|pdf|html)\/([^?#\s]+?)(?:\.pdf)?(?:[?#].*)?$/i) ||
    s.match(/^(?:arxiv:)?\s*(\d{4}\.\d{4,5}(?:v\d+)?)$/i) ||
    s.match(/^(?:arxiv:)?\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)$/i);
  return m ? m[1] : s;
}

function text(el: Element | null | undefined): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function parseAtom(xml: string): ArxivEntry[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName("entry")).map((e) => {
    const absUrl = text(e.getElementsByTagName("id")[0]);
    const links = Array.from(e.getElementsByTagName("link"));
    return {
      id: absUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, ""),
      title: text(e.getElementsByTagName("title")[0]),
      authors: Array.from(e.getElementsByTagName("author")).map((a) => text(a.getElementsByTagName("name")[0])),
      published: text(e.getElementsByTagName("published")[0]).slice(0, 10),
      updated: text(e.getElementsByTagName("updated")[0]).slice(0, 10),
      categories: Array.from(e.getElementsByTagName("category")).map((c) => c.getAttribute("term") || ""),
      summary: text(e.getElementsByTagName("summary")[0]),
      pdf: links.find((l) => l.getAttribute("title") === "pdf")?.getAttribute("href") || "",
      abs: absUrl,
    };
  });
}

export async function arxivSearch(
  query: string,
  opts: { max?: number; sortBy?: "relevance" | "submittedDate" | "lastUpdatedDate"; signal?: AbortSignal } = {},
): Promise<{ total: number; entries: ArxivEntry[] }> {
  // Allow raw arXiv query syntax (ti:, au:, abs:, cat:), otherwise search all fields.
  const q = /\b(ti|au|abs|cat|all|co|jr|id):/.test(query) ? query : `all:${query.trim().split(/\s+/).join(" AND all:")}`;
  const params = new URLSearchParams({
    search_query: q,
    start: "0",
    max_results: String(Math.min(opts.max || 8, 30)),
    sortBy: opts.sortBy || "relevance",
    sortOrder: "descending",
  });
  const res = await httpGet(`https://export.arxiv.org/api/query?${params}`, { signal: opts.signal });
  if (!res.ok) throw new Error(`arXiv API HTTP ${res.status}`);
  const xml = await res.text();
  const total = Number(xml.match(/<opensearch:totalResults[^>]*>(\d+)</)?.[1] || 0);
  return { total, entries: parseAtom(xml) };
}

export async function arxivGet(id: string, signal?: AbortSignal): Promise<ArxivEntry | null> {
  const res = await httpGet(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(normalizeArxivId(id))}`, { signal });
  if (!res.ok) throw new Error(`arXiv API HTTP ${res.status}`);
  const entries = parseAtom(await res.text());
  return entries.find((e) => e.title && e.title !== "Error") || null;
}

export interface ArxivSection {
  title: string;
  text: string;
}

const htmlCache = new Map<string, ArxivSection[] | null>();

/** Full text from arxiv.org/html/<id> split into top-level sections. */
export async function arxivSections(id: string, signal?: AbortSignal): Promise<ArxivSection[] | null> {
  const key = normalizeArxivId(id);
  if (htmlCache.has(key)) return htmlCache.get(key)!;
  const res = await httpGet(`https://arxiv.org/html/${key}`, { signal });
  if (!res.ok) {
    htmlCache.set(key, null);
    return null;
  }
  const doc = parseHTML(await res.text());
  const article = doc.querySelector("article.ltx_document") || doc.querySelector("article") || doc.body;
  if (!article) return null;
  const sections: ArxivSection[] = [];
  const abs = article.querySelector(".ltx_abstract");
  if (abs) sections.push({ title: "Abstract", text: domToText(abs, res.url, false).replace(/^#+\s*Abstract\s*/i, "") });
  const tops = Array.from(article.querySelectorAll(":scope > section, :scope > div > section")).filter(
    (s) => /ltx_(section|appendix|bibliography)/.test(s.className),
  );
  for (const sec of tops) {
    const h = sec.querySelector(".ltx_title");
    const title = text(h) || sec.id;
    sections.push({ title, text: domToText(sec, res.url, false) });
  }
  if (sections.length <= 1) sections.push({ title: "Full text", text: domToText(article, res.url, false) });
  htmlCache.set(key, sections);
  if (htmlCache.size > 20) htmlCache.delete(htmlCache.keys().next().value!);
  return sections;
}

// ---------------------------------------------------------------------------
// Google Scholar

export interface ScholarResult {
  title: string;
  url: string;
  authorsVenue: string;
  snippet: string;
  citedBy?: number;
  pdf?: string;
}

export async function scholarSearch(
  query: string,
  opts: { max?: number; yearFrom?: number; yearTo?: number; signal?: AbortSignal } = {},
): Promise<{ source: string; results: ScholarResult[]; note?: string }> {
  const params = new URLSearchParams({ hl: "en", q: query });
  if (opts.yearFrom) params.set("as_ylo", String(opts.yearFrom));
  if (opts.yearTo) params.set("as_yhi", String(opts.yearTo));
  let blocked = "";
  try {
    const res = await httpGet(`https://scholar.google.com/scholar?${params}`, { signal: opts.signal });
    const html = await res.text();
    if (res.ok && !/gs_captcha|unusual traffic|id="recaptcha"/i.test(html)) {
      const doc = parseHTML(html);
      const results: ScholarResult[] = [];
      for (const r of Array.from(doc.querySelectorAll(".gs_r.gs_or.gs_scl"))) {
        const a = r.querySelector(".gs_rt a");
        const titleEl = r.querySelector(".gs_rt");
        const cited = Array.from(r.querySelectorAll(".gs_fl a")).find((x) => /Cited by/.test(x.textContent || ""));
        results.push({
          title: text(a || titleEl).replace(/^\[(PDF|HTML|BOOK|CITATION|B)\]\s*/g, ""),
          url: a?.getAttribute("href") || "",
          authorsVenue: text(r.querySelector(".gs_a")),
          snippet: text(r.querySelector(".gs_rs")),
          citedBy: cited ? Number((cited.textContent || "").replace(/\D/g, "")) || undefined : undefined,
          pdf: r.querySelector(".gs_or_ggsm a")?.getAttribute("href") || undefined,
        });
        if (results.length >= (opts.max || 10)) break;
      }
      if (results.length) return { source: "google_scholar", results };
      blocked = "Google Scholar 没有返回结果";
    } else {
      blocked = `Google Scholar 拒绝了请求（HTTP ${res.status}，可能需要人机验证）`;
    }
  } catch (e: any) {
    if (opts.signal?.aborted) throw e;
    blocked = `Google Scholar 无法访问：${e.message}`;
  }
  // Fallback: Semantic Scholar Graph API
  const ss = new URLSearchParams({
    query,
    limit: String(opts.max || 10),
    fields: "title,authors,year,venue,abstract,citationCount,externalIds,url,openAccessPdf",
  });
  if (opts.yearFrom || opts.yearTo) ss.set("year", `${opts.yearFrom || ""}-${opts.yearTo || ""}`);
  const res = await httpGet(`https://api.semanticscholar.org/graph/v1/paper/search?${ss}`, { signal: opts.signal });
  if (!res.ok) throw new Error(`${blocked}；Semantic Scholar 回退也失败（HTTP ${res.status}）`);
  const data = await res.json();
  return {
    source: "semantic_scholar",
    note: `${blocked}，已改用 Semantic Scholar`,
    results: (data.data || []).map((p: any) => ({
      title: p.title,
      url: p.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : ""),
      authorsVenue: `${(p.authors || []).slice(0, 5).map((a: any) => a.name).join(", ")} - ${p.venue || ""} ${p.year || ""}`.trim(),
      snippet: String(p.abstract || "").slice(0, 400),
      citedBy: p.citationCount,
      pdf: p.openAccessPdf?.url,
    })),
  };
}
