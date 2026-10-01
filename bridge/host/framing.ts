// Native messaging frames (4-byte little-endian length + JSON) and newline-delimited JSON.

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);
  #onMessage: (message: unknown) => void;

  constructor(onMessage: (message: unknown) => void) {
    this.#onMessage = onMessage;
  }

  push(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (this.#buffer.length < 4 + length) return;
      const body = this.#buffer.subarray(4, 4 + length);
      this.#buffer = this.#buffer.subarray(4 + length);
      this.#onMessage(JSON.parse(body.toString('utf8')));
    }
  }
}

export class LineDecoder {
  #pending = '';
  #onMessage: (message: unknown) => void;

  constructor(onMessage: (message: unknown) => void) {
    this.#onMessage = onMessage;
  }

  push(chunk: Buffer | string): void {
    const lines = (this.#pending + chunk.toString()).split('\n');
    this.#pending = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) this.#onMessage(JSON.parse(line));
  }
}
