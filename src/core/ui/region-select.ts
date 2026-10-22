/**
 * "框图" mode: a crosshair overlay over the reader; the user drags a box and we
 * convert it to a PDF page index + user-space rect (no annotation is created).
 */
import { getPdfApp, waive } from "../reader-utils";
import { h } from "./dom";

export interface SelectedRegion {
  pageIndex: number;
  rect: number[];
  /** Box in main-window coordinates (for positioning the result card). */
  screen: { left: number; top: number; right: number; bottom: number };
}

let active: (() => void) | null = null;

export function cancelRegionSelect(): void {
  active?.();
}

export async function selectRegion(win: any, reader: any): Promise<SelectedRegion | null> {
  cancelRegionSelect();
  const app = await getPdfApp(reader);
  const readerFrame: Element | undefined = reader._iframe;
  if (!readerFrame) throw new Error("找不到阅读器窗口");
  const doc: Document = win.document;
  const rr = readerFrame.getBoundingClientRect();

  return new Promise((resolve) => {
    const overlay = h(doc, "div", {
      style: `position:fixed;left:${rr.left}px;top:${rr.top}px;width:${rr.width}px;height:${rr.height}px;z-index:2147483100;cursor:crosshair;background:rgba(20,20,40,.12);`,
    });
    const hint = h(doc, "div", {
      text: "拖动鼠标框选要提问的区域 · Esc 取消",
      style:
        "position:absolute;left:50%;top:12px;transform:translateX(-50%);background:#6d5bd0;color:#fff;padding:4px 12px;border-radius:14px;font:message-box;font-size:12.5px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.25);",
    });
    const box = h(doc, "div", {
      style: "position:absolute;border:2px solid #6d5bd0;background:rgba(109,91,208,.15);display:none;pointer-events:none;",
    });
    overlay.append(hint, box);
    doc.documentElement.appendChild(overlay);

    let start: { x: number; y: number } | null = null;
    const finish = (result: SelectedRegion | null) => {
      overlay.remove();
      win.removeEventListener("keydown", onKey, true);
      active = null;
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    };
    active = () => finish(null);
    win.addEventListener("keydown", onKey, true);

    overlay.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return finish(null);
      overlay.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      box.style.display = "block";
    });
    overlay.addEventListener("pointermove", (e: PointerEvent) => {
      if (!start) return;
      const l = Math.min(start.x, e.clientX) - rr.left;
      const t = Math.min(start.y, e.clientY) - rr.top;
      Object.assign(box.style, {
        left: `${l}px`,
        top: `${t}px`,
        width: `${Math.abs(e.clientX - start.x)}px`,
        height: `${Math.abs(e.clientY - start.y)}px`,
      });
    });
    overlay.addEventListener("pointerup", (e: PointerEvent) => {
      if (!start) return finish(null);
      const s = start;
      const x1 = Math.min(s.x, e.clientX);
      const y1 = Math.min(s.y, e.clientY);
      const x2 = Math.max(s.x, e.clientX);
      const y2 = Math.max(s.y, e.clientY);
      if (x2 - x1 < 8 || y2 - y1 < 8) return finish(null);
      try {
        finish(mapToPdf(reader, app, rr, { x1, y1, x2, y2 }));
      } catch (err) {
        Zotero.logError(err);
        finish(null);
      }
    });
  });
}

function mapToPdf(
  reader: any,
  app: any,
  rr: DOMRect,
  b: { x1: number; y1: number; x2: number; y2: number },
): SelectedRegion | null {
  const view = waive(waive(reader._internalReader)._primaryView);
  const inner: Element = view._iframe;
  const ir = inner.getBoundingClientRect(); // in reader-document coordinates
  const ox = rr.left + ir.left;
  const oy = rr.top + ir.top;
  // box in viewer-iframe coordinates
  const vx1 = b.x1 - ox;
  const vy1 = b.y1 - oy;
  const vx2 = b.x2 - ox;
  const vy2 = b.y2 - oy;
  const viewer = waive(app.pdfViewer);
  const n: number = viewer.pagesCount;
  let best: { idx: number; area: number; div: DOMRect } | null = null;
  for (let i = 0; i < n; i++) {
    const pv = waive(viewer.getPageView(i));
    const d = waive(pv.div).getBoundingClientRect();
    const w = Math.min(vx2, d.right) - Math.max(vx1, d.left);
    const hgt = Math.min(vy2, d.bottom) - Math.max(vy1, d.top);
    if (w > 0 && hgt > 0 && (!best || w * hgt > best.area)) best = { idx: i, area: w * hgt, div: d };
  }
  if (!best) return null;
  const pv = waive(viewer.getPageView(best.idx));
  const vp = waive(pv.viewport);
  const d = best.div;
  const clampX = (x: number) => Math.max(0, Math.min(d.width, x - d.left));
  const clampY = (y: number) => Math.max(0, Math.min(d.height, y - d.top));
  const p1 = Array.from(vp.convertToPdfPoint(clampX(vx1), clampY(vy1)) as number[]);
  const p2 = Array.from(vp.convertToPdfPoint(clampX(vx2), clampY(vy2)) as number[]);
  const rect = [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])].map(
    (v) => Math.round(v * 1000) / 1000,
  );
  return { pageIndex: best.idx, rect, screen: { left: b.x1, top: b.y1, right: b.x2, bottom: b.y2 } };
}
