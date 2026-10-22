import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Markdown } from "./markdown";

export const TOOL_LABELS: Record<string, string> = {
  paper_overview: "论文概览",
  paper_search: "论文内搜索",
  paper_read: "阅读论文",
  view_page_image: "查看页面图像",
  get_annotations: "查看批注",
  create_highlight: "创建高亮",
  create_note_annotation: "创建便签",
  update_annotation_comment: "修改批注",
  go_to_page: "跳转页面",
  library_search: "检索文献库",
  list_sessions: "历史会话",
  read_session: "阅读会话",
  search_annotations: "搜索批注",
  save_conclusion: "记录结论",
  create_zotero_note: "创建笔记",
  web_search: "网络搜索",
  web_fetch: "读取网页",
  arxiv_search: "arXiv 检索",
  arxiv_read: "阅读 arXiv",
  scholar_search: "Google Scholar",
};

const TOOL_ICONS: Record<string, string> = {
  paper_overview: "📄",
  paper_search: "🔎",
  paper_read: "📖",
  view_page_image: "🖼",
  get_annotations: "🖍",
  create_highlight: "🖍",
  create_note_annotation: "🗒",
  update_annotation_comment: "✏️",
  go_to_page: "↪",
  library_search: "📚",
  list_sessions: "💬",
  read_session: "💬",
  search_annotations: "🖍",
  save_conclusion: "📌",
  create_zotero_note: "📝",
  web_search: "🌐",
  web_fetch: "🌐",
  arxiv_search: "🧪",
  arxiv_read: "🧪",
  scholar_search: "🎓",
};

function argSummary(name: string, args: any): string {
  if (!args) return "";
  const v =
    args.query ?? args.quote ?? args.section ?? (args.pages ? `p.${args.pages}` : undefined) ?? args.url ?? args.id ?? args.comment ?? args.session_id ?? args.item_key ?? (args.page ? `p.${args.page}` : "");
  const s = String(v ?? "");
  const extra = args.item_key && name.startsWith("paper_") ? ` [${args.item_key}]` : "";
  return (s.length > 60 ? s.slice(0, 60) + "…" : s) + extra;
}

export function imagesOf(m: any): any[] {
  return Array.isArray(m?.content) ? m.content.filter((c: any) => c.type === "image") : [];
}

export function Thumb({ img, title }: { img: { data?: string; mimeType?: string; dataUrl?: string }; title?: string }) {
  const [big, setBig] = useState(false);
  const src = img.dataUrl || `data:${img.mimeType};base64,${img.data}`;
  return <img class={big ? "thumb big" : "thumb"} src={src} title={title || "点击放大 / 缩小"} onClick={() => setBig(!big)} />;
}

export function textOf(m: any): string {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  return (m.content || [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("");
}

function fmtSecs(ms: number): string {
  ms = Math.max(0, ms);
  return ms < 10000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

/** Re-render periodically while `active`; returns the current time (read at render). */
export function useTicker(active: boolean, ms = 200): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return Date.now();
}

function ToolCallView({ call, result, pending, active, preparing }: { call: any; result?: any; pending: boolean; active?: any; preparing?: boolean }) {
  const [open, setOpen] = useState(false);
  const status = preparing ? "preparing" : pending || !result ? "running" : result.isError ? "error" : "done";
  const resultText = result ? textOf(result) : "";
  const now = useTicker(!!active);
  const timeLabel = active ? fmtSecs(now - active.startedAt) : result?.durationMs != null ? fmtSecs(result.durationMs) : "";
  return (
    <div class={`tool tool-${status}`}>
      <button class="tool-head" onClick={() => setOpen(!open)} title="展开 / 收起详情">
        <span class="tool-icon">{TOOL_ICONS[call.name] || "🔧"}</span>
        <span class="tool-name">{TOOL_LABELS[call.name] || call.name}</span>
        <span class="tool-arg">{argSummary(call.name, call.arguments)}</span>
        {timeLabel && <span class="tool-time">{timeLabel}</span>}
        <span class="tool-status">
          {status === "preparing" ? <span class="tool-state">准备参数…</span> : status === "running" ? <span class="spinner" /> : status === "error" ? "✗" : "✓"}
        </span>
      </button>
      {open && (
        <div class="tool-body">
          <div class="tool-label">参数</div>
          <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
          {result && imagesOf(result).length > 0 && (
            <div class="thumbs">
              {imagesOf(result).map((im: any, i: number) => (
                <Thumb key={i} img={im} />
              ))}
            </div>
          )}
          {result && (
            <>
              <div class="tool-label">{result.isError ? "错误" : "结果"}</div>
              <pre>{resultText.length > 6000 ? resultText.slice(0, 6000) + "\n…" : resultText}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return live ? <div class="thinking-live"><span class="spinner" /> 思考中…</div> : null;
  return (
    <div class="thinking">
      <button class="thinking-head" onClick={() => setOpen(!open)}>
        {live ? <span class="spinner" /> : "💭"} {live ? "思考中…" : "思考过程"} <span class="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div class="thinking-body">{text}</div>}
    </div>
  );
}

export function UserMessage({ message }: { message: any }) {
  return (
    <div class="msg user">
      <div class="bubble">
        {imagesOf(message).length > 0 && (
          <div class="thumbs">
            {imagesOf(message).map((im: any, i: number) => (
              <Thumb key={i} img={im} />
            ))}
          </div>
        )}
        <Markdown text={textOf(message)} />
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  results,
  pending,
  live,
  onRetry,
  active,
}: {
  message: any;
  results: Map<string, any>;
  pending: Set<string>;
  live: boolean;
  onRetry?: () => void;
  active?: Map<string, any>;
}) {
  const parts = message.content || [];
  const hasText = parts.some((c: any) => c.type === "text" && c.text.trim());
  return (
    <div class="amsg">
      {parts.map((c: any, i: number) => {
        if (c.type === "thinking") return <Thinking key={i} text={c.thinking || ""} live={live && !hasText && i === parts.length - 1} />;
        if (c.type === "text") return c.text ? <Markdown key={i} text={c.text} live={live} /> : null;
        if (c.type === "toolCall")
          return (
            <ToolCallView
              key={c.id}
              call={c}
              result={results.get(c.id)}
              pending={pending.has(c.id) || (live && !results.has(c.id))}
              active={active?.get(c.id)}
              preparing={live && !active?.has(c.id) && !results.has(c.id)}
            />
          );
        return null;
      })}
      {live && !parts.length && (
        <div class="thinking-live">
          <span class="spinner" /> 正在思考…
        </div>
      )}
      <ErrorBox message={message} onRetry={onRetry} />
    </div>
  );
}

interface ProcItem {
  kind: "thinking" | "text" | "tool";
  part: any;
  key: string;
  live: boolean; // belongs to the streaming message
  lastPart: boolean; // last part of its message
}

function hasNonEmptyText(m: any): boolean {
  return (m?.content || []).some((c: any) => c.type === "text" && c.text?.trim());
}

function hasToolCall(m: any): boolean {
  return (m?.content || []).some((c: any) => c.type === "toolCall");
}

function ErrorBox({ message, onRetry }: { message: any; onRetry?: () => void }) {
  if (message?.stopReason !== "error" && message?.stopReason !== "aborted") return null;
  return (
    <div class={message.stopReason === "error" ? "error-box" : "aborted-box"}>
      {message.stopReason === "error" ? `出错了：${message.errorMessage || "未知错误"}` : "已停止"}
      {onRetry && (
        <button class="link-btn" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

/**
 * The thinking / tool-call / narration steps of one reply, folded into a single
 * block. Collapsed by default, showing only the latest step; click to expand.
 */
function ProcessGroup({
  msgs,
  liveMsg,
  live,
  results,
  pending,
  active,
  tailError,
  onRetry,
}: {
  msgs: any[];
  liveMsg: any | null;
  live: boolean;
  results: Map<string, any>;
  pending: Set<string>;
  active: Map<string, any>;
  tailError?: any;
  onRetry?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const items: ProcItem[] = [];
  msgs.forEach((m, mi) => {
    const isLive = m === liveMsg;
    const parts: any[] = m.content || [];
    parts.forEach((c, i) => {
      const lastPart = i === parts.length - 1;
      const base = { part: c, key: `${mi}-${c.id || i}`, live: isLive, lastPart };
      if (c.type === "toolCall") items.push({ kind: "tool", ...base });
      else if (c.type === "text" && c.text?.trim()) items.push({ kind: "text", ...base });
      else if (c.type === "thinking" && ((c.thinking || "").trim() || (isLive && lastPart))) items.push({ kind: "thinking", ...base });
    });
  });
  const tools = items.filter((it) => it.kind === "tool");
  const errors = tools.filter((t) => results.get(t.part.id)?.isError).length;
  const thinkingCount = items.filter((it) => it.kind === "thinking").length;
  const latest = items[items.length - 1];
  const now = useTicker(live, 1000);
  const firstTs = msgs[0]?.timestamp;
  const lastResult = [...tools].reverse().map((t) => results.get(t.part.id)).find(Boolean);
  const endTs = live ? now : lastResult ? lastResult.timestamp : msgs[msgs.length - 1]?.timestamp;
  const elapsed = firstTs && endTs ? fmtSecs(endTs - firstTs) : "";

  const renderItem = (it: ProcItem) => {
    if (it.kind === "thinking") return <Thinking key={it.key} text={it.part.thinking || ""} live={it.live && it.lastPart} />;
    if (it.kind === "text")
      return (
        <div class="proc-text" key={it.key}>
          <Markdown text={it.part.text} live={it.live} />
        </div>
      );
    const c = it.part;
    return (
      <ToolCallView
        key={it.key}
        call={c}
        result={results.get(c.id)}
        pending={pending.has(c.id) || (it.live && !results.has(c.id))}
        active={active.get(c.id)}
        preparing={it.live && !active.has(c.id) && !results.has(c.id)}
      />
    );
  };

  return (
    <div class={`proc ${open ? "open" : ""}`}>
      <button class="proc-head" onClick={() => setOpen(!open)} title={open ? "收起过程" : "展开全部过程"}>
        <span class="chev">{open ? "▾" : "▸"}</span>
        {live ? <span class="spinner" /> : <span class="proc-icon">⚙</span>}
        <span class="proc-title">
          {live ? "处理中" : "处理过程"} · {tools.length} 次工具调用
          {errors ? <span class="proc-err"> · {errors} 次失败</span> : null}
          {thinkingCount ? ` · 思考 ${thinkingCount} 次` : ""}
          {elapsed ? ` · ${elapsed}` : ""}
        </span>
        <span class="proc-toggle">{open ? "收起" : items.length > 1 ? `展开全部 ${items.length} 步` : ""}</span>
      </button>
      <div class="proc-body">
        {open ? items.map(renderItem) : latest ? <div class="proc-latest">{renderItem(latest)}</div> : null}
      </div>
      {tailError && <ErrorBox message={tailError} onRetry={onRetry} />}
    </div>
  );
}

/** One assistant reply (possibly many messages): folded process + final answer. */
function AssistantTurn({
  msgs,
  liveMsg,
  live,
  isLastTurn,
  isStreaming,
  results,
  pending,
  active,
  onRetry,
}: {
  msgs: any[];
  liveMsg: any | null;
  live: boolean;
  isLastTurn: boolean;
  isStreaming: boolean;
  results: Map<string, any>;
  pending: Set<string>;
  active: Map<string, any>;
  onRetry?: () => void;
}) {
  let split = -1;
  msgs.forEach((m, i) => {
    if (hasToolCall(m)) split = i;
  });
  // While a later message is still streaming without answer text, keep it inside the process block.
  const last = msgs[msgs.length - 1];
  if (split >= 0 && last === liveMsg && !hasNonEmptyText(last)) split = msgs.length - 1;
  const process = msgs.slice(0, split + 1);
  const rest = msgs.slice(split + 1);
  const finalMsg = msgs[msgs.length - 1];
  const retry = isLastTurn && !isStreaming ? onRetry : undefined;
  return (
    <>
      {process.length > 0 && (
        <ProcessGroup
          msgs={process}
          liveMsg={liveMsg}
          live={live}
          results={results}
          pending={pending}
          active={active}
          tailError={rest.length === 0 ? finalMsg : undefined}
          onRetry={retry}
        />
      )}
      {rest.map((m, i) => (
        <AssistantMessage
          key={`r${i}`}
          message={m}
          results={results}
          pending={pending}
          live={m === liveMsg}
          onRetry={m === finalMsg ? retry : undefined}
          active={active}
        />
      ))}
    </>
  );
}

/** Render a transcript slice (committed + streaming), grouped by turn. */
export function MessageList({
  messages,
  streaming,
  pendingTools,
  isStreaming,
  onRetry,
  empty,
  activeTools = [],
}: {
  messages: any[];
  streaming: any | null;
  pendingTools: string[];
  isStreaming: boolean;
  onRetry?: () => void;
  empty?: ComponentChildren;
  activeTools?: any[];
}) {
  const active = new Map<string, any>(activeTools.map((t) => [t.id, t]));
  const results = new Map<string, any>();
  for (const m of messages) if (m.role === "toolResult") results.set(m.toolCallId, m);
  const pending = new Set(pendingTools);
  const visible = messages.filter((m) => m.role === "user" || m.role === "assistant");
  if (!visible.length && !streaming && !isStreaming) return <>{empty}</>;

  const all = streaming ? [...visible, streaming] : visible;
  const turns: { user: any | null; assistants: any[] }[] = [];
  for (const m of all) {
    if (m.role === "user") turns.push({ user: m, assistants: [] });
    else {
      if (!turns.length) turns.push({ user: null, assistants: [] });
      turns[turns.length - 1].assistants.push(m);
    }
  }
  const lastTurn = turns.length - 1;
  const lastMsg = all[all.length - 1];
  const showWaiting = isStreaming && !streaming && (!lastMsg || lastMsg.role !== "assistant" || (!hasToolCall(lastMsg) && pending.size === 0));

  return (
    <div class="messages">
      {turns.map((t, ti) => (
        <div class="turn" key={ti}>
          {t.user && <UserMessage message={t.user} />}
          {t.assistants.length > 0 && (
            <div class="msg assistant">
              <AssistantTurn
                msgs={t.assistants}
                liveMsg={streaming}
                live={isStreaming && ti === lastTurn}
                isLastTurn={ti === lastTurn}
                isStreaming={isStreaming}
                results={results}
                pending={pending}
                active={active}
                onRetry={onRetry}
              />
            </div>
          )}
        </div>
      ))}
      {showWaiting && (
        <div class="msg assistant">
          <div class="thinking-live">
            <span class="spinner" /> 正在思考…
          </div>
        </div>
      )}
    </div>
  );
}

/** Scroll container that sticks to the bottom while content streams in. */
export function AutoScroll({ children, dep }: { children: ComponentChildren; dep: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return (
    <div
      class="scroll"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {children}
    </div>
  );
}

export function Composer({
  onSend,
  onStop,
  busy,
  placeholder,
  quote,
  onClearQuote,
  autoFocus,
  footer,
  initial,
  attachments,
  onRemoveAttachment,
  onCapture,
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  busy: boolean;
  placeholder?: string;
  quote?: { text: string; pageLabel: string } | null;
  onClearQuote?: () => void;
  autoFocus?: boolean;
  footer?: ComponentChildren;
  initial?: string;
  attachments?: { dataUrl: string; label: string }[];
  onRemoveAttachment?: (i: number) => void;
  onCapture?: () => void;
}) {
  const hasAttach = !!attachments?.length;
  const [text, setText] = useState(initial || "");
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus, quote]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [text]);
  const send = () => {
    if (!text.trim() && !quote && !hasAttach) return;
    onSend(text);
    setText("");
  };
  return (
    <div class="composer">
      {quote && (
        <div class="quote-chip">
          <span class="quote-text">“{quote.text.length > 140 ? quote.text.slice(0, 140) + "…" : quote.text}”</span>
          {quote.pageLabel && <span class="quote-page">p.{quote.pageLabel}</span>}
          <button class="x" onClick={onClearQuote} title="移除引用">
            ✕
          </button>
        </div>
      )}
      {hasAttach && (
        <div class="attach-row">
          {attachments!.map((a, i) => (
            <div class="attach" key={i} title={a.label}>
              <img src={a.dataUrl} />
              <button class="x" onClick={() => onRemoveAttachment?.(i)} title="移除图片">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div class="input-row">
        {onCapture && (
          <button class="capture" onClick={onCapture} title="框图：在 PDF 上框选一块区域作为图片附件 (⌘/Ctrl+Shift+K 直接框图提问)">
            📷
          </button>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={placeholder || "输入问题，Enter 发送，Shift+Enter 换行"}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !(e as any).isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy && onStop ? (
          <>
            {text.trim() && (
              <button class="send" onClick={send} title="排队发送（当前回答结束后处理）">
                ↑
              </button>
            )}
            <button class="stop" onClick={onStop} title="停止">
              ■
            </button>
          </>
        ) : (
          <button class="send" onClick={send} disabled={!text.trim() && !quote && !hasAttach} title="发送">
            ↑
          </button>
        )}
      </div>
      {footer}
    </div>
  );
}

/** Live status of the current run: phase, running tools with timers, run totals. */
export function ActivityBar({ snap }: { snap: any }) {
  const busy = !!snap?.isStreaming;
  const now = useTicker(busy);
  if (!busy) return null;
  const tools: any[] = snap.activeTools || [];
  const parts: any[] = snap.streaming?.content || [];
  const last = parts[parts.length - 1];
  let phase: ComponentChildren;
  if (tools.length) {
    phase = tools.map((t) => (
      <div class="act-tool" key={t.id}>
        <span class="spinner" />
        <span class="act-icon">{TOOL_ICONS[t.name] || "🔧"}</span>
        <span class="act-name">{TOOL_LABELS[t.name] || t.name}</span>
        <span class="act-arg">{argSummary(t.name, t.args)}</span>
        <span class="act-time">{fmtSecs(now - t.startedAt)}</span>
      </div>
    ));
  } else if (last?.type === "toolCall") {
    phase = (
      <div class="act-tool">
        <span class="spinner" />
        <span class="act-icon">{TOOL_ICONS[last.name] || "🔧"}</span>
        <span class="act-name">准备调用 {TOOL_LABELS[last.name] || last.name}</span>
        <span class="act-arg">{argSummary(last.name, last.arguments)}</span>
      </div>
    );
  } else if (last?.type === "text") {
    phase = (
      <div class="act-tool">
        <span class="spinner" /> 正在输出回答…
      </div>
    );
  } else if (last?.type === "thinking") {
    phase = (
      <div class="act-tool">
        <span class="spinner" /> 思考中…
      </div>
    );
  } else {
    phase = (
      <div class="act-tool">
        <span class="spinner" /> 等待模型响应…
      </div>
    );
  }
  return (
    <div class="activity">
      <div class="act-main">{phase}</div>
      <div class="act-meta">
        {snap.runStartedAt ? fmtSecs(now - snap.runStartedAt) : ""}
        {snap.runToolCount ? ` · 已完成 ${snap.runToolCount} 个工具调用` : ""}
      </div>
    </div>
  );
}
