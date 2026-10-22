import { Type } from "@earendil-works/pi-ai";
import { arxivGet, arxivSearch, arxivSections, normalizeArxivId, scholarSearch } from "../academic";
import { getSettings } from "../config";
import { sliceWithHint } from "../text";
import { fetchPage, webSearch } from "../web";
import { clip, ok, tool, type Tool, type ToolContext } from "./common";

const pageCache = new Map<string, { title: string; text: string; url: string }>();

export function webTools(ctx: ToolContext): Tool[] {
  const search = tool({
    name: "web_search",
    label: "网络搜索",
    description:
      "Search the web (DeepSeek search). Supports operators: site:, -site:, \"exact phrase\", -term, lang:zh,en, after:2025-01-01, before:2026. Returns titles, URLs and summaries; use web_fetch to read a page.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query, max 128 chars" }),
      max_results: Type.Optional(Type.Number({ description: "Default 8, max 20" })),
    }),
    async execute(_id, p, signal) {
      const r = await webSearch(p.query, Math.min(p.max_results || 8, 20), signal, ctx.lastUserText());
      if (!r.results.length) return ok(`No results for "${p.query}" (${r.engine}).`, { count: 0 });
      const lines = r.results.map(
        (x, i) => `${i + 1}. ${x.title}${x.site ? ` — ${x.site}` : ""}${x.date ? ` (${x.date})` : ""}\n   ${x.url}\n   ${clip(x.snippet, 800)}`,
      );
      return ok((r.note ? `[${r.note}]\n` : "") + lines.join("\n"), { engine: r.engine, count: r.results.length });
    },
  });

  const fetchTool = tool({
    name: "web_fetch",
    label: "读取网页",
    description: "Fetch a web page and return its main content as markdown text (truncated; use offset to continue).",
    parameters: Type.Object({ url: Type.String(), offset: Type.Optional(Type.Number()) }),
    async execute(_id, p, signal) {
      let page = pageCache.get(p.url);
      if (!page) {
        const r = await fetchPage(p.url, signal);
        page = { title: r.title, text: r.text, url: r.url };
        pageCache.set(p.url, page);
        if (pageCache.size > 30) pageCache.delete(pageCache.keys().next().value!);
      }
      const s = sliceWithHint(page.text, p.offset || 0, getSettings().maxReadChars);
      const tail = s.nextOffset !== null ? `\n\n[Truncated at ${s.nextOffset}/${s.total}; call web_fetch with offset=${s.nextOffset} to continue]` : "";
      return ok(`# ${page.title || page.url}\nURL: ${page.url}\n\n${s.text}${tail}`, { chars: s.total });
    },
  });

  const arxiv = tool({
    name: "arxiv_search",
    label: "arXiv 检索",
    description:
      "Search arXiv. Plain keywords search all fields; arXiv syntax also works (ti:, au:, abs:, cat:cs.CL, AND/OR/ANDNOT). Returns ids, titles, authors, dates and abstracts.",
    parameters: Type.Object({
      query: Type.String(),
      max_results: Type.Optional(Type.Number({ description: "Default 8, max 30" })),
      sort_by: Type.Optional(Type.Union([Type.Literal("relevance"), Type.Literal("submittedDate"), Type.Literal("lastUpdatedDate")])),
    }),
    async execute(_id, p, signal) {
      const r = await arxivSearch(p.query, { max: p.max_results, sortBy: p.sort_by, signal });
      if (!r.entries.length) return ok(`No arXiv results for "${p.query}".`, { count: 0 });
      const lines = r.entries.map(
        (e, i) =>
          `${i + 1}. arXiv:${e.id} — ${e.title}\n   ${clip(e.authors.join(", "), 150)} | ${e.published} | ${e.categories.slice(0, 3).join(", ")}\n   ${clip(e.summary, 600)}`,
      );
      return ok(`Total matches: ${r.total}\n\n${lines.join("\n")}`, { count: r.entries.length });
    },
  });

  const arxivRead = tool({
    name: "arxiv_read",
    label: "阅读 arXiv 论文",
    description:
      "Read an arXiv paper progressively. Without `section`: metadata, abstract and the list of sections. With `section` (index or title part): that section's text (math as LaTeX). Use offset to continue long sections.",
    parameters: Type.Object({
      id: Type.String({ description: "arXiv id or URL, e.g. 2205.14135" }),
      section: Type.Optional(Type.String({ description: "Section index (from the list) or title" })),
      offset: Type.Optional(Type.Number()),
    }),
    async execute(_id, p, signal) {
      const id = normalizeArxivId(p.id);
      if (!p.section) {
        const meta = await arxivGet(id, signal);
        if (!meta) throw new Error(`arXiv 上找不到 ${id}`);
        const sections = await arxivSections(id, signal).catch(() => null);
        const lines = [
          `arXiv:${meta.id} — ${meta.title}`,
          `Authors: ${meta.authors.join(", ")}`,
          `Published: ${meta.published} (updated ${meta.updated}) | ${meta.categories.join(", ")}`,
          `PDF: ${meta.pdf}`,
          "",
          `Abstract: ${meta.summary}`,
          "",
        ];
        if (sections) {
          lines.push("Sections (call arxiv_read with section=<index>):");
          sections.forEach((s, i) => lines.push(`${i}. ${s.title} (${s.text.length} chars)`));
        } else {
          lines.push("No HTML full text available for this paper; only the abstract can be read.");
        }
        return ok(lines.join("\n"));
      }
      const sections = await arxivSections(id, signal);
      if (!sections) throw new Error("该论文没有 arXiv HTML 全文");
      const idx = /^\d+$/.test(p.section.trim())
        ? Number(p.section)
        : sections.findIndex((s) => s.title.toLowerCase().includes(p.section!.toLowerCase()));
      const sec = sections[idx];
      if (!sec) throw new Error(`找不到章节 ${p.section}。可选：${sections.map((s, i) => `${i}. ${s.title}`).join(" | ")}`);
      const s = sliceWithHint(sec.text, p.offset || 0, getSettings().maxReadChars);
      const tail = s.nextOffset !== null ? `\n\n[Truncated at ${s.nextOffset}/${s.total}; continue with offset=${s.nextOffset}]` : "";
      return ok(`## ${sec.title}\n\n${s.text}${tail}`);
    },
  });

  const scholar = tool({
    name: "scholar_search",
    label: "Google Scholar",
    description:
      "Search Google Scholar for papers (titles, authors/venue, snippets, citation counts). Falls back to Semantic Scholar if Scholar blocks the request.",
    parameters: Type.Object({
      query: Type.String(),
      max_results: Type.Optional(Type.Number({ description: "Default 10" })),
      year_from: Type.Optional(Type.Number()),
      year_to: Type.Optional(Type.Number()),
    }),
    async execute(_id, p, signal) {
      const r = await scholarSearch(p.query, { max: p.max_results, yearFrom: p.year_from, yearTo: p.year_to, signal });
      if (!r.results.length) return ok(`No results (${r.source}).`, { count: 0 });
      const lines = r.results.map(
        (x, i) =>
          `${i + 1}. ${x.title}\n   ${x.authorsVenue}${x.citedBy ? ` | cited by ${x.citedBy}` : ""}\n   ${x.url}${x.pdf ? ` | PDF: ${x.pdf}` : ""}\n   ${clip(x.snippet, 400)}`,
      );
      return ok((r.note ? `[${r.note}]\n` : `[source: ${r.source}]\n`) + lines.join("\n"), { source: r.source, count: r.results.length });
    },
  });

  return [search, fetchTool, arxiv, arxivRead, scholar];
}
