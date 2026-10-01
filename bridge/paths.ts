import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOST_NAME = 'dev.junhash.browser_mode_probe';

/** Fixed by the `key` in extension/manifest.json. */
export const EXTENSION_ID = 'kjpelggklmmibelnbkjjohcofpndllhp';

export const BRIDGE_DIR = join(homedir(), '.browser-mode-probe');

/** One socket per browser, so Chrome and Aside can both run the bridge. */
export function socketPath(browser: string): string {
  return join(BRIDGE_DIR, `${browser}.sock`);
}
