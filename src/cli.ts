#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { KNOWN_BROWSERS, resolveEndpoint } from './browsers.ts';
import { Cdp } from './cdp.ts';
import { DETECTORS } from './detectors.ts';
import { ARMS, openArm } from './modes.ts';
import { type ArmResult, toMarkdown } from './report.ts';
import { visit } from './visit.ts';

const USAGE = `Usage: browser-mode-probe [options]

  --source <name|ws>   Browser to attach to and copy cookies from: chrome, aside, or ws://...
                       (default: chrome)
  --binary <path>      Browser binary for copy and fresh arms (default: Google Chrome)
  --arms <ids>         Comma-separated arm ids (default: all)
  --out <dir>          Output directory (default: results/<timestamp>)

Arms:
${ARMS.map((a) => `  ${a.id.padEnd(16)} ${a.summary}`).join('\n')}
`;

const APPROVAL_TIMEOUT_MS = 120_000;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: 'chrome' },
      binary: { type: 'string', default: KNOWN_BROWSERS.chrome!.binary },
      arms: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const wanted = values.arms?.split(',').map((s) => s.trim());
  const arms = wanted ? ARMS.filter((a) => wanted.includes(a.id)) : ARMS;
  const unknown = wanted?.filter((id) => !ARMS.some((a) => a.id === id)) ?? [];
  if (unknown.length) throw new Error(`Unknown arm: ${unknown.join(', ')}`);

  const out = values.out ?? join('results', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(join(out, 'screenshots'), { recursive: true });

  let sourceCdp: Promise<Cdp> | undefined;
  const source = () =>
    (sourceCdp ??= resolveEndpoint(values.source).then((ws) => {
      console.log(`  connecting to ${values.source}; approve the remote debugging prompt if shown`);
      return Cdp.connect(ws, APPROVAL_TIMEOUT_MS);
    }));

  const results: ArmResult[] = [];
  for (const arm of arms) {
    console.log(`> ${arm.id}`);
    const result: ArmResult = { arm: arm.id, summary: arm.summary, notes: {}, detectors: {} };
    results.push(result);
    let session;
    try {
      session = await openArm(arm, { source, bridge: values.source, binary: values.binary });
    } catch (error) {
      for (const d of DETECTORS) result.detectors[d.id] = { error: message(error) };
      console.log(`  failed to open: ${message(error)}`);
      continue;
    }
    try {
      result.notes = session.notes;
      for (const detector of DETECTORS) {
        try {
          const page = await visit(session.cdp, detector.url, detector.extract, arm.footprint);
          result.detectors[detector.id] = detector.parse(page.data);
          await writeFile(
            join(out, 'screenshots', `${arm.id}-${detector.id}.png`),
            page.screenshot,
          );
          console.log(`  ${detector.id}: ok`);
        } catch (error) {
          result.detectors[detector.id] = { error: message(error) };
          console.log(`  ${detector.id}: ${message(error)}`);
        }
      }
    } finally {
      await session.close();
    }
  }

  if (sourceCdp) await (await sourceCdp.catch(() => undefined))?.close();

  const summary = toMarkdown(
    results,
    DETECTORS.map((d) => d.id),
  );
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  await writeFile(join(out, 'summary.md'), summary);
  console.log(`\n${summary}\nWrote ${out}`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(message(error));
  process.exit(1);
});
