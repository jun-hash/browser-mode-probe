import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// @ts-ignore: plain JS module shared with the extension
import { createRouter } from '../bridge/extension/router.js';
import { encodeFrame, FrameDecoder, LineDecoder } from '../bridge/host/framing.ts';
import { EXTENSION_ID } from '../bridge/paths.ts';

test('frames survive split and merged chunks', () => {
  const seen: unknown[] = [];
  const decoder = new FrameDecoder((m) => seen.push(m));
  const bytes = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 'é' })]);
  decoder.push(bytes.subarray(0, 3));
  decoder.push(bytes.subarray(3, 12));
  decoder.push(bytes.subarray(12));
  assert.deepEqual(seen, [{ a: 1 }, { b: 'é' }]);
});

test('lines survive split chunks', () => {
  const seen: unknown[] = [];
  const decoder = new LineDecoder((m) => seen.push(m));
  decoder.push('{"a":1}\n{"b"');
  decoder.push(':2}\n');
  assert.deepEqual(seen, [{ a: 1 }, { b: 2 }]);
});

test('EXTENSION_ID matches the key in the manifest', () => {
  const { key } = JSON.parse(readFileSync('bridge/extension/manifest.json', 'utf8'));
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  assert.equal(id, EXTENSION_ID);
});

test('router maps Target methods to tabs and session calls to the debugger', async () => {
  const calls: unknown[] = [];
  const api = {
    tabs: {
      create: async (o: object) => (calls.push(['create', o]), { id: 7 }),
      remove: async (id: number) => calls.push(['remove', id]),
      query: async () => [{ id: 7, title: 't', url: 'u' }],
    },
    debugger: {
      attach: async (t: object, v: string) => calls.push(['attach', t, v]),
      detach: async (t: object) => calls.push(['detach', t]),
      sendCommand: async (t: object, m: string, p: object) => (
        calls.push(['cmd', t, m, p]),
        undefined
      ),
    },
  };
  const route = createRouter(api, 'Mozilla/5.0 Chrome/153.0.1 Safari/537.36');

  assert.deepEqual(
    await route({ method: 'Target.createTarget', params: { url: 'x', background: true } }),
    {
      targetId: '7',
    },
  );
  assert.deepEqual(await route({ method: 'Target.attachToTarget', params: { targetId: '7' } }), {
    sessionId: '7',
  });
  assert.deepEqual(
    await route({ method: 'Page.navigate', params: { url: 'y' }, sessionId: '7' }),
    {},
  );
  assert.deepEqual(await route({ method: 'Target.getTargets' }), {
    targetInfos: [{ targetId: '7', type: 'page', title: 't', url: 'u' }],
  });
  assert.deepEqual(await route({ method: 'Browser.getVersion' }), {
    product: 'Chrome/153.0.1',
    userAgent: 'Mozilla/5.0 Chrome/153.0.1 Safari/537.36',
  });
  await assert.rejects(route({ method: 'Page.navigate' }), /needs a sessionId/);

  assert.deepEqual(calls, [
    ['create', { url: 'x', active: false }],
    ['attach', { tabId: 7 }, '1.3'],
    ['cmd', { tabId: 7 }, 'Page.navigate', { url: 'y' }],
  ]);
});
