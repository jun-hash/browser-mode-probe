// Register the native messaging host with Chrome and other Chromium browsers.
// Usage: node bridge/install.ts [--browser chrome|aside] [--uninstall]

import { existsSync } from 'node:fs';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BRIDGE_DIR, EXTENSION_ID, HOST_NAME } from './paths.ts';

const SUPPORT = join(homedir(), 'Library/Application Support');
const BROWSERS: Record<string, string> = {
  chrome: join(SUPPORT, 'Google/Chrome'),
  aside: join(SUPPORT, 'Aside'),
};

const HERE = resolve(import.meta.dirname);

const { values } = parseArgs({
  options: { browser: { type: 'string' }, uninstall: { type: 'boolean' } },
});

const targets = values.browser
  ? [values.browser]
  : Object.keys(BROWSERS).filter((b) => existsSync(BROWSERS[b]!));

for (const browser of targets) {
  const dataDir = BROWSERS[browser];
  if (!dataDir) throw new Error(`Unknown browser: ${browser}`);
  const manifestPath = join(dataDir, 'NativeMessagingHosts', `${HOST_NAME}.json`);
  const launcher = join(BRIDGE_DIR, `host-${browser}.sh`);

  if (values.uninstall) {
    await rm(manifestPath, { force: true });
    await rm(launcher, { force: true });
    console.log(`removed ${browser}`);
    continue;
  }

  // Browsers start native hosts with a minimal PATH, so pin the node binary.
  await mkdir(BRIDGE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(
    launcher,
    `#!/bin/sh\nBRIDGE_BROWSER=${browser} exec "${process.execPath}" "${join(HERE, 'host/host.ts')}"\n`,
  );
  await chmod(launcher, 0o755);

  await mkdir(join(dataDir, 'NativeMessagingHosts'), { recursive: true });
  const manifest = {
    name: HOST_NAME,
    description: 'browser-mode-probe bridge host',
    path: launcher,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`installed ${browser}: ${manifestPath}`);
}

if (!values.uninstall) {
  console.log(`\nNext: load ${join(HERE, 'extension')} as an unpacked extension.`);
}
