import { render } from "preact";
import { useState } from "preact/hooks";
import { clone, getApi } from "./api";

const api = getApi();

const THINKING: [string, string][] = [
  ["off", "关闭思考"],
  ["low", "低"],
  ["high", "高（默认）"],
  ["max", "最大"],
];

function Field({ label, hint, children }: { label: string; hint?: string; children: any }) {
  return (
    <label class="field">
      <span class="label">{label}</span>
      <div class="control">
        {children}
        {hint && <div class="hint">{hint}</div>}
      </div>
    </label>
  );
}

function App() {
  const [s, setS] = useState<any>(() => clone(api.getSettings()));
  const [models, setModels] = useState<any[]>(() => clone(api.listModels()));
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [remote, setRemote] = useState<string[]>([]);
  const set = (k: string, v: any) => setS((prev: any) => ({ ...prev, [k]: v }));

  const save = () => {
    api.saveSettings(s);
    setModels(clone(api.listModels()));
    setStatus({ ok: true, text: "已保存" });
    setTimeout(() => setStatus(null), 2500);
  };

  const test = async () => {
    api.saveSettings(s);
    setTesting(true);
    setStatus(null);
    try {
      const r = clone(await api.testConnection());
      setStatus({ ok: r.ok, text: r.message });
      setRemote(r.remoteModels || []);
    } finally {
      setTesting(false);
    }
  };

  const addExtra = (id: string) => {
    const list = s.extraModels.split(/[,\s]+/).filter(Boolean);
    if (!list.includes(id) && !models.some((m) => m.id === id)) set("extraModels", [...list, id].join(", "));
  };

  const actions: any[] = s.quickActions;
  const setAction = (i: number, patch: any) => set("quickActions", actions.map((a, j) => (i === j ? { ...a, ...patch } : a)));

  return (
    <div class="page">
      <header>
        <div class="logo">π</div>
        <div>
          <h1>Pi Agent 设置</h1>
          <div class="sub">基于 pi agent 的 Zotero AI 阅读助手 · v{api.version}</div>
        </div>
      </header>

      <section>
        <h2>模型与 API</h2>
        <Field label="DeepSeek API Key" hint="保存在 Zotero 本地偏好设置中。获取：platform.deepseek.com">
          <div class="row">
            <input type={showKey ? "text" : "password"} value={s.apiKey} placeholder="sk-..." onInput={(e) => set("apiKey", (e.target as HTMLInputElement).value.trim())} />
            <button onClick={() => setShowKey(!showKey)}>{showKey ? "隐藏" : "显示"}</button>
          </div>
        </Field>
        <Field label="API 地址" hint="默认 https://api.deepseek.com">
          <input value={s.baseUrl} onInput={(e) => set("baseUrl", (e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="默认对话模型">
          <select value={s.model} onChange={(e) => set("model", (e.target as HTMLSelectElement).value)}>
            {models.map((m) => (
              <option value={m.id}>
                {m.name} ({m.id})
              </option>
            ))}
          </select>
        </Field>
        <Field label="默认思考强度" hint="新会话使用；每个会话可在输入框下方单独切换">
          <select value={s.thinkingLevel} onChange={(e) => set("thinkingLevel", (e.target as HTMLSelectElement).value)}>
            {THINKING.map(([v, l]) => (
              <option value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="翻译 / 结论模型" hint="用于划词翻译与自动生成会话结论（不开启思考，速度优先）">
          <select value={s.quickModel} onChange={(e) => set("quickModel", (e.target as HTMLSelectElement).value)}>
            {models.map((m) => (
              <option value={m.id}>{m.name}</option>
            ))}
          </select>
        </Field>
        <Field label="额外模型 ID" hint="逗号分隔，用于 DeepSeek 新发布、pi 尚未内置的模型">
          <input value={s.extraModels} placeholder="例如 deepseek-v4-flash" onInput={(e) => set("extraModels", (e.target as HTMLInputElement).value)} />
        </Field>
        <div class="row actions">
          <button class="primary" onClick={test} disabled={testing}>
            {testing ? "测试中…" : "测试连接"}
          </button>
          {remote.length > 0 && (
            <span class="remote">
              账户可用模型：
              {remote.map((id) => (
                <button class="tag" title="加入额外模型" onClick={() => addExtra(id)}>
                  {id}
                </button>
              ))}
            </span>
          )}
        </div>
      </section>

      <section>
        <h2>阅读与回答</h2>
        <Field label="回答语言">
          <input value={s.replyLanguage} onInput={(e) => set("replyLanguage", (e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="翻译目标语言">
          <input value={s.targetLanguage} onInput={(e) => set("targetLanguage", (e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="单次读取字符上限" hint="渐进式披露：Agent 每次读取论文 / 网页的最大字符数（1000–50000）">
          <input type="number" min={1000} max={50000} step={1000} value={s.maxReadChars} onInput={(e) => set("maxReadChars", Number((e.target as HTMLInputElement).value))} />
        </Field>
        <Field label="自动生成会话结论" hint="每轮对话结束后用快速模型总结结论，供其他文章的会话查阅">
          <input type="checkbox" checked={s.autoConclusion} onChange={(e) => set("autoConclusion", (e.target as HTMLInputElement).checked)} />
        </Field>
        <Field label="自定义系统提示词" hint="追加到 Agent 的系统提示词末尾">
          <textarea rows={4} value={s.customSystemPrompt} onInput={(e) => set("customSystemPrompt", (e.target as HTMLTextAreaElement).value)} />
        </Field>
      </section>

      <section>
        <h2>网络搜索</h2>
        <Field label="搜索引擎" hint="DeepSeek 搜索使用同一个 API Key，按次计费（约 $0.75 / 千次成功请求）；失败时自动回退到 DuckDuckGo">
          <select value={s.searchEngine} onChange={(e) => set("searchEngine", (e.target as HTMLSelectElement).value)}>
            <option value="deepseek">DeepSeek 搜索（推荐）</option>
            <option value="duckduckgo">DuckDuckGo（免费）</option>
            <option value="tavily">Tavily</option>
            <option value="brave">Brave Search</option>
            <option value="searxng">SearXNG（自建）</option>
          </select>
        </Field>
        {s.searchEngine === "tavily" && (
          <Field label="Tavily API Key">
            <input type="password" value={s.tavilyKey} onInput={(e) => set("tavilyKey", (e.target as HTMLInputElement).value.trim())} />
          </Field>
        )}
        {s.searchEngine === "brave" && (
          <Field label="Brave API Key">
            <input type="password" value={s.braveKey} onInput={(e) => set("braveKey", (e.target as HTMLInputElement).value.trim())} />
          </Field>
        )}
        {s.searchEngine === "searxng" && (
          <Field label="SearXNG 地址">
            <input value={s.searxngUrl} placeholder="https://searx.example.com" onInput={(e) => set("searxngUrl", (e.target as HTMLInputElement).value.trim())} />
          </Field>
        )}
        <Field label="网页读取" hint="DeepSeek Fetch 返回整理后的 Markdown（按次计费）；本地抓取免费但对动态网页效果较差">
          <select value={s.fetchEngine} onChange={(e) => set("fetchEngine", (e.target as HTMLSelectElement).value)}>
            <option value="deepseek">DeepSeek Fetch（失败时回退本地）</option>
            <option value="local">本地抓取</option>
          </select>
        </Field>
      </section>

      <section>
        <h2>批注</h2>
        <Field label="AI 批注颜色">
          <input type="color" value={s.annotationColor} onInput={(e) => set("annotationColor", (e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="AI 批注标签" hint="AI 创建的批注会加上此标签，便于筛选（留空则不加）">
          <input value={s.annotationTag} onInput={(e) => set("annotationTag", (e.target as HTMLInputElement).value)} />
        </Field>
      </section>

      <section>
        <h2>划词操作</h2>
        <div class="hint">选中 PDF 文本后弹出的 AI 按钮。提示词中的 {"{text}"} 会被替换为选中文本；“翻译”类型使用快速模型直接翻译。</div>
        {actions.map((a, i) => (
          <div class="action">
            <input class="a-label" value={a.label} onInput={(e) => setAction(i, { label: (e.target as HTMLInputElement).value })} />
            <select value={a.mode} onChange={(e) => setAction(i, { mode: (e.target as HTMLSelectElement).value })}>
              <option value="agent">Agent</option>
              <option value="translate">翻译</option>
            </select>
            <textarea rows={2} disabled={a.mode === "translate"} value={a.prompt} placeholder={a.mode === "translate" ? "（翻译无需提示词）" : "提示词，包含 {text}"} onInput={(e) => setAction(i, { prompt: (e.target as HTMLTextAreaElement).value })} />
            <button onClick={() => set("quickActions", actions.filter((_, j) => j !== i))}>删除</button>
          </div>
        ))}
        <div class="row">
          <button onClick={() => set("quickActions", [...actions, { id: `custom${Date.now()}`, label: "新操作", mode: "agent", prompt: "{text}" }])}>添加操作</button>
        </div>
      </section>

      <footer>
        {status && <span class={status.ok ? "ok" : "err"}>{status.text}</span>}
        <button class="primary" onClick={save}>
          保存
        </button>
      </footer>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
