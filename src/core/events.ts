/** Tiny event bus. Listeners may live in chrome iframes that get unloaded, so failures unsubscribe them. */
export type Listener<T = any> = (data: T) => void;

export class Emitter<T = any> {
  private listeners = new Set<Listener<T>>();

  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(data: T): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(data);
      } catch (e: any) {
        // "can't access dead object" when the subscriber's window is gone
        if (/dead object/i.test(String(e?.message))) this.listeners.delete(fn);
        else Zotero.logError(e);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
  }
}

export interface GlobalEvent {
  type: string;
  [k: string]: any;
}

/** App-wide events (annotation created, session list changed, settings changed…). */
export const globalEvents = new Emitter<GlobalEvent>();
