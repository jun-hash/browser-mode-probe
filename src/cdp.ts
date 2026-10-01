// Minimal Chrome DevTools Protocol client over the built-in WebSocket.

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Cdp {
  #ws: WebSocket;
  #nextId = 0;
  #pending = new Map<number, Pending>();

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener('message', (event) => this.#onMessage(String(event.data)));
    ws.addEventListener('close', () => this.#failAll(new Error('CDP connection closed')));
  }

  static connect(url: string, timeoutMs = 10_000): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`CDP connect timed out: ${url}`));
      }, timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`CDP connect failed: ${url}`));
      });
    });
  }

  send<T = any>(
    method: string,
    params: object = {},
    sessionId?: string,
    timeoutMs = 30_000,
  ): Promise<T> {
    const id = ++this.#nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  /** Resolves once the socket is fully closed, so the next connect is not refused. */
  close(): Promise<void> {
    if (this.#ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.#ws.addEventListener('close', () => resolve(), { once: true });
      this.#ws.close();
    });
  }

  #onMessage(data: string): void {
    const message = JSON.parse(data);
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
