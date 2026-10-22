/**
 * The plugin bootstrap sandbox only exposes a subset of web globals (fetch,
 * TextDecoder, URL, ...). pi-ai and the OpenAI SDK also need AbortController,
 * ReadableStream, Headers, etc. Borrow them from the hidden DOM window, which
 * lives for the whole app session (the main window can be closed on macOS).
 */
const NAMES = [
  "AbortController",
  "AbortSignal",
  "Headers",
  "Request",
  "Response",
  "FormData",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "TextDecoderStream",
  "TextEncoderStream",
  "Event",
  "EventTarget",
  "CustomEvent",
  "DOMException",
  "DOMParser",
  "XMLSerializer",
  "Blob",
  "File",
  "URL",
  "URLSearchParams",
  "structuredClone",
  "queueMicrotask",
  "performance",
  "navigator",
  "console",
  "crypto",
  "atob",
  "btoa",
];

export function installPolyfills(): void {
  const g = globalThis as any;
  let win: any = null;
  try {
    win = Services.appShell.hiddenDOMWindow;
  } catch {
    // ignore
  }
  if (!win) win = Zotero.getMainWindow();
  if (!win) return;
  for (const name of NAMES) {
    if (typeof g[name] === "undefined" && typeof win[name] !== "undefined") {
      const v = win[name];
      g[name] = typeof v === "function" && /^[a-z]/.test(name) ? v.bind(win) : v;
    }
  }
}
