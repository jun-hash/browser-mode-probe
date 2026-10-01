# browser-mode-probe

How do bot detectors see an agent's browser? This runs seven ways of getting one through the same
public detectors and compares what each one gives away.

## Results

2026-10-01 · macOS 26 · your browser: Aside (Chromium 153) · launched browser: Chrome 154

Cells are failed checks over scored checks.

| Arm              | How the agent gets a browser                         | [rebrowser] | [sannysoft] |
| ---------------- | ---------------------------------------------------- | ----------- | ----------- |
| `attach-minimal` | Your browser over CDP                                | 1 / 6 ¹     | 0 / 28      |
| `attach-typical` | Your browser over CDP, the way most harnesses use it | 1 / 6 ¹     | 0 / 28      |
| `extension`      | Your browser through an extension                    | 1 / 6 ¹     | 0 / 28      |
| `copy`           | A new profile with your cookies                      | 0 / 6       | 0 / 28      |
| `fresh-headful`  | A new profile                                        | 0 / 6       | 0 / 28      |
| `fresh-headless` | A new profile, headless                              | 0 / 6       | **3 / 28**  |
| `fresh-port0`    | A new profile, headless, debugging port `0`          | **1 / 6**   | **4 / 28**  |

¹ Aside reports its brand as `Chromium`, not `Google Chrome`. Any Aside session shows this, with or
without automation.

[rebrowser]: https://bot-detector.rebrowser.net/
[sannysoft]: https://bot.sannysoft.com/

## Findings

1. **Headless announces itself.** Its user agent contains `HeadlessChrome`.
2. **`--remote-debugging-port=0` sets `navigator.webdriver` to true.** A fixed port does not. This
   held in 8 of 8 launches of Chrome 154, headless and headful.
3. **Static detectors cannot separate attach, extension, copy and a clean headful launch.**
4. **CDP footprint went unseen.** Enabling `Runtime` and reading from the main world was not
   detected.
5. **`copy` moved every cookie (3,914 of 3,914), and only cookies.** localStorage, IndexedDB,
   sessionStorage, passkeys and device-bound cookies stay behind. Sites that keep sign-in state there
   look signed out.

## What this does not measure

These detectors read the browser once. Real bot defenses also weigh:

- **Profile reputation**: cookie age, history, sign-in record.
- **Network**: IP reputation and TLS fingerprint. Every arm here shares one home IP.
- **Behavior**: pointer paths, typing rhythm, timing.

## Reproduce

Needs macOS, Node 22.18+ and Google Chrome. No runtime dependencies.

1. In your browser, open `chrome://inspect/#remote-debugging` and turn remote debugging on.
2. Run:

   ```sh
   git clone https://github.com/jun-hash/browser-mode-probe && cd browser-mode-probe
   npm run probe -- --source chrome
   ```

3. Click **Allow** once when the browser asks. The run takes about five minutes.

Results go to `results/<time>/`: `summary.md`, `results.json` and one screenshot per page. Pass
`--arms copy,fresh-headless` to run some arms, or `--source aside` to use Aside. See `--help`.

### Extension arm

The `extension` arm needs the extension in `bridge/`. Set it up once:

```sh
npm run bridge:install
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select
`bridge/extension`. After that, the arm connects without a prompt.

```
probe ──▶ Unix socket ──▶ native host ──▶ extension ──▶ chrome.debugger ──▶ tab
```

Remove it with `npm run bridge:uninstall` and by removing the extension.

## Extend

- **Detector**: add an entry to `DETECTORS` in `src/detectors.ts`: a URL, a page script that
  returns data, and a parser that turns it into pass or fail checks.
- **Arm**: add an entry to `ARMS` in `src/modes.ts`.

| Path               | What it does                                           |
| ------------------ | ------------------------------------------------------ |
| `src/cli.ts`       | Runs arms, writes results                              |
| `src/modes.ts`     | Arms, and how each one opens a browser                 |
| `src/visit.ts`     | Opens a page in a background tab, reads it, closes it  |
| `src/detectors.ts` | Detector pages and their parsers                       |
| `bridge/`          | The extension, its native host, and the install script |

## Privacy

Attach and extension arms open and close their own background tabs and never touch yours. Copied
cookies stay in memory and in a temporary profile that is deleted when the arm ends, including on
Ctrl-C. Results record cookie counts, never names or values.

## Development

```sh
npm install
npm test
npm run typecheck
```

MIT license.
