// CDP client for the extension bridge in bridge/. Newline-delimited JSON over a Unix socket.

import { connect, type Socket } from 'node:net';

import { LineDecoder } from '../bridge/host/framing.ts';
import { socketPath } from '../bridge/paths.ts';
import type { CdpClient } from './cdp.ts';

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Reply {
  id?: number;
  result?: any;
  error?: { message: string };
}

export class Bridge implements CdpClient {
  #socket: Socket;
  #nextId = 0;
  #pending = new Map<number, Pending>();

  private constructor(socket: Socket) {
    this.#socket = socket;
    const decoder = new LineDecoder((message) => this.#onReply(message as Reply));
    socket.on('data', (chunk) => decoder.push(chunk));
    socket.on('close', () => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Bridge closed'));
      }
      this.#pending.clear();
    });
  }

  static connect(browser: string): Promise<Bridge> {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath(browser));
      socket.once('connect', () => resolve(new Bridge(socket)));
      socket.once('error', () =>
        reject(new Error(`No bridge for ${browser}. See "Extension arm" in the README.`)),
      );
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

  #onReply(message: Reply): void {
    // CDP events carry no id. Arms only wait on replies.
    if (message.id === undefined) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }
}
