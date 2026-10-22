/**
 * Web search and page fetching.
 * Default: DeepSeek's own Search / Fetch APIs (api.deepseek.com/v1/tools/*),
 * which work with any DeepSeek model. Free fallbacks: DuckDuckGo / Bing HTML
 * and direct fetch + local HTML → text. Tavily / Brave / SearXNG optional.
 */
import { getSettings } from "./config";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  site?: string;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0";

export async function httpGet(url: string, init: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const outer = init.signal;
  if (outer) outer.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA, ...((init.headers as any) || {}) } });
  } catch (e: any) {
    if (ctrl.signal.aborted && !outer?.aborted) throw new Error(`请求超时: ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function parseHTML(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

// ---------------------------------------------------------------------------
// HTML → text

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME", "FORM", "BUTTON", "SELECT", "TEMPLATE", "CANVAS", "VIDEO", "AUDIO"]);
const BLOCK = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "MAIN", "UL", "OL", "TABLE", "TR", "BLOCKQUOTE", "PRE", "FIGURE", "FIGCAPTION",
  "DL", "DT", "DD", "LI", "BR", "HR", "CAPTION",
]);

/** Convert a DOM subtree to lightweight markdown-ish text (MathML → $alttext$). */
export function domToText(root: Node, baseUrl?: string, keepLinks = true): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      parts.push((node.nodeValue || "").replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if (tag === "MATH") {
      const alt = el.getAttribute("alttext");
      if (alt) {
        parts.push(el.getAttribute("display") === "block" ? `\n$$${alt}$$\n` : `$${alt}$`);
        return;
      }
    }
    if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) return;
    if (/^H[1-6]$/.test(tag)) {
      parts.push(`\n\n${"#".repeat(Number(tag[1]))} `);
      el.childNodes.forEach(walk);
      parts.push("\n");
      return;
    }
    if (tag === "LI") parts.push("\n- ");
    else if (tag === "TD" || tag === "TH") parts.push(" | ");
    else if (BLOCK.has(tag)) parts.push("\n");
    if (tag === "A" && keepLinks) {
      const href = el.getAttribute("href") || "";
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 2 && /^(https?:|\/)/.test(href)) {
        let abs = href;
        try {
          abs = new URL(href, baseUrl).href;
        } catch {
          // keep raw
        }
        parts.push(`[${text}](${abs})`);
        return;
      }
    }
    el.childNodes.forEach(walk);
    if (BLOCK.has(tag)) parts.push("\n");
  };
  walk(root);
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToReadable(html: string, baseUrl?: string): { title: string; text: string } {
  const doc = parseHTML(html);
  const title = (doc.querySelector("title")?.textContent || "").trim();
  const root: Element | null =
    doc.querySelector("article") || doc.querySelector("main") || doc.querySelector('[role="main"]') || doc.body;
  if (!root) return { title, text: "" };
  root.querySelectorAll("nav, footer, aside, header").forEach((n) => n.remove());
  return { title, text: domToText(root, baseUrl) };
}

/** DeepSeek Fetch returns markdown with redundant backslash escapes; strip them. */
export function unescapeMarkdown(md: string): string {
  return md.replace(/\\([\\`*_{}[\]()#+\-.!:,<>|~"'&$%=?@^;/])/g, "$1");
}

// ---------------------------------------------------------------------------
// DeepSeek Search / Fetch

function deepseekToolsBase(): string {
  const base = getSettings().baseUrl.trim().replace(/\/+$/, "") || "https://api.deepseek.com";
  return base.replace(/\/v1$/, "") + "/v1/tools";
}

async function deepseekPost(path: string, body: any, signal?: AbortSignal, timeoutMs = 45000): Promise<any> {
  const key = getSettings().apiKey.trim();
  if (!key) throw new Error("未配置 DeepSeek API Key");
  const res = await httpGet(
    `${deepseekToolsBase()}/${path}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
    timeoutMs,
  );
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text).error?.message || msg;
    } catch {
      // keep raw
    }
    const err: any = new Error(`DeepSeek ${path} HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

async function searchDeepSeek(query: string, max: number, signal?: AbortSignal, originalQuestion?: string): Promise<SearchResult[]> {
  const body: any = { query: query.slice(0, 128), count: Math.min(Math.max(max, 1), 50) };
  if (originalQuestion) body.ori_question = originalQuestion.slice(0, 128);
  const data = await deepseekPost("search", body, signal);
  return (data.results || []).map((r: any) => ({
    title: r.title || "",
    url: r.url || "",
    // summary (600-800 chars) is intended for model consumption
    snippet: r.summary || r.snippet || "",
    date: r.date ? String(r.date).slice(0, 10) : undefined,
    site: r.site_name || undefined,
  }));
}

// ---------------------------------------------------------------------------
// Free / third-party engines

async function searchDuckDuckGo(query: string, max: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await httpGet("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
    signal,
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const doc = parseHTML(await res.text());
  const out: SearchResult[] = [];
  for (const r of Array.from(doc.querySelectorAll(".result"))) {
    if (r.classList.contains("result--ad")) continue;
    const a = r.querySelector("a.result__a");
    if (!a) continue;
    let url = a.getAttribute("href") || "";
    const m = url.match(/[?&]uddg=([^&]+)/);
    if (m) url = decodeURIComponent(m[1]);
    if (url.startsWith("//")) url = "https:" + url;
    out.push({
      title: (a.textContent || "").trim(),
      url,
      snippet: (r.querySelector(".result__snippet")?.textContent || "").replace(/\s+/g, " ").trim(),
    });
    if (out.length >= max) break;
  }
  return out.length ? out : searchBing(query, max, signal);
}

async function searchBing(query: string, max: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await httpGet(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
  const doc = parseHTML(await res.text());
  const out: SearchResult[] = [];
  for (const li of Array.from(doc.querySelectorAll("li.b_algo"))) {
    const a = li.querySelector("h2 a");
    if (!a) continue;
    let url = a.getAttribute("href") || "";
    const u = url.match(/[?&]u=a1([^&]+)/);
    if (u) {
      try {
        url = atob(decodeURIComponent(u[1]).replace(/-/g, "+").replace(/_/g, "/"));
      } catch {
        // keep redirect url
      }
    }
    out.push({
      title: (a.textContent || "").trim(),
      url,
      snippet: (li.querySelector(".b_caption p, .b_lineclamp2, .b_algoSlug")?.textContent || "").replace(/\s+/g, " ").trim(),
    });
    if (out.length >= max) break;
  }
  return out;
}

async function searchTavily(query: string, max: number, key: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await httpGet("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: max, search_depth: "basic" }),
    signal,
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.results || []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content || "" }));
}

async function searchBrave(query: string, max: number, key: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await httpGet(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal,
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = await res.json();
  return (data.web?.results || []).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: String(r.description || "").replace(/<[^>]+>/g, ""),
  }));
}

async function searchSearxng(query: string, max: number, base: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await httpGet(`${base.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json`, { signal });
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, max).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content || "" }));
}

export async function webSearch(
  query: string,
  max = 8,
  signal?: AbortSignal,
  originalQuestion?: string,
): Promise<{ engine: string; results: SearchResult[]; note?: string }> {
  const s = getSettings();
  if (s.searchEngine === "tavily" && s.tavilyKey) return { engine: "tavily", results: await searchTavily(query, max, s.tavilyKey, signal) };
  if (s.searchEngine === "brave" && s.braveKey) return { engine: "brave", results: await searchBrave(query, max, s.braveKey, signal) };
  if (s.searchEngine === "searxng" && s.searxngUrl) return { engine: "searxng", results: await searchSearxng(query, max, s.searxngUrl, signal) };
  if (s.searchEngine === "deepseek") {
    try {
      return { engine: "deepseek", results: await searchDeepSeek(query, max, signal, originalQuestion) };
    } catch (e: any) {
      if (signal?.aborted) throw e;
      const results = await searchDuckDuckGo(query.replace(/\b(lang|after|before):\S+/g, "").trim(), max, signal);
      return { engine: "duckduckgo", results, note: `DeepSeek 搜索失败（${e.message}），已回退到 DuckDuckGo` };
    }
  }
  return { engine: "duckduckgo", results: await searchDuckDuckGo(query, max, signal) };
}

// ---------------------------------------------------------------------------
// Fetch

async function fetchLocal(url: string, signal?: AbortSignal): Promise<{ url: string; title: string; text: string }> {
  const res = await httpGet(url, { signal, redirect: "follow" });
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  if (/pdf/i.test(contentType)) {
    throw new Error("该链接是 PDF 文件，无法直接解析。若是 arXiv 论文请使用 arxiv_read。");
  }
  const body = await res.text();
  if (!/html/i.test(contentType) && /json|text\/plain|markdown|xml/i.test(contentType)) {
    return { url: res.url || url, title: "", text: body };
  }
  const { title, text } = htmlToReadable(body, res.url || url);
  return { url: res.url || url, title, text };
}

export async function fetchPage(url: string, signal?: AbortSignal): Promise<{ url: string; title: string; text: string; engine: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error("只支持 http(s) 链接");
  const s = getSettings();
  if (s.fetchEngine === "deepseek" && s.apiKey) {
    try {
      const data = await deepseekPost("fetch", { url }, signal, 60000);
      if (data.content) return { url, title: data.title || "", text: unescapeMarkdown(data.content), engine: "deepseek" };
    } catch (e: any) {
      if (signal?.aborted) throw e;
      // fall through to local fetch
    }
  }
  return { ...(await fetchLocal(url, signal)), engine: "local" };
}
