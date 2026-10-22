/**
 * Selection quick actions from the reader popup: translate (fast, tool-less
 * stream) or agent actions (explain / summarize / ask) that run inside the
 * paper's active session so the chat panel keeps the full history.
 */
import { getSettings, type QuickAction } from "./config";
import { Emitter } from "./events";
import { getModel, streamSimple } from "./llm";
import { getItem, paperTitle, refFromItem, type PaperRef } from "./paper";
import type { SessionManager } from "./sessions";
import { resolveColor, saveSelectionAsHighlight } from "./annotate";
import type { RenderedRegion } from "./vision";
import { toImageContent } from "./vision";

export const IMAGE_ACTIONS = [
  {
    id: "explain",
    label: "解释这张图",
    prompt:
      "请结合论文上下文解释这张截图（第 {page} 页）：它展示了什么，关键信息、趋势或结论是什么，在论文论证中起什么作用。必要时查阅论文相关段落。",
  },
  {
    id: "transcribe",
    label: "转写内容",
    prompt: "请准确转写这张截图中的内容：公式用 LaTeX（$$...$$），表格用 Markdown 表格，文字原样输出；最后用一两句话说明它的含义。",
  },
];

export interface Selection {
  text: string;
  position: any;
  sortIndex?: string;
  pageLabel?: string;
}

export interface QuickJob {
  id: number;
  kind: "translate" | "agent" | "ask" | "image";
  label: string;
  selection: Selection;
  attachmentID: number;
  paper: PaperRef;
  status: "input" | "running" | "done" | "error";
  output: string;
  error?: string;
  sessionId?: string;
  startIndex?: number;
  savedAnnotationKey?: string;
  /** Rendered region for image jobs. */
  image?: RenderedRegion;
  /** Existing image annotation this job was started from. */
  annotationKey?: string;
}

export function quotePrompt(sel: Selection, instruction: string): string {
  const quote = sel.text.replace(/\s+/g, " ").trim();
  const page = sel.pageLabel ? `（第 ${sel.pageLabel} 页）` : "";
  if (instruction.includes("{text}")) return instruction.replace("{text}", `> ${quote}\n${page}`);
  return `> ${quote}\n${page}\n\n${instruction}`;
}

export class QuickService {
  readonly changes = new Emitter<QuickJob | null>();
  job: QuickJob | null = null;
  private seq = 0;
  private abortCtrl: AbortController | null = null;

  constructor(private sessions: SessionManager) {}

  private set(job: QuickJob | null) {
    this.job = job;
    this.changes.emit(job ? { ...job } : null);
  }

  private patch(p: Partial<QuickJob>) {
    if (!this.job) return;
    Object.assign(this.job, p);
    this.changes.emit({ ...this.job });
  }

  async start(action: QuickAction | { id: "ask"; label: string; mode: "ask"; prompt: "" }, attachmentID: number, selection: Selection): Promise<QuickJob | null> {
    this.cancel();
    const att = Zotero.Items.get(attachmentID);
    const paper = att && refFromItem(att);
    if (!paper) return null;
    const kind = action.mode === "translate" ? "translate" : action.mode === "ask" ? "ask" : "agent";
    const job: QuickJob = {
      id: ++this.seq,
      kind,
      label: action.label,
      selection,
      attachmentID,
      paper,
      status: kind === "ask" ? "input" : "running",
      output: "",
    };
    this.set(job);
    if (kind === "translate") void this.translate(job);
    else if (kind === "agent") await this.runAgent(job, quotePrompt(selection, action.prompt));
    return job;
  }

  /** 框图 / image annotation: show the image with action choices. */
  startImage(attachmentID: number, image: RenderedRegion, annotationKey?: string): QuickJob | null {
    this.cancel();
    const att = Zotero.Items.get(attachmentID);
    const paper = att && refFromItem(att);
    if (!paper) return null;
    const job: QuickJob = {
      id: ++this.seq,
      kind: "image",
      label: "框图提问",
      selection: { text: "", position: { pageIndex: image.pageIndex, rects: [image.rect] }, pageLabel: image.pageLabel },
      attachmentID,
      paper,
      status: "input",
      output: "",
      image,
      annotationKey,
    };
    this.set(job);
    return job;
  }

  /** Run an image action (or free question) on the current image job. */
  async runImage(prompt: string): Promise<void> {
    const job = this.job;
    if (!job?.image) return;
    if (job.sessionId) {
      const rt = await this.sessions.open(job.sessionId);
      await rt.send(prompt);
      return;
    }
    this.patch({ status: "running" });
    try {
      const sessionId = await this.sessions.activeSessionId(job.paper);
      const rt = await this.sessions.open(sessionId!);
      const text = prompt.replace("{page}", job.image.pageLabel);
      const label = job.annotationKey ? `（图片批注 ${job.annotationKey}，第 ${job.image.pageLabel} 页）` : `（框选自第 ${job.image.pageLabel} 页）`;
      const startIndex = await rt.send(`${text}\n\n${label}`, [toImageContent(job.image)]);
      if (this.job?.id === job.id) this.patch({ sessionId: sessionId!, startIndex });
    } catch (e: any) {
      if (this.job?.id === job.id) this.patch({ status: "error", error: String(e?.message || e) });
    }
  }

  /** For "ask": the user typed a question about the selection. */
  async submitAsk(question: string): Promise<void> {
    const job = this.job;
    if (!job || !question.trim()) return;
    if (job.kind === "translate") return;
    if (job.kind === "image") return this.runImage(question.trim());
    if (job.sessionId) {
      const rt = await this.sessions.open(job.sessionId);
      await rt.send(question);
      return;
    }
    job.status = "running";
    await this.runAgent(job, quotePrompt(job.selection, question.trim()));
  }

  private async runAgent(job: QuickJob, prompt: string): Promise<void> {
    try {
      const sessionId = await this.sessions.activeSessionId(job.paper);
      const rt = await this.sessions.open(sessionId!);
      const startIndex = await rt.send(prompt);
      if (this.job?.id === job.id) this.patch({ sessionId: sessionId!, startIndex, status: "running" });
    } catch (e: any) {
      if (this.job?.id === job.id) this.patch({ status: "error", error: String(e?.message || e) });
    }
  }

  private async translate(job: QuickJob): Promise<void> {
    const s = getSettings();
    const ctrl = new AbortController();
    this.abortCtrl = ctrl;
    const item = getItem(job.paper);
    try {
      const model = getModel(s.quickModel);
      const stream = streamSimple(
        model,
        {
          systemPrompt: `You are a professional academic translator. Translate the user's text, an excerpt from the paper "${item ? paperTitle(item) : ""}", into ${s.targetLanguage}. If it is already in ${s.targetLanguage}, translate it into English instead. Fix PDF line-break hyphenation, keep math in LaTeX ($...$), keep citations like [12] unchanged, and for key technical terms add the original term in parentheses on first use. Output only the translation.`,
          messages: [{ role: "user", content: job.selection.text, timestamp: Date.now() }],
        },
        { signal: ctrl.signal },
      );
      for await (const ev of stream as any) {
        if (this.job?.id !== job.id) return;
        if (ev.type === "text_delta") this.patch({ output: this.job.output + ev.delta });
        else if (ev.type === "error") throw new Error(ev.error?.errorMessage || "翻译失败");
      }
      if (this.job?.id === job.id) this.patch({ status: "done" });
    } catch (e: any) {
      if (this.job?.id === job.id && !ctrl.signal.aborted) this.patch({ status: "error", error: String(e?.message || e) });
    } finally {
      if (this.abortCtrl === ctrl) this.abortCtrl = null;
    }
  }

  /** Save the selection as a highlight with the given comment (e.g. the translation). */
  async saveAsAnnotation(comment: string): Promise<string | null> {
    const job = this.job;
    if (!job) return null;
    const att = Zotero.Items.get(job.attachmentID);
    if (job.kind === "image" && job.image) {
      if (job.annotationKey) {
        const ann = Zotero.Items.getByLibraryAndKey(att.libraryID, job.annotationKey);
        if (ann) {
          ann.annotationComment = ann.annotationComment ? `${ann.annotationComment}\n\n${comment}` : comment;
          await ann.saveTx();
          this.patch({ savedAnnotationKey: job.annotationKey });
          return job.annotationKey;
        }
      }
      const key = await saveImageAnnotation(att, job.image, comment);
      this.patch({ savedAnnotationKey: key, annotationKey: key });
      return key;
    }
    const key = await saveSelectionAsHighlight(att, job.selection, comment);
    this.patch({ savedAnnotationKey: key });
    return key;
  }

  cancel(): void {
    this.abortCtrl?.abort();
    this.abortCtrl = null;
    if (this.job) this.set(null);
  }
}

/** Create an image (area) annotation for a rendered region; Zotero renders its preview itself. */
export async function saveImageAnnotation(attachment: any, img: RenderedRegion, comment: string): Promise<string> {
  const settings = getSettings();
  const top = Math.max(0, Math.floor(img.pageView[3] - img.rect[3]));
  const json = {
    key: Zotero.DataObjectUtilities.generateKey(),
    type: "image",
    comment,
    color: resolveColor(),
    pageLabel: img.pageLabel,
    sortIndex: [String(img.pageIndex).padStart(5, "0"), "000000", String(top).slice(0, 5).padStart(5, "0")].join("|"),
    position: { pageIndex: img.pageIndex, rects: [img.rect] },
    tags: settings.annotationTag.trim() ? [{ name: settings.annotationTag.trim() }] : [],
  };
  await Zotero.Annotations.saveFromJSON(attachment, json);
  return json.key;
}
