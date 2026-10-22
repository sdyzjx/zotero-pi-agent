/**
 * Mermaid diagrams for ```mermaid code blocks.
 *
 * The chat page is privileged and diagram source comes from the model, so:
 * mermaid runs with securityLevel "strict", and the resulting SVG is shown as an
 * <img> (SVG images never run scripts or load external resources).
 * The library (~2.7 MB) is loaded lazily on first use.
 */

let loader: Promise<any> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;
const cache = new Map<string, { svg?: string; error?: string }>();

function loadMermaid(): Promise<any> {
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/mermaid.min.js";
      s.onload = () => {
        const m = (window as any).mermaid;
        if (!m) return reject(new Error("mermaid failed to load"));
        m.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // Always light, like a paper figure: model-written `style` fills assume a light theme.
          theme: "default",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif",
          flowchart: { curve: "basis" },
          suppressErrorRendering: true,
        });
        resolve(m);
      };
      s.onerror = () => reject(new Error("mermaid failed to load"));
      document.head.append(s);
    });
  }
  return loader;
}

/**
 * Make the SVG a valid standalone image: well-formed XML (mermaid may emit HTML
 * like <br> inside foreignObject) with explicit pixel size from its viewBox.
 * Both parsers produce inert documents (no scripts, no loads).
 */
function sizeSvg(svg: string): string {
  let el: Element | null = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  if (!el || el.nodeName !== "svg") {
    el = new DOMParser().parseFromString(svg, "text/html").querySelector("svg");
    if (!el) throw new Error("invalid SVG output");
  }
  const vb = (el.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    el.setAttribute("width", String(Math.ceil(vb[2])));
    el.setAttribute("height", String(Math.ceil(vb[3])));
  }
  el.removeAttribute("style");
  return new XMLSerializer().serializeToString(el);
}

export function renderMermaid(code: string): Promise<{ svg?: string; error?: string }> {
  const key = code;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  // mermaid keeps global state: render one diagram at a time
  const job = queue.then(async () => {
    const again = cache.get(key);
    if (again) return again;
    let result: { svg?: string; error?: string };
    try {
      const m = await loadMermaid();
      const { svg } = await m.render(`zp-mmd-${++seq}`, code);
      result = { svg: sizeSvg(svg) };
    } catch (e: any) {
      result = { error: String(e?.message || e).split("\n").slice(0, 4).join("\n") };
      // mermaid may leave its temporary render node behind on errors
      document.getElementById(`dzp-mmd-${seq}`)?.remove();
    }
    if (cache.size > 200) cache.clear();
    cache.set(key, result);
    return result;
  });
  queue = job.catch(() => undefined);
  return job;
}

function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** Replace `.mermaid-block` placeholders inside `root` with rendered diagrams. */
export function hydrateMermaid(root: HTMLElement, live: boolean): void {
  for (const block of Array.from(root.querySelectorAll<HTMLElement>(".mermaid-block:not([data-done])"))) {
    const code = block.getAttribute("data-code") || "";
    if (live) {
      block.classList.add("pending");
      continue;
    }
    block.setAttribute("data-done", "1");
    block.classList.remove("pending");
    block.classList.add("loading");
    void renderMermaid(code).then((r) => {
      if (!block.isConnected) return;
      block.classList.remove("loading");
      const src = block.querySelector("pre");
      if (r.error || !r.svg) {
        block.classList.add("failed");
        const err = document.createElement("div");
        err.className = "mermaid-error";
        err.textContent = `图表渲染失败：${r.error || "未知错误"}`;
        block.insertBefore(err, src);
        return;
      }
      const fig = document.createElement("div");
      fig.className = "mermaid-figure";
      const img = document.createElement("img");
      const url = svgDataUrl(r.svg);
      img.src = url;
      img.alt = "mermaid diagram";
      img.title = "点击切换原始大小";
      // Wide diagrams: don't shrink below 60% of natural size; scroll horizontally instead.
      const fit = () => {
        const nw = img.naturalWidth;
        if (!nw) return;
        const cw = Math.max(100, fig.clientWidth - 18);
        const zoomed = fig.classList.contains("zoomed");
        img.style.width = `${zoomed ? nw : nw > cw ? Math.min(nw, Math.max(cw, nw * 0.6)) : nw}px`;
      };
      img.addEventListener("load", fit);
      img.addEventListener("click", () => {
        fig.classList.toggle("zoomed");
        fit();
      });
      fig.append(img);
      const bar = document.createElement("div");
      bar.className = "mermaid-bar";
      const mk = (label: string, fn: () => void) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        });
        bar.append(b);
        return b;
      };
      const toggle = mk("源码", () => {
        block.classList.toggle("show-src");
        toggle.textContent = block.classList.contains("show-src") ? "图表" : "源码";
      });
      const copy = mk("复制", () => {
        void navigator.clipboard.writeText(code);
        copy.textContent = "已复制";
        setTimeout(() => (copy.textContent = "复制"), 1500);
      });
      mk("放大", () => openViewer(url, code));
      block.insertBefore(fig, src);
      block.insertBefore(bar, src);
      block.classList.add("rendered");
    });
  }
}

/** Open the diagram in a separate resizable window with zoom / pan. */
function openViewer(src: string, code: string): void {
  const w: any = window;
  const opener = w.openDialog ? w : w.top;
  opener.openDialog(
    "chrome://zoteropi/content/diagram.html",
    "",
    "chrome,resizable,centerscreen,dialog=no,width=1100,height=760",
    { src, code },
  );
}
