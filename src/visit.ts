// Open one page in a background tab, read it, screenshot it, close the tab.

import type { CdpClient } from './cdp.ts';

/**
 * minimal: no CDP domains enabled; page is read from an isolated world.
 * typical: Page/DOM/Runtime/Network enabled and page read from the main world,
 *          the way most automation libraries and harnesses do it.
 */
export type Footprint = 'minimal' | 'typical';

const TYPICAL_DOMAINS = ['Page', 'DOM', 'Runtime', 'Network'];
const LOAD_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3_000;

export interface Visit {
  data: unknown;
  screenshot: Buffer;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function visit(
  cdp: CdpClient,
  url: string,
  expression: string,
  footprint: Footprint,
): Promise<Visit> {
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
    background: true,
  });
  try {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    if (footprint === 'typical') {
      await Promise.all(TYPICAL_DOMAINS.map((d) => cdp.send(`${d}.enable`, {}, sessionId)));
    }
    const evaluate = async (expr: string) => {
      const contextId = footprint === 'minimal' ? await isolatedWorld(cdp, sessionId) : undefined;
      const { result, exceptionDetails } = await cdp.send(
        'Runtime.evaluate',
        { expression: expr, contextId, returnByValue: true },
        sessionId,
      );
      if (exceptionDetails) throw new Error(`Page script failed: ${exceptionDetails.text}`);
      return result.value as unknown;
    };

    await cdp.send('Page.navigate', { url }, sessionId);
    await waitForLoad(evaluate, url);
    await sleep(SETTLE_MS);

    const data = await evaluate(expression);
    const shot = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true },
      sessionId,
    );
    return { data, screenshot: Buffer.from(shot.data, 'base64') };
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

async function isolatedWorld(cdp: CdpClient, sessionId: string): Promise<number> {
  const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
  const { executionContextId } = await cdp.send(
    'Page.createIsolatedWorld',
    { frameId: frameTree.frame.id, worldName: 'browser-mode-probe' },
    sessionId,
  );
  return executionContextId;
}

async function waitForLoad(
  evaluate: (expr: string) => Promise<unknown>,
  url: string,
): Promise<void> {
  const origin = new URL(url).origin;
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      `location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`,
    ).catch(() => false);
    if (ready === true) return;
    await sleep(250);
  }
  throw new Error(`Timed out loading ${url}`);
}
