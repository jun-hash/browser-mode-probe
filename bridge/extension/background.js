import { createRouter } from './router.js';

const HOST = 'dev.junhash.browser_mode_probe';
const RECONNECT_MS = 5_000;

const route = createRouter(chrome, navigator.userAgent);

/** @type {chrome.runtime.Port | null} */
let port = null;

function connect() {
  if (port) return;
  const current = chrome.runtime.connectNative(HOST);
  port = current;
  current.onMessage.addListener(async (message) => {
    try {
      current.postMessage({ id: message.id, result: await route(message) });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      current.postMessage({ id: message.id, error: { message: text } });
    }
  });
  current.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, RECONNECT_MS);
  });
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  port?.postMessage({ method, params, sessionId: String(source.tabId) });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const sessionId = String(source.tabId);
  port?.postMessage({ method: 'Target.detachedFromTarget', params: { sessionId, reason } });
});

// Registering this wakes the service worker when the browser starts.
chrome.runtime.onStartup.addListener(connect);
connect();
