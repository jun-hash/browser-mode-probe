// Run results and their Markdown summary.

import type { Check } from './detectors.ts';

export interface RunMeta {
  date: string;
  os: string;
  node: string;
  source: string;
}

export interface ArmResult {
  arm: string;
  summary: string;
  /** Browser product as reported over CDP, e.g. `Chrome/154.0.8037.92`. */
  browser?: string;
  /** Counts only. Cookie names and values are never recorded. */
  notes: Record<string, number>;
  detectors: Record<string, Check[] | { error: string }>;
}

export function toMarkdown(meta: RunMeta, results: ArmResult[], detectorIds: string[]): string {
  const header = ['arm', 'browser', ...detectorIds, 'notes'];
  const lines = [
    `${meta.date} · ${meta.os} · Node ${meta.node} · source: ${meta.source}`,
    '',
    'Cells: failed checks / scored checks.',
    '',
    row(header),
    row(header.map(() => '---')),
  ];
  for (const result of results) {
    const cells = detectorIds.map((id) => describe(result.detectors[id]));
    const notes = Object.entries(result.notes).map(([key, value]) => `${key}=${value}`);
    lines.push(row([`\`${result.arm}\``, result.browser ?? '?', ...cells, notes.join(', ')]));
  }
  return lines.join('\n') + '\n';
}

function describe(outcome: Check[] | { error: string } | undefined): string {
  if (!outcome) return 'n/a';
  if ('error' in outcome) return `error: ${outcome.error}`;
  const failed = outcome.filter((c) => c.status === 'fail').map((c) => c.name);
  const scored = outcome.filter((c) => c.status !== 'info').length;
  const tally = `${failed.length} / ${scored}`;
  return failed.length ? `${tally}: ${failed.join(', ')}` : tally;
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}
