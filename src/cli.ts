#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { release, type } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { KNOWN_BROWSERS, resolveEndpoint } from './browsers.ts';
import { Cdp } from './cdp.ts';
import { DETECTORS } from './detectors.ts';
import { type Arm, type ArmOptions, ARMS, openArm } from './modes.ts';
import { type ArmResult, type RunMeta, toMarkdown } from './report.ts';
import { visit } from './visit.ts';

const USAGE = `Usage: node src/cli.ts [options]

  --source <name|ws>  Your browser: chrome, aside, or a ws:// CDP URL (default: chrome)
  --binary <path>     Browser launched by copy and fresh arms (default: Google Chrome)
  --arms <ids>        Comma-separated arm ids (default: all)
  --out <dir>         Output directory (default: results/<timestamp>)

Arms:
${ARMS.map((a) => `  ${a.id.padEnd(15)} ${a.summary}`).join('\n')}
`;

/** Time the user has to click Allow on the remote debugging prompt. */
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

  const arms = selectArms(values.arms);
  const out = values.out ?? join('results', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(join(out, 'screenshots'), { recursive: true });

  // One connection to the user's browser per run, so its approval prompt appears at most once.
  let sourceCdp: Promise<Cdp> | undefined;
  const source = () =>
    (sourceCdp ??= resolveEndpoint(values.source).then((ws) => {
      console.log(`  connecting to ${values.source}. Click Allow if the browser asks.`);
      return Cdp.connect(ws, APPROVAL_TIMEOUT_MS);
    }));
  const options: ArmOptions = { source, bridge: values.source, binary: values.binary };

  const results: ArmResult[] = [];
  try {
    for (const arm of arms) results.push(await runArm(arm, options, out));
  } finally {
    await (await sourceCdp?.catch(() => undefined))?.close();
  }

  const meta: RunMeta = {
    date: new Date().toISOString().slice(0, 10),
    os: `${type()} ${release()}`,
    node: process.versions.node,
    source: values.source,
  };
  const summary = toMarkdown(
    meta,
    results,
    DETECTORS.map((d) => d.id),
  );
  await writeFile(join(out, 'results.json'), JSON.stringify({ meta, results }, null, 2) + '\n');
  await writeFile(join(out, 'summary.md'), summary);
  console.log(`\n${summary}\nWrote ${out}`);
}

function selectArms(list: string | undefined): Arm[] {
  if (!list) return ARMS;
  const ids = list.split(',').map((id) => id.trim());
  const unknown = ids.filter((id) => !ARMS.some((a) => a.id === id));
  if (unknown.length) throw new Error(`Unknown arm: ${unknown.join(', ')}. See --help.`);
  return ARMS.filter((a) => ids.includes(a.id));
}

async function runArm(arm: Arm, options: ArmOptions, out: string): Promise<ArmResult> {
  console.log(`> ${arm.id}`);
  const result: ArmResult = { arm: arm.id, summary: arm.summary, notes: {}, detectors: {} };
  let session;
  try {
    session = await openArm(arm, options);
  } catch (error) {
    for (const d of DETECTORS) result.detectors[d.id] = { error: message(error) };
    console.log(`  could not open: ${message(error)}`);
    return result;
  }
  try {
    result.notes = session.notes;
    result.browser = (await session.cdp.send('Browser.getVersion').catch(() => undefined))?.product;
    for (const detector of DETECTORS) {
      try {
        const page = await visit(session.cdp, detector.url, detector.extract, arm.footprint);
        result.detectors[detector.id] = detector.parse(page.data);
        await writeFile(join(out, 'screenshots', `${arm.id}-${detector.id}.png`), page.screenshot);
        console.log(`  ${detector.id}: done`);
      } catch (error) {
        result.detectors[detector.id] = { error: message(error) };
        console.log(`  ${detector.id}: ${message(error)}`);
      }
    }
  } finally {
    await session.close();
  }
  return result;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(message(error));
  process.exit(1);
});
