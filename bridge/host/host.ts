// Native messaging host. The browser starts it when the extension connects.
// It relays between the extension (stdio) and local clients (a Unix socket).

import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';

import { BRIDGE_DIR, socketPath } from '../paths.ts';
import { encodeFrame, FrameDecoder, LineDecoder } from './framing.ts';

interface Client {
  socket: Socket;
  /** Sessions this client attached. Events for them go only to this client. */
  sessions: Set<string>;
}

interface Message {
  id?: number;
  method?: string;
  params?: any;
  sessionId?: string;
  result?: any;
  error?: { message: string };
}

const path = socketPath(process.env.BRIDGE_BROWSER ?? 'chrome');
const clients = new Set<Client>();
const pending = new Map<number, { client: Client; clientId: number; method?: string }>();
let nextId = 0;

const toExtension = (message: Message) => process.stdout.write(encodeFrame(message));
const toClient = (client: Client, message: Message) =>
  client.socket.write(JSON.stringify(message) + '\n');

function fromExtension(message: Message): void {
  if (message.id !== undefined) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (request.method === 'Target.attachToTarget' && message.result?.sessionId) {
      request.client.sessions.add(message.result.sessionId);
    }
    toClient(request.client, { ...message, id: request.clientId });
    return;
  }
  for (const client of clients) {
    if (message.sessionId && !client.sessions.has(message.sessionId)) continue;
    if (message.method === 'Target.detachedFromTarget') {
      if (!client.sessions.delete(message.params.sessionId)) continue;
    }
    toClient(client, message);
  }
}

function onClient(socket: Socket): void {
  const client: Client = { socket, sessions: new Set() };
  clients.add(client);
  const decoder = new LineDecoder((raw) => {
    const message = raw as Message;
    const id = ++nextId;
    pending.set(id, { client, clientId: message.id ?? 0, method: message.method });
    toExtension({ ...message, id });
  });
  socket.on('data', (chunk) => decoder.push(chunk));
  socket.on('error', () => socket.destroy());
  socket.on('close', () => {
    clients.delete(client);
    for (const [id, request] of pending) if (request.client === client) pending.delete(id);
    // Detach what this client left attached, which also removes the browser's debugging banner.
    for (const sessionId of client.sessions) {
      toExtension({ id: ++nextId, method: 'Target.detachFromTarget', params: { sessionId } });
    }
  });
}

mkdirSync(BRIDGE_DIR, { recursive: true, mode: 0o700 });
rmSync(path, { force: true });
const server = createServer(onClient).listen(path, () => chmodSync(path, 0o600));

const decoder = new FrameDecoder((message) => fromExtension(message as Message));
process.stdin.on('data', (chunk: Buffer) => decoder.push(chunk));
// The browser closes stdin when the extension disconnects or the browser quits.
process.stdin.on('end', () => {
  server.close();
  rmSync(path, { force: true });
  process.exit(0);
});
