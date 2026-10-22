import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { PaperRef } from "../paper";

export interface ToolContext {
  /** The paper this session belongs to. */
  paper: PaperRef;
  sessionId: string;
  /** Text of the latest user message (helps search query understanding). */
  lastUserText(): string;
  /** The session's current model (to know whether it can see images). */
  currentModel(): any;
  /** Notify UI about side effects (annotation created, etc.). */
  notify(event: { type: string; [k: string]: any }): void;
}

export type Tool = AgentTool<any, any>;

/** Identity helper so tool params are inferred from the schema. */
export function tool<T extends TSchema>(def: AgentTool<T, any>): Tool {
  return def as Tool;
}

export function ok(text: string, details: any = {}): AgentToolResult<any> {
  return { content: [{ type: "text", text }], details };
}

export function clip(s: string, n: number): string {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Parse "3", "3-5", "3,5,7" (1-based) into 0-based page indices. */
export function parsePages(spec: string, total: number): number[] {
  const out = new Set<number>();
  for (const part of String(spec).split(/[,，\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[-–~]\s*(\d+)$/);
    if (m) {
      const a = Math.max(1, Number(m[1]));
      const b = Math.min(total, Number(m[2]));
      for (let p = a; p <= b && out.size < 60; p++) out.add(p - 1);
    } else if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p >= 1 && p <= total) out.add(p - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}
