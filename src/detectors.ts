// Public bot-detection pages, and how to read their verdicts.

export type Status = 'pass' | 'fail' | 'warn' | 'info';

export interface Check {
  name: string;
  status: Status;
}

export interface Detector {
  id: string;
  url: string;
  /** JS expression evaluated in the page. Must return JSON-serializable data. */
  extract: string;
  parse(raw: unknown): Check[];
}

type Rows = string[][];

const CELL_TEXT = `c.innerText.replace(/\\s+/g, ' ').trim()`;
const ROWS = `[...document.querySelectorAll('tr')].map((tr) => [...tr.cells].map((c) => ${CELL_TEXT}))`;

const EMOJI_STATUS: Array<[string, Status]> = [
  ['🟢', 'pass'],
  ['🔴', 'fail'],
  ['🟡', 'warn'],
  ['⚪', 'info'],
];

export function parseRebrowser(rows: Rows): Check[] {
  const checks: Check[] = [];
  for (const [first] of rows) {
    const status = EMOJI_STATUS.find(([emoji]) => first?.startsWith(emoji))?.[1];
    const name = first?.match(/([A-Za-z]\w+)/)?.[1];
    if (status && name) checks.push({ name, status });
  }
  return checks;
}

const SANNY_CLASS_STATUS: Array<[string, Status]> = [
  ['passed', 'pass'],
  ['failed', 'fail'],
  ['warn', 'warn'],
];

const SANNY_TEXT_STATUS: Record<string, Status> = { ok: 'pass', FAIL: 'fail', WARN: 'warn' };

export function parseSannysoft(rows: Array<{ cells: string[]; resultClass: string }>): Check[] {
  const checks: Check[] = [];
  for (const { cells, resultClass } of rows) {
    const name = cells[0];
    if (!name) continue;
    const byClass = SANNY_CLASS_STATUS.find(([cls]) => resultClass.includes(cls))?.[1];
    const byText = SANNY_TEXT_STATUS[cells[1] ?? ''];
    const status = byClass ?? byText;
    if (status) checks.push({ name, status });
  }
  return checks;
}

export const DETECTORS: Detector[] = [
  {
    id: 'rebrowser',
    url: 'https://bot-detector.rebrowser.net/',
    extract: ROWS,
    parse: (raw) => parseRebrowser(raw as Rows),
  },
  {
    id: 'sannysoft',
    url: 'https://bot.sannysoft.com/',
    extract: `[...document.querySelectorAll('tr')].map((tr) => ({
      cells: [...tr.cells].map((c) => ${CELL_TEXT}),
      resultClass: tr.querySelector('td.result')?.className ?? '',
    }))`,
    parse: (raw) => parseSannysoft(raw as Array<{ cells: string[]; resultClass: string }>),
  },
];
