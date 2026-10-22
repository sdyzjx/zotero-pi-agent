import katex from "katex";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { hydrateMermaid } from "./mermaid";
import { createMarkdown } from "../shared/markdown";

const cache = new Map<string, string>();

const md = createMarkdown((tex, display) => {
  const key = (display ? "D" : "I") + tex;
  let html = cache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" });
    } catch {
      html = `<code>${md.utils.escapeHtml(tex)}</code>`;
    }
    if (cache.size > 2000) cache.clear();
    cache.set(key, html);
  }
  return display ? `<div class="math-display">${html}</div>` : html;
});

// Open links outside, mark page links
const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = String(tokens[idx].attrGet("href") || "");
  if (/^page:/i.test(href)) tokens[idx].attrJoin("class", "page-link");
  else if (/^annotation:/i.test(href)) tokens[idx].attrJoin("class", "ann-link");
  else tokens[idx].attrSet("title", href);
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// ```mermaid fences → placeholder hydrated into a diagram after render
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  if (t.info.trim().toLowerCase() === "mermaid") {
    const code = md.utils.escapeHtml(t.content.trim());
    return `<div class="mermaid-block" data-code="${code}"><pre class="mermaid-src"><code>${code}</code></pre></div>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

export function renderMarkdown(text: string): string {
  return md.render(text || "");
}

export function Markdown({ text, className, live = false }: { text: string; className?: string; live?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current && html.includes("mermaid-block")) hydrateMermaid(ref.current, live);
  }, [html, live]);
  return <div ref={ref} class={"md " + (className || "")} dangerouslySetInnerHTML={{ __html: html }} />;
}
