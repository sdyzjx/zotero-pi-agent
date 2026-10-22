/** Access the core addon object from a chrome:// page. */
declare const ChromeUtils: any;

export function getZotero(): any {
  try {
    return ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs").Zotero;
  } catch {
    return (window.parent as any)?.Zotero || (window.opener as any)?.Zotero;
  }
}

export function getApi(): any {
  return getZotero()?.ZoteroPi;
}

export function clone<T>(x: T): T {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

/** Subscribe to a core Emitter and auto-unsubscribe when this page unloads. */
export function subscribe<T>(emitter: any, fn: (v: T) => void): () => void {
  const off = emitter.on(fn);
  const onUnload = () => off();
  window.addEventListener("unload", onUnload, { once: true });
  return () => {
    window.removeEventListener("unload", onUnload);
    off();
  };
}
