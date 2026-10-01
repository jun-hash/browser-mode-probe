// The ways an agent can get a browser, as runnable arms.

import { type DebugPort, launchFresh } from './browsers.ts';
import { Bridge } from './bridge.ts';
import { Cdp, type CdpClient } from './cdp.ts';
import type { Footprint } from './visit.ts';

export type Mode = 'attach' | 'extension' | 'copy' | 'fresh';

export interface Arm {
  id: string;
  mode: Mode;
  summary: string;
  footprint: Footprint;
  headless: boolean;
  /** How a launched browser picks its debugging port. Only for copy and fresh. */
  debugPort: DebugPort;
}

const arm = (id: string, mode: Mode, summary: string, overrides: Partial<Arm> = {}): Arm => ({
  id,
  mode,
  summary,
  footprint: 'minimal',
  headless: false,
  debugPort: 'fixed',
  ...overrides,
});

export const ARMS: Arm[] = [
  arm('attach-minimal', 'attach', 'Your browser over CDP. No domains enabled, isolated world.'),
  arm(
    'attach-typical',
    'attach',
    'Your browser over CDP. Page/DOM/Runtime/Network on, main world.',
    {
      footprint: 'typical',
    },
  ),
  arm('extension', 'extension', 'Your browser through the extension in bridge/.'),
  arm('copy', 'copy', 'Fresh profile seeded with your cookies.'),
  arm('fresh-headful', 'fresh', 'Fresh profile, visible window.'),
  arm('fresh-headless', 'fresh', 'Fresh profile, --headless=new.', { headless: true }),
  arm('fresh-port0', 'fresh', 'Fresh profile, headless, --remote-debugging-port=0.', {
    headless: true,
    debugPort: 'zero',
  }),
];

export interface ArmSession {
  cdp: CdpClient;
  /** Counts only. Cookie names and values are never recorded. */
  notes: Record<string, number>;
  close(): Promise<void>;
}

export interface ArmOptions {
  /**
   * Shared connection to the user's browser, opened at most once per run.
   * Browsers with remote debugging turned on in settings ask the user to
   * approve each new connection, so reconnecting per arm means a dialog per arm.
   */
  source: () => Promise<Cdp>;
  /** Browser whose bridge socket the extension arm uses: chrome or aside. */
  bridge: string;
  /** Binary used for copy and fresh arms. */
  binary: string;
}

export async function openArm(arm: Arm, options: ArmOptions): Promise<ArmSession> {
  if (arm.mode === 'attach') {
    return { cdp: await options.source(), notes: {}, close: async () => {} };
  }
  if (arm.mode === 'extension') {
    const cdp = await Bridge.connect(options.bridge);
    return { cdp, notes: {}, close: () => cdp.close() };
  }

  const browser = await launchFresh(options.binary, arm.headless, arm.debugPort);
  let cdp: Cdp | undefined;
  try {
    cdp = await Cdp.connect(browser.ws);
    const notes = arm.mode === 'copy' ? await copyCookies(await options.source(), cdp) : {};
    const opened = cdp;
    return {
      cdp: opened,
      notes,
      close: async () => {
        await opened.close();
        await browser.close();
      },
    };
  } catch (error) {
    await cdp?.close();
    await browser.close();
    throw error;
  }
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: string;
  priority?: string;
  sourceScheme?: string;
  sourcePort?: number;
  partitionKey?: object;
  partitionKeyOpaque?: boolean;
}

/** Read every cookie from the live source browser and write them into the target. */
async function copyCookies(source: Cdp, target: Cdp): Promise<Record<string, number>> {
  const { cookies }: { cookies: CdpCookie[] } = await source.send('Storage.getCookies');

  const params = cookies.filter((c) => !c.partitionKeyOpaque).map(toCookieParam);
  let rejected = 0;
  try {
    await target.send('Storage.setCookies', { cookies: params });
  } catch {
    // One bad cookie fails the whole batch. Retry one by one to count rejects.
    for (const cookie of params) {
      await target.send('Storage.setCookies', { cookies: [cookie] }).catch(() => rejected++);
    }
  }

  const { cookies: copied } = await target.send('Storage.getCookies');
  return {
    sourceCookies: cookies.length,
    sourceDomains: new Set(cookies.map((c) => c.domain)).size,
    copiedCookies: copied.length,
    rejectedCookies: rejected,
    skippedOpaquePartition: cookies.length - params.length,
  };
}

function toCookieParam(c: CdpCookie): object {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    priority: c.priority,
    sourceScheme: c.sourceScheme,
    sourcePort: c.sourcePort,
    partitionKey: c.partitionKey,
    expires: c.session ? undefined : c.expires,
  };
}
