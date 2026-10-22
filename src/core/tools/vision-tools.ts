import { Type } from "@earendil-works/pi-ai";
import { getMainAttachment } from "../paper";
import { ensureReader } from "../reader-utils";
import { describeImage, fractionToRect, getPageView, modelSupportsImages, renderRegion, toImageContent } from "../vision";
import { ok, tool, type Tool, type ToolContext } from "./common";
import { resolvePaperItem } from "./paper-tools";

export function visionTools(ctx: ToolContext): Tool[] {
  const view = tool({
    name: "view_page_image",
    label: "查看页面图像",
    description:
      "Look at a rendered image of a PDF page or part of it — use it for figures, tables, equations, diagrams or layout that plain text cannot convey. Find the page first (e.g. paper_search 'Figure 3'). Optionally crop with `region` (fractions of the page, origin top-left), or view an image annotation by `annotation_key` (from get_annotations, type image). `question` says what to look for.",
    parameters: Type.Object({
      page: Type.Optional(Type.Number({ description: "1-based page number (not needed with annotation_key)" })),
      region: Type.Optional(
        Type.Object(
          {
            x: Type.Number({ description: "left, 0–1" }),
            y: Type.Number({ description: "top, 0–1" }),
            w: Type.Number({ description: "width, 0–1" }),
            h: Type.Number({ description: "height, 0–1" }),
          },
          { description: "Crop box as fractions of the page, e.g. top half = {x:0,y:0,w:1,h:0.5}" },
        ),
      ),
      annotation_key: Type.Optional(Type.String({ description: "Key of an image/area annotation to view" })),
      question: Type.Optional(Type.String({ description: "What you want to find out from the image" })),
      item_key: Type.Optional(Type.String({ description: "Other paper's item key; omit for current paper" })),
    }),
    executionMode: "sequential",
    async execute(_id, p, signal) {
      let pageIndex: number;
      let rect: number[] | null = null;
      let attachment: any;
      if (p.annotation_key) {
        const ann = Zotero.Items.getByLibraryAndKey(ctx.paper.libraryID, p.annotation_key);
        if (!ann?.isAnnotation?.()) throw new Error(`找不到批注 ${p.annotation_key}`);
        attachment = ann.parentItem;
        const pos = JSON.parse(ann.annotationPosition);
        pageIndex = pos.pageIndex;
        rect = pos.rects?.[0] || null;
      } else {
        attachment = await getMainAttachment(resolvePaperItem(ctx, p.item_key));
        if (typeof p.page !== "number") throw new Error("需要提供 page（1 起始）或 annotation_key");
        pageIndex = p.page - 1;
      }
      if (!attachment?.isPDFAttachment?.()) throw new Error("只能查看 PDF 附件的页面图像");
      const reader = await ensureReader(attachment.id);
      if (!rect && p.region) rect = fractionToRect(await getPageView(reader, pageIndex), p.region);
      const img = await renderRegion(reader, pageIndex, rect, 1600);
      const what = `${p.annotation_key ? `annotation ${p.annotation_key}, ` : ""}page ${img.pageLabel}${rect && !p.annotation_key ? " (cropped)" : ""}, ${img.width}×${img.height}px`;
      if (modelSupportsImages(ctx.currentModel())) {
        return {
          content: [{ type: "text", text: `Rendered image of ${what}:` }, toImageContent(img)],
          details: { page: img.pageLabel, width: img.width, height: img.height },
        };
      }
      // Text-only model: let a vision model look and report back.
      const description = await describeImage(img, p.question || "Describe this region of the paper in detail.", signal);
      return ok(`[Your model cannot see images; a vision model looked at ${what} and reports:]\n\n${description}`, {
        page: img.pageLabel,
        described: true,
      });
    },
  });
  return [view];
}
