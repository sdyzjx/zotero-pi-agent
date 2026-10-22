/**
 * Chat sessions: each session wraps a pi Agent bound to one paper, persists its
 * transcript to SQLite and exposes snapshots to the UI.
 */
import { Agent, type AgentEvent, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getSettings } from "./config";
import { Emitter, globalEvents } from "./events";
import { clampThinking, completeText, getModel, streamFn } from "./llm";
import { getItem, paperKey, paperTitle, type PaperRef } from "./paper";
import { buildSystemPrompt } from "./prompt";
import * as store from "./store";
import { buildTools } from "./tools";
import { modelSupportsImages, visionModelId } from "./vision";
import type { ImageContent } from "@earendil-works/pi-ai";

export interface SessionSnapshot {
  meta: store.SessionMeta;
  messages: any[];
  streaming: any | null;
  isStreaming: boolean;
  pendingTools: string[];
  /** Tools currently executing (for the live activity bar). */
  activeTools: ActiveTool[];
  /** When the current run started (ms), null when idle. */
  runStartedAt: number | null;
  /** Tool calls finished in the current run. */
  runToolCount: number;
  /** Number of streamed deltas received in the current run (diagnostics). */
  streamDeltas: number;
  modelId: string;
  thinkingLevel: string;
  version: number;
}

export interface ActiveTool {
  id: string;
  name: string;
  args: any;
  startedAt: number;
}

const DEFAULT_TITLE = "新会话";

function clone<T>(x: T): T {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

function userText(m: any): string {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  return (m.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
}

export class SessionRuntime {
  readonly changes = new Emitter<SessionSnapshot>();
  agent: Agent;
  meta: store.SessionMeta;
  private persisted: number;
  private committed: any[] = [];
  private version = 0;
  private emitTimer: any = null;
  private persistChain: Promise<void> = Promise.resolve();
  private conclusionTimer: any = null;
  private lastUser = "";
  private activeTools = new Map<string, ActiveTool>();
  private runStartedAt: number | null = null;
  private runToolCount = 0;
  private streamDeltas = 0;

  constructor(meta: store.SessionMeta, messages: any[]) {
    this.meta = meta;
    this.persisted = messages.length;
    const ref: PaperRef = { libraryID: meta.libraryID, itemKey: meta.itemKey };
    const settings = getSettings();
    const model = getModel(meta.model || settings.model);
    this.lastUser = userText([...messages].reverse().find((m) => m.role === "user"));
    this.agent = new Agent({
      initialState: {
        systemPrompt: buildSystemPrompt(ref),
        model,
        thinkingLevel: clampThinking(model, settings.thinkingLevel) as ThinkingLevel,
        tools: buildTools({
          paper: ref,
          sessionId: meta.id,
          lastUserText: () => this.lastUser,
          currentModel: () => this.agent.state.model,
          notify: (ev) => {
            globalEvents.emit({ ...ev, sessionId: meta.id, libraryID: meta.libraryID, itemKey: meta.itemKey });
            if (ev.type === "session-updated") void this.reloadMeta();
          },
        }),
        messages,
      },
      streamFn,
      sessionId: meta.id,
      toolExecution: "parallel",
    });
    this.committed = clone(this.visibleMessages());
    this.agent.subscribe((e) => this.onEvent(e));
  }

  /** Transcript without system messages (those are rebuilt on load). */
  private visibleMessages(): any[] {
    return this.agent.state.messages.filter((m: any) => m.role !== "system");
  }

  private onEvent(e: AgentEvent): void {
    switch (e.type) {
      case "agent_start":
        this.runStartedAt = Date.now();
        this.runToolCount = 0;
        this.streamDeltas = 0;
        break;
      case "message_update":
        this.streamDeltas++;
        break;
      case "tool_execution_start":
        this.activeTools.set(e.toolCallId, { id: e.toolCallId, name: e.toolName, args: clone(e.args), startedAt: Date.now() });
        break;
      case "tool_execution_end":
        this.activeTools.delete(e.toolCallId);
        this.runToolCount++;
        break;
    }
    if (e.type === "agent_end") {
      this.activeTools.clear();
      this.runStartedAt = null;
    }
    switch (e.type) {
      case "message_end":
      case "turn_end":
      case "agent_end":
        this.commit();
        this.persist();
        if (e.type === "agent_end") this.scheduleConclusion();
        break;
    }
    this.scheduleEmit();
  }

  private commit(): void {
    this.committed = clone(this.visibleMessages());
    this.version++;
  }

  private persist(): void {
    const all = this.visibleMessages();
    const from = Math.min(this.persisted, all.length);
    const snapshot = clone(all);
    this.persistChain = this.persistChain
      .then(async () => {
        await store.saveMessages(this.meta.id, snapshot, from);
        this.persisted = snapshot.length;
        this.meta.messageCount = snapshot.length;
        this.meta.updated = Date.now();
      })
      .catch((err) => Zotero.logError(err));
  }

  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.changes.emit(this.snapshot());
    }, 40);
  }

  snapshot(): SessionSnapshot {
    const st = this.agent.state;
    return {
      meta: { ...this.meta },
      messages: this.committed,
      streaming: st.isStreaming && st.streamingMessage ? clone(st.streamingMessage) : null,
      isStreaming: st.isStreaming,
      pendingTools: [...st.pendingToolCalls],
      activeTools: [...this.activeTools.values()],
      runStartedAt: this.runStartedAt,
      runToolCount: this.runToolCount,
      streamDeltas: this.streamDeltas,
      modelId: st.model.id,
      thinkingLevel: st.thinkingLevel,
      version: this.version,
    };
  }

  get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  /** Send a user message (optionally with images). Returns its index in the visible transcript. */
  async send(text: string, images: ImageContent[] = []): Promise<number> {
    const content = text.trim();
    if (!content && !images.length) return -1;
    getSettings(); // validate prefs early
    if (images.length && !modelSupportsImages(this.agent.state.model)) {
      // e.g. DeepSeek V4 Pro is text-only: switch this session to a vision model.
      const vision = visionModelId(getSettings().quickModel);
      if (!vision) throw new Error("当前没有支持图片的模型（需要 DeepSeek V4.1 Flash）");
      this.setModel(vision);
      globalEvents.emit({ type: "model-switched", sessionId: this.meta.id, libraryID: this.meta.libraryID, itemKey: this.meta.itemKey, model: vision });
    }
    if (this.isStreaming) {
      this.agent.followUp({ role: "user", content: images.length ? [{ type: "text", text: content }, ...images] : content, timestamp: Date.now() });
      return this.committed.length;
    }
    const index = this.visibleMessages().length;
    this.lastUser = content;
    if (!this.meta.title || this.meta.title === DEFAULT_TITLE) {
      this.meta.title = content.replace(/\s+/g, " ").replace(/^>.*?(?=\S)/, "").slice(0, 30);
      void store.updateSession(this.meta.id, { title: this.meta.title });
      globalEvents.emit({ type: "sessions-changed", libraryID: this.meta.libraryID, itemKey: this.meta.itemKey });
    }
    const run = images.length ? this.agent.prompt(content || "请看这张图。", images) : this.agent.prompt(content);
    this.scheduleEmit();
    run.catch((err) => {
      Zotero.logError(err);
      this.scheduleEmit();
    });
    return index;
  }

  abort(): void {
    this.agent.abort();
  }

  /** Retry after an error / abort: drop the failed assistant message and continue. */
  async retry(): Promise<void> {
    if (this.isStreaming) return;
    const msgs = this.agent.state.messages;
    const last = msgs[msgs.length - 1] as any;
    if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
      this.agent.state.messages = msgs.slice(0, -1);
      this.persisted = Math.min(this.persisted, this.visibleMessages().length);
    }
    this.commit();
    this.scheduleEmit();
    await this.agent.continue().catch((err) => Zotero.logError(err));
  }

  setModel(modelId: string, thinkingLevel?: string): void {
    const model = getModel(modelId);
    this.agent.state.model = model;
    if (thinkingLevel) this.agent.state.thinkingLevel = clampThinking(model, thinkingLevel) as ThinkingLevel;
    else this.agent.state.thinkingLevel = clampThinking(model, this.agent.state.thinkingLevel) as ThinkingLevel;
    this.meta.model = modelId;
    void store.updateSession(this.meta.id, { model: modelId });
    this.scheduleEmit();
  }

  setThinking(level: string): void {
    this.agent.state.thinkingLevel = clampThinking(this.agent.state.model, level) as ThinkingLevel;
    this.scheduleEmit();
  }

  async reloadMeta(): Promise<void> {
    const m = await store.getSession(this.meta.id);
    if (m) this.meta = m;
    this.scheduleEmit();
  }

  private scheduleConclusion(): void {
    if (!getSettings().autoConclusion) return;
    clearTimeout(this.conclusionTimer);
    this.conclusionTimer = setTimeout(() => void this.generateConclusion(), 2500);
  }

  private async generateConclusion(): Promise<void> {
    if (this.isStreaming) return;
    const msgs = this.visibleMessages().filter((m: any) => m.role === "user" || m.role === "assistant");
    const transcript = msgs
      .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${userText(m)}`)
      .filter((s) => s.length > 12)
      .join("\n\n");
    if (transcript.length < 40) return;
    try {
      const out = await completeText({
        systemPrompt:
          'You summarize a conversation between a user and an AI reading assistant about an academic paper. Return ONLY JSON: {"title": "<short session title, ≤ 20 chars, in the conversation\'s language>", "conclusion": "<2-6 concise bullet points (\\n- ...) capturing the questions asked and the answers/insights reached; include concrete facts, numbers and page refs>"}. If an existing conclusion is given, update/merge it.',
        messages: [
          {
            role: "user",
            content: `Paper: ${this.meta.paperTitle}\nExisting conclusion: ${this.meta.conclusion || "(none)"}\n\nConversation:\n${transcript.slice(-14000)}`,
            timestamp: Date.now(),
          },
        ],
      });
      const json = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
      const patch: any = {};
      if (typeof json.conclusion === "string" && json.conclusion.trim()) patch.conclusion = json.conclusion.trim();
      const locked = await store.kvGet(`titleLocked:${this.meta.id}`);
      if (!locked && typeof json.title === "string" && json.title.trim()) patch.title = json.title.trim().slice(0, 40);
      if (patch.title) await store.kvSet(`titleLocked:${this.meta.id}`, "auto"); // title once, then keep it stable
      if (Object.keys(patch).length) {
        await store.updateSession(this.meta.id, patch);
        Object.assign(this.meta, patch);
        this.scheduleEmit();
        globalEvents.emit({ type: "sessions-changed", libraryID: this.meta.libraryID, itemKey: this.meta.itemKey });
      }
    } catch (e) {
      Zotero.debug(`[ZoteroPi] conclusion generation failed: ${e}`);
    }
  }

  dispose(): void {
    clearTimeout(this.conclusionTimer);
    clearTimeout(this.emitTimer);
    this.agent.abort();
    this.changes.clear();
  }
}

export class SessionManager {
  private runtimes = new Map<string, SessionRuntime>();

  async list(ref: PaperRef): Promise<store.SessionMeta[]> {
    return store.listSessionsForPaper(ref.libraryID, ref.itemKey);
  }

  async create(ref: PaperRef): Promise<store.SessionMeta> {
    const item = getItem(ref);
    const meta = await store.createSession({
      id: store.newSessionID(),
      libraryID: ref.libraryID,
      itemKey: ref.itemKey,
      paperTitle: item ? paperTitle(item) : "",
      title: DEFAULT_TITLE,
      conclusion: "",
      model: getSettings().model,
    });
    await this.setActive(ref, meta.id);
    globalEvents.emit({ type: "sessions-changed", libraryID: ref.libraryID, itemKey: ref.itemKey });
    return meta;
  }

  /** Active session for a paper: last used, else most recent, else a new one. */
  async activeSessionId(ref: PaperRef, createIfMissing = true): Promise<string | null> {
    const saved = await store.kvGet(`active:${paperKey(ref)}`);
    if (saved && (await store.getSession(saved))) return saved;
    const list = await this.list(ref);
    if (list.length) return list[0].id;
    return createIfMissing ? (await this.create(ref)).id : null;
  }

  async setActive(ref: PaperRef, id: string): Promise<void> {
    await store.kvSet(`active:${paperKey(ref)}`, id);
  }

  async open(id: string): Promise<SessionRuntime> {
    let rt = this.runtimes.get(id);
    if (rt) return rt;
    const meta = await store.getSession(id);
    if (!meta) throw new Error(`Session ${id} not found`);
    const messages = await store.loadMessages(id);
    rt = this.runtimes.get(id); // re-check after awaits
    if (rt) return rt;
    rt = new SessionRuntime(meta, messages);
    this.runtimes.set(id, rt);
    return rt;
  }

  async rename(id: string, title: string): Promise<void> {
    await store.updateSession(id, { title });
    await store.kvSet(`titleLocked:${id}`, "1");
    const rt = this.runtimes.get(id);
    if (rt) await rt.reloadMeta();
    const meta = await store.getSession(id);
    if (meta) globalEvents.emit({ type: "sessions-changed", libraryID: meta.libraryID, itemKey: meta.itemKey });
  }

  async remove(id: string): Promise<void> {
    const meta = await store.getSession(id);
    this.runtimes.get(id)?.dispose();
    this.runtimes.delete(id);
    await store.deleteSession(id);
    if (meta) globalEvents.emit({ type: "sessions-changed", libraryID: meta.libraryID, itemKey: meta.itemKey });
  }

  /** Rebuild system prompts / tools after settings change (idle sessions only). */
  refreshAll(): void {
    for (const [id, rt] of this.runtimes) {
      if (!rt.isStreaming && rt.changes.size === 0) {
        rt.dispose();
        this.runtimes.delete(id);
      }
    }
  }

  dispose(): void {
    for (const rt of this.runtimes.values()) rt.dispose();
    this.runtimes.clear();
  }
}
