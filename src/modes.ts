// The ways an agent can get a browser, as runnable arms.

import { type DebugPort, launchFresh } from './browsers.ts';
import { Cdp } from './cdp.ts';
import type { Footprint } from './visit.ts';

export type Mode = 'attach' | 'copy' | 'fresh';

export interface Arm {
  id: string;
  mode: Mode;
  footprint: Footprint;
  headless: boolean;
  /** How a launched browser picks its debugging port. Ignored for attach. */
  debugPort: DebugPort;
  summary: string;
}

export const ARMS: Arm[] = [
  {
    id: 'attach-minimal',
    mode: 'attach',
    footprint: 'minimal',
    headless: false,
    debugPort: 'fixed',
    summary: 'Your running browser over CDP, minimal footprint',
  },
  {
    id: 'attach-typical',
    mode: 'attach',
    footprint: 'typical',
    headless: false,
    debugPort: 'fixed',
    summary: 'Your running browser over CDP, typical harness footprint',
  },
  {
    id: 'copy',
    mode: 'copy',
    footprint: 'minimal',
    headless: false,
    debugPort: 'fixed',
    summary: "Fresh profile seeded with your browser's cookies",
  },
  {
    id: 'fresh-headful',
    mode: 'fresh',
    footprint: 'minimal',
    headless: false,
    debugPort: 'fixed',
    summary: 'Fresh profile, visible window',
  },
  {
    id: 'fresh-headless',
    mode: 'fresh',
    footprint: 'minimal',
    headless: true,
    debugPort: 'fixed',
    summary: 'Fresh profile, headless',
  },
  {
    id: 'fresh-port0',
    mode: 'fresh',
    footprint: 'minimal',
    headless: true,
    debugPort: 'zero',
    summary: 'Fresh profile, headless, --remote-debugging-port=0',
  },
];

export interface ArmSession {
  cdp: Cdp;
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
  /** Binary used for copy and fresh arms. */
  binary: string;
}

export async function openArm(arm: Arm, options: ArmOptions): Promise<ArmSession> {
  if (arm.mode === 'attach') {
    return { cdp: await options.source(), notes: {}, close: async () => {} };
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
