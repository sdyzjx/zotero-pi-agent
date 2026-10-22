const PREFIX = "extensions.zoteropi.";

export interface QuickAction {
  id: string;
  label: string;
  /** Prompt template; {text} is replaced with the selected text. */
  prompt: string;
  /** "translate" runs a fast tool-less call; "agent" runs in the paper session. */
  mode: "translate" | "agent";
}

export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { id: "explain", label: "解释", mode: "agent", prompt: "请结合论文上下文解释下面这段内容（必要时查阅论文其他部分），说明其含义、作用以及涉及的关键概念：\n\n{text}" },
  { id: "translate", label: "翻译", mode: "translate", prompt: "" },
  { id: "summarize", label: "总结", mode: "agent", prompt: "请用简洁的要点总结下面这段内容的核心意思：\n\n{text}" },
];

export interface Settings {
  apiKey: string;
  baseUrl: string;
  model: string;
  thinkingLevel: string;
  quickModel: string;
  extraModels: string;
  targetLanguage: string;
  replyLanguage: string;
  customSystemPrompt: string;
  maxReadChars: number;
  searchEngine: "deepseek" | "duckduckgo" | "tavily" | "brave" | "searxng";
  fetchEngine: "deepseek" | "local";
  tavilyKey: string;
  braveKey: string;
  searxngUrl: string;
  annotationColor: string;
  annotationTag: string;
  autoConclusion: boolean;
  quickActions: QuickAction[];
}

const DEFAULTS: Omit<Settings, "quickActions"> = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  thinkingLevel: "high",
  quickModel: "deepseek-flash",
  extraModels: "",
  targetLanguage: "简体中文",
  replyLanguage: "简体中文",
  customSystemPrompt: "",
  maxReadChars: 8000,
  searchEngine: "deepseek",
  fetchEngine: "deepseek",
  tavilyKey: "",
  braveKey: "",
  searxngUrl: "",
  annotationColor: "#a28ae5",
  annotationTag: "AI",
  autoConclusion: true,
};

export function getPref<T = any>(key: string): T {
  return Zotero.Prefs.get(PREFIX + key, true) as T;
}

export function setPref(key: string, value: any): void {
  Zotero.Prefs.set(PREFIX + key, value, true);
}

export function getSettings(): Settings {
  const out: any = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    const v = getPref(k);
    out[k] = v === undefined || v === null ? def : v;
  }
  out.maxReadChars = Math.max(1000, Math.min(50000, Number(out.maxReadChars) || 8000));
  out.quickActions = parseQuickActions(getPref("quickActions"));
  return out as Settings;
}

function parseQuickActions(raw: string | undefined): QuickAction[] {
  if (!raw) return DEFAULT_QUICK_ACTIONS;
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list) && list.length) {
      return list
        .filter((a) => a && a.label && (a.mode === "translate" || a.prompt))
        .map((a, i) => ({
          id: String(a.id || `custom${i}`),
          label: String(a.label),
          prompt: String(a.prompt || ""),
          mode: a.mode === "translate" ? "translate" : "agent",
        }));
    }
  } catch {
    // fall through
  }
  return DEFAULT_QUICK_ACTIONS;
}

export function saveSettings(patch: Partial<Settings>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (k === "quickActions") {
      setPref(k, JSON.stringify(v));
    } else if (k in DEFAULTS) {
      setPref(k, v as any);
    }
  }
}
