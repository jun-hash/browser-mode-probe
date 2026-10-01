// Maps CDP requests onto chrome.tabs and chrome.debugger.
// Target ids and session ids are both the tab id, as a string.

const PROTOCOL_VERSION = '1.3';

/**
 * @typedef {{ method: string, params?: Record<string, any>, sessionId?: string }} Request
 * @typedef {{
 *   tabs: {
 *     query(query: object): Promise<Array<{ id?: number, title?: string, url?: string }>>,
 *     create(options: { url: string, active: boolean }): Promise<{ id?: number }>,
 *     remove(tabId: number): Promise<unknown>,
 *   },
 *   debugger: {
 *     attach(target: { tabId: number }, version: string): Promise<unknown>,
 *     detach(target: { tabId: number }): Promise<unknown>,
 *     sendCommand(target: { tabId: number }, method: string, params: Record<string, any>): Promise<object | undefined>,
 *   },
 * }} ChromeApi The parts of `chrome` the router uses.
 * @param {ChromeApi} api
 * @param {string} userAgent
 * @returns {(request: Request) => Promise<object>}
 */
export function createRouter(api, userAgent) {
  /** @type {Record<string, (params: Record<string, any>) => Promise<object>>} */
  const browserMethods = {
    'Browser.getVersion': async () => ({
      product: userAgent.match(/Chrome\/\S+/)?.[0] ?? 'unknown',
      userAgent,
    }),
    'Target.getTargets': async () => {
      const tabs = await api.tabs.query({});
      return { targetInfos: tabs.map(toTargetInfo) };
    },
    'Target.createTarget': async ({ url = 'about:blank', background = false }) => {
      const tab = await api.tabs.create({ url, active: !background });
      return { targetId: String(tab.id) };
    },
    'Target.attachToTarget': async ({ targetId }) => {
      await api.debugger.attach({ tabId: Number(targetId) }, PROTOCOL_VERSION);
      return { sessionId: String(targetId) };
    },
    'Target.detachFromTarget': async ({ sessionId }) => {
      await api.debugger.detach({ tabId: Number(sessionId) });
      return {};
    },
    'Target.closeTarget': async ({ targetId }) => {
      await api.tabs.remove(Number(targetId));
      return { success: true };
    },
  };

  return async ({ method, params = {}, sessionId }) => {
    if (sessionId) {
      const result = await api.debugger.sendCommand({ tabId: Number(sessionId) }, method, params);
      return result ?? {};
    }
    const handler = browserMethods[method];
    if (!handler) throw new Error(`${method} needs a sessionId`);
    return handler(params);
  };
}

/** @param {{ id?: number, title?: string, url?: string }} tab */
function toTargetInfo(tab) {
  return { targetId: String(tab.id), type: 'page', title: tab.title ?? '', url: tab.url ?? '' };
}
