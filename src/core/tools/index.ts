import { annotationTools } from "./annotation-tools";
import type { Tool, ToolContext } from "./common";
import { libraryTools } from "./library-tools";
import { paperTools } from "./paper-tools";
import { visionTools } from "./vision-tools";
import { webTools } from "./web-tools";

export type { ToolContext } from "./common";

export function buildTools(ctx: ToolContext): Tool[] {
  return [...paperTools(ctx), ...visionTools(ctx), ...annotationTools(ctx), ...libraryTools(ctx), ...webTools(ctx)];
}
