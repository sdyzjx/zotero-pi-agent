import { createModels, type Model, type Api, type Context, type AssistantMessage } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getSettings } from "./config";

const models = createModels();
models.setProvider(deepseekProvider());

export interface ModelInfo {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: string[];
  builtin: boolean;
}

/** DeepSeek models known to pi plus user-configured extra model ids. */
export function listModels(): ModelInfo[] {
  const builtin = models.getModels("deepseek");
  const out: ModelInfo[] = builtin.map((m) => ({
    id: m.id,
    name: m.name,
    reasoning: !!m.reasoning,
    thinkingLevels: thinkingLevelsOf(m),
    builtin: true,
  }));
  for (const id of extraModelIds()) {
    if (!out.some((m) => m.id === id)) {
      out.push({ id, name: id, reasoning: true, thinkingLevels: ["off", "low", "high", "max"], builtin: false });
    }
  }
  return out;
}

function extraModelIds(): string[] {
  return getSettings()
    .extraModels.split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function thinkingLevelsOf(m: Model<Api>): string[] {
  if (!m.reasoning) return ["off"];
  const map: Record<string, string | null> = (m as any).thinkingLevelMap || {};
  const levels = ["off"];
  for (const l of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
    if (map[l] !== null && (map[l] !== undefined || l in map)) levels.push(l);
  }
  return levels.length > 1 ? levels : ["off", "high"];
}

/** Resolve a model id to a pi Model, applying the configured base URL. */
export function getModel(id?: string): Model<Api> {
  const settings = getSettings();
  const wanted = id || settings.model;
  let model = models.getModel("deepseek", wanted);
  if (!model) {
    // Unknown DeepSeek id (e.g. a newer model): reuse the flash definition.
    const base = models.getModel("deepseek", "deepseek-flash") || models.getModels("deepseek")[0];
    model = { ...base, id: wanted, name: wanted } as Model<Api>;
  }
  const baseUrl = settings.baseUrl.trim().replace(/\/+$/, "");
  if (baseUrl && baseUrl !== model.baseUrl) model = { ...model, baseUrl };
  return model;
}

export function clampThinking(model: Model<Api>, level: string): string {
  const levels = thinkingLevelsOf(model);
  if (levels.includes(level)) return level;
  if (level === "off") return "off";
  // pick the closest supported level
  const order = ["minimal", "low", "medium", "high", "xhigh", "max"];
  const idx = order.indexOf(level);
  for (let d = 1; d < order.length; d++) {
    for (const j of [idx + d, idx - d]) {
      if (j >= 0 && j < order.length && levels.includes(order[j])) return order[j];
    }
  }
  return levels[levels.length - 1];
}

function requireApiKey(): string {
  const key = getSettings().apiKey.trim();
  if (!key) throw new Error("尚未配置 DeepSeek API Key，请在 Pi Agent 设置中填写。");
  return key;
}

/** streamFn for pi Agent instances: injects the API key on every request. */
export const streamFn: StreamFn = (model, context, options) =>
  models.streamSimple(model, context as any, { ...options, apiKey: requireApiKey() });

export function streamSimple(model: Model<Api>, context: Context, options: Record<string, any> = {}) {
  return models.streamSimple(model, context, { ...options, apiKey: requireApiKey() });
}

export async function completeText(
  context: Context,
  opts: { model?: string; reasoning?: string; signal?: AbortSignal; maxTokens?: number } = {},
): Promise<string> {
  const model = getModel(opts.model || getSettings().quickModel);
  const reasoning = opts.reasoning && opts.reasoning !== "off" ? clampThinking(model, opts.reasoning) : undefined;
  const msg: AssistantMessage = await models.completeSimple(model, context, {
    apiKey: requireApiKey(),
    reasoning: reasoning as any,
    signal: opts.signal,
    maxTokens: opts.maxTokens,
  });
  if (msg.stopReason === "error" || msg.stopReason === "aborted") {
    throw new Error(msg.errorMessage || `请求失败 (${msg.stopReason})`);
  }
  return msg.content
    .filter((c) => c.type === "text")
    .map((c: any) => c.text)
    .join("");
}

/** Check credentials and list models available on the account. */
export async function testConnection(): Promise<{ ok: boolean; message: string; remoteModels: string[] }> {
  const settings = getSettings();
  let remoteModels: string[] = [];
  try {
    const res = await fetch(settings.baseUrl.replace(/\/+$/, "") + "/models", {
      headers: { Authorization: `Bearer ${requireApiKey()}` },
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, remoteModels };
    }
    const data = await res.json();
    remoteModels = (data.data || []).map((m: any) => m.id);
    const text = await completeText(
      { messages: [{ role: "user", content: "Reply with exactly: OK", timestamp: Date.now() }] },
      { model: settings.model, maxTokens: 20 },
    );
    return { ok: true, message: `连接成功，模型回复：${text.trim().slice(0, 50)}`, remoteModels };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e), remoteModels };
  }
}
