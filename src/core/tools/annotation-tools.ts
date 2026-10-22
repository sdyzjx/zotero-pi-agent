import { Type } from "@earendil-works/pi-ai";
import { createHighlight, createNoteAnnotation, updateAnnotationComment } from "../annotate";
import { getMainAttachment } from "../paper";
import { ensureReader, navigateToPage, selectReaderTab } from "../reader-utils";
import { ok, tool, type Tool, type ToolContext } from "./common";
import { resolvePaperItem } from "./paper-tools";

const colorParam = Type.Optional(
  Type.String({ description: "yellow | red | green | blue | purple | magenta | orange | gray, or #rrggbb. Default: AI color." }),
);

export function annotationTools(ctx: ToolContext): Tool[] {
  const highlight = tool({
    name: "create_highlight",
    label: "创建高亮",
    description:
      "Highlight (or underline) a passage in the paper's PDF and optionally attach a comment. `quote` must be copied VERBATIM from paper_read/paper_search output and lie within one page (one to a few sentences). Give the 1-based page if known.",
    parameters: Type.Object({
      quote: Type.String({ description: "Exact text from the paper" }),
      page: Type.Optional(Type.Number({ description: "1-based page number where the quote is" })),
      comment: Type.Optional(Type.String({ description: "Comment attached to the highlight (markdown ok)" })),
      color: colorParam,
      style: Type.Optional(Type.Union([Type.Literal("highlight"), Type.Literal("underline")])),
      item_key: Type.Optional(Type.String({ description: "Other paper's item key; omit for current paper" })),
    }),
    executionMode: "sequential",
    async execute(_id, p) {
      const item = resolvePaperItem(ctx, p.item_key);
      const r = await createHighlight(item, { quote: p.quote, page: p.page, comment: p.comment, color: p.color, type: p.style });
      ctx.notify({ type: "annotation-created", key: r.key, attachmentID: r.attachmentID, page: r.pageLabel });
      return ok(`Created ${p.style || "highlight"} [${r.key}] on page ${r.pageLabel}: "${r.text.slice(0, 120)}"`, {
        key: r.key,
        page: r.pageLabel,
      });
    },
  });

  const note = tool({
    name: "create_note_annotation",
    label: "创建便签批注",
    description:
      "Place a sticky-note annotation in the PDF with a comment. Positioned next to `near_text` (verbatim text from the paper) if given, otherwise at the top-left of `page`.",
    parameters: Type.Object({
      comment: Type.String(),
      page: Type.Optional(Type.Number({ description: "1-based page" })),
      near_text: Type.Optional(Type.String({ description: "Verbatim text to place the note next to" })),
      color: colorParam,
      item_key: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    async execute(_id, p) {
      const item = resolvePaperItem(ctx, p.item_key);
      const r = await createNoteAnnotation(item, { comment: p.comment, page: p.page, nearText: p.near_text, color: p.color });
      ctx.notify({ type: "annotation-created", key: r.key, attachmentID: r.attachmentID, page: r.pageLabel });
      return ok(`Created note annotation [${r.key}] on page ${r.pageLabel}.`, { key: r.key, page: r.pageLabel });
    },
  });

  const updateComment = tool({
    name: "update_annotation_comment",
    label: "修改批注评论",
    description: "Replace or append to the comment of an existing annotation (key from get_annotations).",
    parameters: Type.Object({
      annotation_key: Type.String(),
      comment: Type.String(),
      mode: Type.Optional(Type.Union([Type.Literal("replace"), Type.Literal("append")])),
    }),
    async execute(_id, p) {
      await updateAnnotationComment(ctx.paper.libraryID, p.annotation_key, p.comment, p.mode || "append");
      return ok(`Updated comment of annotation ${p.annotation_key}.`);
    },
  });

  const goToPage = tool({
    name: "go_to_page",
    label: "跳转页面",
    description: "Scroll the PDF reader of the current paper to a page so the user can see it.",
    parameters: Type.Object({ page: Type.Number({ description: "1-based page" }) }),
    async execute(_id, p) {
      const att = await getMainAttachment(resolvePaperItem(ctx));
      if (!att) throw new Error("没有可打开的附件");
      const reader = await ensureReader(att.id);
      selectReaderTab(reader);
      await navigateToPage(reader, Math.max(0, p.page - 1));
      return ok(`Reader moved to page ${p.page}.`);
    },
  });

  return [highlight, note, updateComment, goToPage];
}
