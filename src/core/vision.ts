/**
 * Render PDF pages / regions to images via the reader's pdf.js (same approach
 * Zotero uses for image annotations), and helpers for vision-capable models.
 */
import type { ImageContent } from "@earendil-works/pi-ai";
import { completeText, getModel, listModels } from "./llm";
import { getPdfApp, getPageLabel, waive } from "./reader-utils";

export interface RenderedRegion {
  data: string; // base64 (no data: prefix)
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
  pageIndex: number;
  pageLabel: string;
  /** PDF user-space rect [x1, y1, x2, y2] */
  rect: number[];
  /** Page box [x1, y1, x2, y2] */
  pageView: number[];
}

function viewerWindow(reader: any): any {
  return waive(waive(waive(reader._internalReader)._primaryView)._iframeWindow);
}

function norm(r: number[]): number[] {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

/** Convert a top-left-origin fractional region {x,y,w,h} (0–1) to a PDF rect. */
export function fractionToRect(view: number[], f: { x: number; y: number; w: number; h: number }): number[] {
  const W = view[2] - view[0];
  const H = view[3] - view[1];
  const clamp01 = (v: number) => Math.max(0, Math.min(1, Number(v) || 0));
  const x = clamp01(f.x);
  const y = clamp01(f.y);
  const w = Math.max(0.02, Math.min(1 - x, clamp01(f.w) || 1));
  const h = Math.max(0.02, Math.min(1 - y, clamp01(f.h) || 1));
  const x1 = view[0] + x * W;
  const y2 = view[3] - y * H;
  return [x1, y2 - h * H, x1 + w * W, y2];
}

export async function getPageView(reader: any, pageIndex: number): Promise<number[]> {
  const app = await getPdfApp(reader);
  const page = waive(await waive(app.pdfDocument).getPage(pageIndex + 1));
  return Array.from(page.view as number[]);
}

/** Render a page (or a rect of it) to PNG/JPEG. Longest side ≤ maxSide px. */
export async function renderRegion(reader: any, pageIndex: number, rect?: number[] | null, maxSide = 1600): Promise<RenderedRegion> {
  const Cu = Components.utils;
  const app = await getPdfApp(reader);
  const win = viewerWindow(reader);
  const doc = waive(app.pdfDocument);
  if (pageIndex < 0 || pageIndex >= doc.numPages) throw new Error(`页码超出范围（共 ${doc.numPages} 页）`);
  const page = waive(await doc.getPage(pageIndex + 1));
  const view = Array.from(page.view as number[]);
  let r = rect ? norm(rect) : view;
  r = [Math.max(r[0], view[0]), Math.max(r[1], view[1]), Math.min(r[2], view[2]), Math.min(r[3], view[3])];
  const wPt = r[2] - r[0];
  const hPt = r[3] - r[1];
  if (wPt < 2 || hPt < 2) throw new Error("区域太小");
  const scale = Math.max(1, Math.min(4, maxSide / Math.max(wPt, hPt)));

  const full = waive(page.getViewport(Cu.cloneInto({ scale }, win)));
  const vr = Array.from(full.convertToViewportRectangle(Cu.cloneInto(r, win)) as number[]);
  const [vx1, vy1, vx2, vy2] = norm(vr);
  const viewport = waive(page.getViewport(Cu.cloneInto({ scale, offsetX: -vx1, offsetY: -vy1 }, win)));
  const width = Math.max(1, Math.round(vx2 - vx1));
  const height = Math.max(1, Math.round(vy2 - vy1));
  const canvas = waive(win.document.createElement("canvas"));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", Cu.cloneInto({ alpha: false }, win));
  ctx.skipBlender = true; // Zotero's pdf.js would otherwise apply the reader's (dark) theme
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const renderContext = waive(Cu.cloneInto({}, win));
  renderContext.canvasContext = ctx;
  renderContext.viewport = viewport;
  await waive(page.render(renderContext)).promise;

  const mimeType = width * height > 1_200_000 ? "image/jpeg" : "image/png";
  const dataUrl: string = canvas.toDataURL(mimeType, 0.9);
  return {
    data: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mimeType,
    dataUrl,
    width,
    height,
    pageIndex,
    pageLabel: await getPageLabel(reader, pageIndex),
    rect: r.map((v) => Math.round(v * 1000) / 1000),
    pageView: view,
  };
}

export function toImageContent(img: { data: string; mimeType: string }): ImageContent {
  return { type: "image", data: img.data, mimeType: img.mimeType };
}

export function modelSupportsImages(model: any): boolean {
  return Array.isArray(model?.input) && model.input.includes("image");
}

/** A configured model that accepts image input (prefers the quick model). */
export function visionModelId(preferred?: string): string | null {
  const candidates = [preferred, "deepseek-flash", ...listModels().map((m) => m.id)].filter(Boolean) as string[];
  for (const id of candidates) {
    if (modelSupportsImages(getModel(id))) return id;
  }
  return null;
}

/** Ask a vision model about an image and return its text answer (for text-only sessions). */
export async function describeImage(img: { data: string; mimeType: string }, question: string, signal?: AbortSignal): Promise<string> {
  const id = visionModelId();
  if (!id) throw new Error("没有可用的视觉模型（需要 DeepSeek V4.1 Flash）");
  return completeText(
    {
      systemPrompt:
        "You are a precise vision assistant for reading academic papers. Describe exactly what is visible (figures, axes, legends, trends, table cells, equations as LaTeX, text). Do not invent details that are not visible.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: question || "Describe this image from a paper in detail." }, toImageContent(img)],
          timestamp: Date.now(),
        },
      ],
    },
    { model: id, signal },
  );
}
