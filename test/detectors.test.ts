import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRebrowser, parseSannysoft } from '../src/detectors.ts';
import { toMarkdown } from '../src/report.ts';

test('parseRebrowser maps status emoji and skips header and detail rows', () => {
  const rows = [
    ['Test name', 'Time since load', 'Notes'],
    ['🟢 runtimeEnableLeak', '1.8 ms', 'No leak detected.'],
    ['🔴 useragent', '9.3 ms', 'Google Chrome is not presented'],
    ['⚪️ dummyFn', '0.9 ms', 'Call window.dummyFn()'],
    ['{ "width": 1920 }'],
  ];
  assert.deepEqual(parseRebrowser(rows), [
    { name: 'runtimeEnableLeak', status: 'pass' },
    { name: 'useragent', status: 'fail' },
    { name: 'dummyFn', status: 'info' },
  ]);
});

test('parseSannysoft reads result classes first, then ok/FAIL/WARN text', () => {
  const rows = [
    { cells: ['Test Name', 'Result'], resultClass: '' },
    { cells: ['WebDriver(New)', 'missing (passed)'], resultClass: 'passed result' },
    { cells: ['Chrome(New)', 'missing'], resultClass: 'failed result' },
    { cells: ['HEADCHR_UA', 'FAIL', ''], resultClass: '' },
    { cells: ['HEADCHR_PLUGINS', 'ok', ''], resultClass: '' },
    { cells: ['navigator.plugins', '{"0":{}}'], resultClass: '' },
  ];
  assert.deepEqual(parseSannysoft(rows), [
    { name: 'WebDriver(New)', status: 'pass' },
    { name: 'Chrome(New)', status: 'fail' },
    { name: 'HEADCHR_UA', status: 'fail' },
    { name: 'HEADCHR_PLUGINS', status: 'pass' },
  ]);
});

test('toMarkdown counts failures over scored checks and shows errors', () => {
  const md = toMarkdown(
    [
      {
        arm: 'fresh-headless',
        summary: '',
        notes: {},
        detectors: {
          a: [
            { name: 'x', status: 'fail' },
            { name: 'y', status: 'pass' },
            { name: 'z', status: 'info' },
          ],
          b: { error: 'boom' },
        },
      },
    ],
    ['a', 'b'],
  );
  assert.match(md, /\| `fresh-headless` \| 1 \/ 2: x \| error: boom \|/);
});
