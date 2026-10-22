/**
 * Development-only HTTP endpoint (POST /zoteropi/eval on Zotero's local
 * connector server) used for automated integration testing. Only compiled into
 * `npm run build:dev` builds; release builds drop this module entirely.
 */
const PATH = "/zoteropi/eval";

export function registerDevEndpoint(addon: any): void {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const Endpoint: any = function () {};
  Endpoint.prototype = {
    supportedMethods: ["POST"],
    supportedDataTypes: ["text/plain", "application/json"],
    permitBookmarklet: false,
    init: async function (req: any) {
      const code = typeof req.data === "string" ? req.data : JSON.stringify(req.data);
      try {
        const fn = new AsyncFunction("Zotero", "addon", code);
        const result = await fn(Zotero, addon);
        return [200, "application/json", JSON.stringify(result ?? null)];
      } catch (e: any) {
        return [500, "text/plain", `${e}\n${e?.stack || ""}`];
      }
    },
  };
  Zotero.Server.Endpoints[PATH] = Endpoint;
}

export function unregisterDevEndpoint(): void {
  delete Zotero.Server.Endpoints[PATH];
}
