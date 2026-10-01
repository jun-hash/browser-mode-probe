# browser-mode-probe

An agent can get a browser in a few ways. It can attach to yours over CDP, copy your cookies into
a fresh one, or launch a clean one. This tool runs each way against the same public bot detectors
and reports what they catch.

## Result

macOS, 2026-10-01. Source browser: Aside (Chromium 153). Launched browser: Google Chrome 154.
Cells show failed checks out of scored checks.

| arm              | rebrowser                 | sannysoft                                  |
| ---------------- | ------------------------- | ------------------------------------------ |
| `attach-minimal` | 1 / 6: useragent¹         | 0 / 28                                     |
| `attach-typical` | 1 / 6: useragent¹         | 0 / 28                                     |
| `copy`           | 0 / 6                     | 0 / 28                                     |
| `fresh-headful`  | 0 / 6                     | 0 / 28                                     |
| `fresh-headless` | 0 / 6                     | 3 / 28: User Agent, HEADCHR_UA, CHR_MEMORY |
| `fresh-port0`    | 1 / 6: navigatorWebdriver | 4 / 28: adds WebDriver                     |

¹ Aside reports the brand `Chromium`, not `Google Chrome`. This is a property of the browser, not of
automation. Attaching to Chrome does not trigger it.

`copy` moved 3,916 of 3,916 cookies across 1,055 domains.

## Findings

1. **Headless gives itself away.** The user agent says `HeadlessChrome`.
2. **`--remote-debugging-port=0` sets `navigator.webdriver = true`.** A fixed port does not. This
   held in 8 of 8 launches, headless and headful, on Chrome 154.
3. **These detectors cannot tell attach, copy, and a clean headful launch apart.** Static checks are
   not where those modes differ. See below.
4. **CDP footprint did not matter here.** Enabling `Runtime` and reading from the main world was
   not detected on Chromium 153.

## What this does not measure

Static detectors read the browser once. Real bot defenses also weigh:

- **Profile reputation:** cookie age, history, sign-in record.
- **Network:** IP reputation and TLS fingerprint. All arms here share one home IP.
- **Behavior:** pointer paths, typing rhythm, timing.

`copy` moves cookies only. It does not move localStorage, IndexedDB, sessionStorage, passkeys or
device-bound cookies. Sites that keep sign-in state there will appear signed out.

## Arms

| arm              | browser                                  | CDP footprint                                      |
| ---------------- | ---------------------------------------- | -------------------------------------------------- |
| `attach-minimal` | your running browser                     | no domains enabled, reads from an isolated world   |
| `attach-typical` | your running browser                     | `Page`, `DOM`, `Runtime`, `Network` on, main world |
| `copy`           | fresh profile with your cookies, headful | minimal                                            |
| `fresh-headful`  | fresh profile, headful                   | minimal                                            |
| `fresh-headless` | fresh profile, `--headless=new`          | minimal                                            |
| `fresh-port0`    | as `fresh-headless`, port 0              | minimal                                            |

## Usage

Requires Node 22.18+ and a Chromium browser with remote debugging turned on
(`chrome://inspect/#remote-debugging`).

```sh
git clone https://github.com/jun-hash/browser-mode-probe && cd browser-mode-probe
node src/cli.ts --source chrome          # or --source aside, or --source ws://...
node src/cli.ts --arms copy,fresh-headless
```

The browser asks you to approve the connection once per run. Output goes to `results/<time>/`:
`summary.md`, `results.json` and screenshots.

Add a detector by appending to `DETECTORS` in `src/detectors.ts`. Add an arm in `src/modes.ts`.

## Privacy

Cookies stay in memory and in a temporary profile that is deleted when the arm ends, including on
Ctrl-C. Results record cookie counts only, never names or values. Attach arms open and close their
own background tabs. They do not touch yours.

## Development

```sh
npm install
npm test
npm run typecheck
```

MIT license.
