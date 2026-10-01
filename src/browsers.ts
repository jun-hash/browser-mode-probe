// Find a running browser's CDP endpoint, or launch a throwaway one.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

interface KnownBrowser {
  userDataDir: string;
  binary: string;
}

const MAC_SUPPORT = join(homedir(), 'Library/Application Support');

export const KNOWN_BROWSERS: Record<string, KnownBrowser> = {
  chrome: {
    userDataDir: join(MAC_SUPPORT, 'Google/Chrome'),
    binary: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  },
  aside: {
    userDataDir: join(MAC_SUPPORT, 'Aside'),
    binary: '/Applications/Aside.app/Contents/MacOS/Aside',
  },
};

/** Resolve `chrome`, `aside`, or a raw `ws://` URL to a browser-level CDP WebSocket URL. */
export async function resolveEndpoint(source: string): Promise<string> {
  if (source.startsWith('ws://') || source.startsWith('wss://')) return source;
  const browser = KNOWN_BROWSERS[source];
  if (!browser) throw new Error(`Unknown browser "${source}". Use chrome, aside, or a ws:// URL.`);
  const file = join(browser.userDataDir, 'DevToolsActivePort');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`${source} has no DevToolsActivePort. Is it running with remote debugging on?`);
  }
  const [port, path] = text.trim().split('\n');
  return `ws://127.0.0.1:${port}${path}`;
}

export interface LaunchedBrowser {
  ws: string;
  close(): Promise<void>;
}

// Launched browsers still running. Closed on Ctrl-C so no temp profile is left behind.
const live = new Set<() => Promise<void>>();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void Promise.allSettled([...live].map((close) => close())).finally(() => process.exit(130));
  });
}

/**
 * fixed: pick a free port up front and pass it.
 * zero: pass port 0. Chrome 154 on macOS then reports navigator.webdriver = true.
 */
export type DebugPort = 'fixed' | 'zero';

/** Launch a browser on a fresh temporary profile. The profile is deleted on close. */
export async function launchFresh(
  binary: string,
  headless: boolean,
  debugPort: DebugPort,
): Promise<LaunchedBrowser> {
  const port = debugPort === 'zero' ? 0 : await freePort();
  const profile = await mkdtemp(join(tmpdir(), 'browser-mode-probe-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ];
  const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const close = async () => {
    live.delete(close);
    if (child.exitCode === null) child.kill();
    await exited;
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  };
  live.add(close);

  try {
    const ws = await new Promise<string>((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error(`Browser did not start: ${stderr}`)), 15_000);
      child.once('error', reject);
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match?.[1]) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    return { ws, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('No port')),
      );
    });
  });
}
