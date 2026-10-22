/**
 * markdown-it with a math extension supporting $…$, $$…$$, \(…\) and \[…\].
 * Raw HTML is disabled: model output (which may echo web content) is rendered
 * inside privileged chrome documents, so it must never become live markup.
 */
import MarkdownIt from "markdown-it";

type MD = InstanceType<typeof MarkdownIt>;

export type MathRenderer = (tex: string, display: boolean) => string;

function isWS(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function mathPlugin(md: MD, render: MathRenderer) {
  // Inline: \( … \), $$ … $$ (inline display), $ … $
  md.inline.ruler.before("escape", "math_inline", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    const ch = src.charCodeAt(start);
    let open = "";
    let close = "";
    let display = false;
    if (ch === 0x5c /* \ */) {
      const next = src[start + 1];
      if (next === "(") {
        open = "\\(";
        close = "\\)";
      } else if (next === "[") {
        open = "\\[";
        close = "\\]";
        display = true;
      } else return false;
    } else if (ch === 0x24 /* $ */) {
      if (src.charCodeAt(start + 1) === 0x24) {
        open = close = "$$";
        display = true;
      } else {
        open = close = "$";
        if (isWS(src.charCodeAt(start + 1))) return false;
      }
    } else return false;

    let pos = start + open.length;
    let end = -1;
    while (pos < src.length) {
      const idx = src.indexOf(close, pos);
      if (idx === -1) break;
      // skip escaped delimiters like \$
      if (close === "$" && src.charCodeAt(idx - 1) === 0x5c) {
        pos = idx + 1;
        continue;
      }
      if (close === "$") {
        if (isWS(src.charCodeAt(idx - 1))) {
          pos = idx + 1;
          continue;
        }
        const after = src.charCodeAt(idx + 1);
        if (after >= 0x30 && after <= 0x39) {
          pos = idx + 1;
          continue;
        }
      }
      end = idx;
      break;
    }
    if (end === -1 || end === start + open.length) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = src.slice(start + open.length, end);
      token.markup = open;
      token.meta = { display };
    }
    state.pos = end + close.length;
    return true;
  });

  // Block: $$ … $$ or \[ … \] spanning lines
  md.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    const first = state.src.slice(pos, max);
    let open: string;
    let close: string;
    if (first.startsWith("$$")) {
      open = "$$";
      close = "$$";
    } else if (first.startsWith("\\[")) {
      open = "\\[";
      close = "\\]";
    } else return false;

    let content = "";
    let rest = first.slice(open.length);
    let line = startLine;
    let found = false;
    const closeIdx = rest.indexOf(close);
    if (closeIdx !== -1) {
      if (rest.slice(closeIdx + close.length).trim()) return false; // inline usage, leave to inline rule
      content = rest.slice(0, closeIdx);
      found = true;
    } else {
      content = rest;
      for (line = startLine + 1; line < endLine; line++) {
        pos = state.bMarks[line] + state.tShift[line];
        max = state.eMarks[line];
        if (pos < max && state.tShift[line] < state.blkIndent) break;
        const text = state.src.slice(pos, max);
        const idx = text.indexOf(close);
        if (idx !== -1) {
          content += "\n" + text.slice(0, idx);
          found = true;
          break;
        }
        content += "\n" + text;
      }
    }
    if (!found) return false; // unclosed (e.g. while streaming): render as text
    if (silent) return true;
    state.line = line + 1;
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content = content.trim();
    token.markup = open;
    token.map = [startLine, state.line];
    return true;
  });

  md.renderer.rules.math_inline = (tokens, idx) => render(tokens[idx].content, !!tokens[idx].meta?.display);
  md.renderer.rules.math_block = (tokens, idx) => render(tokens[idx].content, true) + "\n";
}

export function createMarkdown(render: MathRenderer): MD {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });
  md.use(mathPlugin, render);
  return md;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Renderer for Zotero notes: Zotero's note editor understands these math wrappers. */
export const zoteroNoteMath: MathRenderer = (tex, display) =>
  display ? `<pre class="math">$$${escapeHtml(tex)}$$</pre>` : `<span class="math">$${escapeHtml(tex)}$</span>`;
