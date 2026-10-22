export const HTML_NS = "http://www.w3.org/1999/xhtml";

export function h(doc: Document, tag: string, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElement {
  const el = doc.createElementNS(HTML_NS, tag) as HTMLElement;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

export function ensureStylesheet(doc: Document): void {
  if (doc.getElementById("zoteropi-css")) return;
  const link = h(doc, "link", { id: "zoteropi-css", rel: "stylesheet", href: "chrome://zoteropi/content/panel.css" });
  doc.documentElement.appendChild(link);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
