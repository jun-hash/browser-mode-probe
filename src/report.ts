// Turn run results into a Markdown table.

import type { Check } from './detectors.ts';

export interface ArmResult {
  arm: string;
  summary: string;
  notes: Record<string, number>;
  detectors: Record<string, Check[] | { error: string }>;
}

export function toMarkdown(results: ArmResult[], detectorIds: string[]): string {
  const header = ['arm', ...detectorIds.map((id) => `${id} (failed / checks)`), 'notes'];
  const lines = [row(header), row(header.map(() => '---'))];
  for (const result of results) {
    const cells = detectorIds.map((id) => describe(result.detectors[id]));
    lines.push(row([`\`${result.arm}\``, ...cells, describeNotes(result.notes)]));
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

function describeNotes(notes: Record<string, number>): string {
  return Object.entries(notes)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}
