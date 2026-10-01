// Client for extension-cdp-bridge: CDP over a local Unix socket, relayed by a browser extension.
// https://github.com/jun-hash/extension-cdp-bridge

import { connect, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { CdpClient } from './cdp.ts';

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Bridge implements CdpClient {
  #socket: Socket;
  #nextId = 0;
  #pending = new Map<number, Pending>();
  #buffer = '';

  private constructor(socket: Socket) {
    this.#socket = socket;
    socket.on('data', (chunk) => this.#onData(chunk.toString()));
    socket.on('close', () => {
      for (const p of this.#pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Bridge closed'));
      }
      this.#pending.clear();
    });
  }

  static connect(browser: string): Promise<Bridge> {
    const path = join(homedir(), '.extension-cdp-bridge', `${browser}.sock`);
    return new Promise((resolve, reject) => {
      const socket = connect(path);
      socket.once('connect', () => resolve(new Bridge(socket)));
      socket.once('error', () => reject(new Error(`No extension-cdp-bridge socket at ${path}`)));
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
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.write(JSON.stringify({ id, method, params, sessionId }) + '\n');
    });
  }

  close(): Promise<void> {
    if (this.#socket.closed) return Promise.resolve();
    return new Promise((resolve) => this.#socket.end(resolve));
  }

  #onData(text: string): void {
    const lines = (this.#buffer + text).split('\n');
    this.#buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const pending = this.#pending.get(message.id);
      if (!pending) continue;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    }
  }
}
