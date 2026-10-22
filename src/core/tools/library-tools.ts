/**
 * Library-wide tools: search papers, past AI sessions (+ conclusions), annotations
 * across papers, and saving notes / conclusions.
 */
import { Type } from "@earendil-works/pi-ai";
import { createMarkdown, zoteroNoteMath } from "../../shared/markdown";
import { creatorsString, getItem, paperTitle, topLevelItem } from "../paper";
import * as store from "../store";
import { clip, ok, tool, type Tool, type ToolContext } from "./common";
import { resolvePaperItem } from "./paper-tools";

const noteMd = createMarkdown(zoteroNoteMath);

async function sessionCounts(libraryID: number, keys: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const k of keys) {
    const list = await store.listSessionsForPaper(libraryID, k);
    if (list.length) map.set(k, list.length);
  }
  return map;
}

function messageText(m: any): string {
  if (typeof m.content === "string") return m.content;
  if (!Array.isArray(m.content)) return "";
  return m.content
    .map((c: any) => (c.type === "text" ? c.text : c.type === "toolCall" ? `[tool: ${c.name}]` : ""))
    .filter(Boolean)
    .join("\n");
}

export function libraryTools(ctx: ToolContext): Tool[] {
  const librarySearch = tool({
    name: "library_search",
    label: "检索文献库",
    description:
      "Search the user's Zotero library for papers. mode 'titleCreatorYear' (default) matches title/author/year; 'fields' also matches abstract, tags etc.; 'everything' also matches indexed full text. Returns item keys usable with paper_* tools.",
    parameters: Type.Object({
      query: Type.String(),
      mode: Type.Optional(Type.Union([Type.Literal("titleCreatorYear"), Type.Literal("fields"), Type.Literal("everything")])),
      limit: Type.Optional(Type.Number({ description: "Default 15, max 50" })),
    }),
    async execute(_id, p) {
      const limit = Math.min(p.limit || 15, 50);
      const mode = p.mode || "titleCreatorYear";
      const s = new Zotero.Search();
      s.libraryID = ctx.paper.libraryID;
      s.addCondition("quicksearch-" + mode, "contains", p.query);
      s.addCondition("deleted", "false");
      const ids: number[] = await s.search();
      const seen = new Set<number>();
      const items: any[] = [];
      for (const it of Zotero.Items.get(ids)) {
        const top = topLevelItem(it);
        if (!top || top.isNote() || top.isAnnotation?.() || seen.has(top.id)) continue;
        seen.add(top.id);
        items.push(top);
        if (items.length >= limit) break;
      }
      if (!items.length) return ok(`No library items match "${p.query}".`, { count: 0 });
      const counts = await sessionCounts(ctx.paper.libraryID, items.map((i) => i.key));
      const lines = items.map((it) => {
        const year = (it.getField?.("date") || "").slice(0, 4);
        const hasPdf = it.isAttachment() ? it.isPDFAttachment() : it.getAttachments().length > 0;
        const venue = it.getField?.("publicationTitle") || it.getField?.("proceedingsTitle") || "";
        const n = counts.get(it.key);
        return `- item_key=${it.key} | ${paperTitle(it)} | ${creatorsString(it, 3)} | ${year}${venue ? ` | ${clip(venue, 60)}` : ""}${hasPdf ? " | has attachment" : ""}${n ? ` | ${n} AI sessions` : ""}${it.key === ctx.paper.itemKey ? " | (current paper)" : ""}`;
      });
      return ok(lines.join("\n"), { count: items.length });
    },
  });

  const listSessions = tool({
    name: "list_sessions",
    label: "查看历史会话",
    description:
      "List past AI chat sessions with their conclusions. With item_key: sessions about that paper. Otherwise: recent sessions about OTHER papers, optionally filtered by query (matches titles, conclusions and message text).",
    parameters: Type.Object({
      item_key: Type.Optional(Type.String()),
      query: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number({ description: "Default 15" })),
    }),
    async execute(_id, p) {
      let sessions: store.SessionMeta[];
      if (p.item_key) {
        const item = resolvePaperItem(ctx, p.item_key);
        sessions = await store.listSessionsForPaper(item.libraryID, item.key);
      } else {
        sessions = await store.searchSessions({ query: p.query, excludeItemKey: ctx.paper.itemKey, limit: p.limit || 15 });
      }
      sessions = sessions.filter((s) => s.id !== ctx.sessionId && s.messageCount > 0);
      if (!sessions.length) return ok("No matching sessions.", { count: 0 });
      const lines = sessions.map(
        (s) =>
          `- session_id=${s.id} | paper: ${clip(s.paperTitle, 80)} (item_key=${s.itemKey}) | "${s.title || "untitled"}" | ${new Date(s.updated).toISOString().slice(0, 10)} | ${s.messageCount} msgs` +
          (s.conclusion ? `\n  conclusion: ${clip(s.conclusion, 600)}` : ""),
      );
      return ok(lines.join("\n"), { count: sessions.length });
    },
  });

  const readSession = tool({
    name: "read_session",
    label: "阅读历史会话",
    description: "Read the user/assistant messages of a past session (from list_sessions). Output is truncated; use offset to continue.",
    parameters: Type.Object({ session_id: Type.String(), offset: Type.Optional(Type.Number()) }),
    async execute(_id, p) {
      const meta = await store.getSession(p.session_id);
      if (!meta) throw new Error(`会话 ${p.session_id} 不存在`);
      const msgs = await store.loadMessages(p.session_id);
      const body = msgs
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${messageText(m)}`)
        .filter((s) => s.trim().length > 12)
        .join("\n\n");
      const off = p.offset || 0;
      const chunk = body.slice(off, off + 8000);
      const next = off + 8000 < body.length ? `\n\n[Truncated; continue with offset=${off + 8000}]` : "";
      return ok(`Session "${meta.title}" about "${meta.paperTitle}"\nConclusion: ${meta.conclusion || "(none)"}\n\n${chunk}${next}`);
    },
  });

  const searchAnnotations = tool({
    name: "search_annotations",
    label: "搜索全库批注",
    description: "Search annotation text and comments across ALL papers in the library.",
    parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number({ description: "Default 30" })) }),
    async execute(_id, p) {
      const like = `%${p.query.replace(/[%_]/g, "")}%`;
      const ids: number[] = await Zotero.DB.columnQueryAsync(
        `SELECT IA.itemID FROM itemAnnotations IA JOIN items I USING (itemID)
         WHERE I.libraryID = ? AND (IA.text LIKE ? OR IA.comment LIKE ?) LIMIT ?`,
        [ctx.paper.libraryID, like, like, Math.min(p.limit || 30, 100)],
      );
      if (!ids?.length) return ok(`No annotations match "${p.query}".`, { count: 0 });
      const anns = await Zotero.Items.getAsync(ids);
      const lines = anns.map((a: any) => {
        const paper = topLevelItem(a);
        return (
          `- [${a.key}] ${clip(paperTitle(paper), 70)} (item_key=${paper?.key}) p.${a.annotationPageLabel || "?"} ${a.annotationType}` +
          (a.annotationText ? `\n  text: ${clip(a.annotationText, 300)}` : "") +
          (a.annotationComment ? `\n  comment: ${clip(a.annotationComment, 300)}` : "")
        );
      });
      return ok(lines.join("\n"), { count: anns.length });
    },
  });

  const saveConclusion = tool({
    name: "save_conclusion",
    label: "记录会话结论",
    description:
      "Record the key conclusions of THIS session (concise bullet points). Conclusions are visible to future sessions about other papers. Use when the user reaches an insight or asks to remember something.",
    parameters: Type.Object({ conclusion: Type.String() }),
    async execute(_id, p) {
      await store.updateSession(ctx.sessionId, { conclusion: p.conclusion.trim() });
      ctx.notify({ type: "session-updated" });
      return ok("Conclusion saved.");
    },
  });

  const createNote = tool({
    name: "create_zotero_note",
    label: "创建笔记",
    description:
      "Create a Zotero child note attached to a paper (default: current paper) from markdown (LaTeX math allowed). Use only when the user asks to save notes/summaries.",
    parameters: Type.Object({
      markdown: Type.String(),
      title: Type.Optional(Type.String()),
      item_key: Type.Optional(Type.String()),
    }),
    async execute(_id, p) {
      const parent = p.item_key ? resolvePaperItem(ctx, p.item_key) : getItem(ctx.paper);
      if (!parent || parent.isAttachment()) throw new Error("无法在该条目下创建子笔记");
      const html = (p.title ? `<h1>${noteMd.utils.escapeHtml(p.title)}</h1>\n` : "") + noteMd.render(p.markdown);
      const note = new Zotero.Item("note");
      note.libraryID = parent.libraryID;
      note.parentID = parent.id;
      note.setNote(`<div data-schema-version="9">${html}</div>`);
      await note.saveTx();
      ctx.notify({ type: "note-created", key: note.key });
      return ok(`Note created (key ${note.key}) under "${paperTitle(parent)}".`, { key: note.key });
    },
  });

  return [librarySearch, listSessions, readSession, searchAnnotations, saveConclusion, createNote];
}
