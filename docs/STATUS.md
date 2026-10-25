# Current status

Updated 2026-10-25.

## Supported build

- `DTRACK.EXE`, SHA-256 `5b23cafb…ff2928`: Deathtrack 1.0 (1989) PC, with the one-byte copy-protection patch. Asset set: `src/data/manifest.json` (92 files).
- Display: EGA mode 0Dh (the adapter DOSBox detects).
- Sound: PC-speaker path (music and effects), rendered in the browser by an AudioWorklet from time-stamped PIT/port 61h changes. The browser test asserts non-silent output. Audio fidelity (speaker response) is APPROX and has not been compared with hardware or DOSBox output.
- Input: keyboard and mouse. Joystick is reported absent.

## Working playable route (browser, verified by `npm run verify:browser`)

1. Original assets are loaded from `game/`, or from the user's folder in production.
2. Dynamix / Activision intro and credits.
3. Enter → sign-up page: type a name, click **GO FOR IT!**.
4. Copy-protection quiz (this build accepts any answer).
5. Car dealer (**TAKE THIS ONE**).
6. Hub (**FULL CIRCUIT RUN**).
7. Circuit (**GO RACIN'**).
8. Race in Seattle: accelerate with Up, steer with Left/Right, fire with Space.

Demo mode (`?args=demo`) autoplays the shop screens and a full race, then returns to the menus.

## Verification

| Command | What it checks | Level |
| --- | --- | --- |
| `npm run verify` | asset identity (92 hashes); 100 unit/module tests; closed-loop race replay | routine/segment + closed-loop |
| `npm run verify:browser` | real Chrome: boot → menus → race with real keyboard/mouse; fails on errors, diagnostics or missed milestones | browser acceptance |
| `node scripts/replay-race.mjs <dir> 0 399 --strict` | the replay alone, with per-range diffs | closed-loop |
| `node scripts/run-headless.mjs --args demo --seconds 120` | independent runtime scenario with the port's own environment providers, plus screenshots | independent scenario (no reference comparison) |

`npm run verify` needs the local game files, and the scenario test needs the local capture `.local/captures/demo-race-start` (recipe in `docs/scenarios/demo-race-start.json`). If either is missing, it fails with a setup error.

## Verified scenarios

- **demo-race-start**: 400 DOSBox checkpoints from race start.
  - The port runs the race loop closed-loop from checkpoint 0. **All 399 following checkpoints match exactly**: conventional memory except the documented ISR/sound/stack exclusions, and all four EGA planes.
  - Negative controls (one skipped RNG step, one altered byte) are detected.
  - Evidence is conditional on the injected start state; the race contained no interrupt-dependent stale read.

- **segment-race-setup**: `1000:32b8` (race setup: `.TRK`/`.MAP`/shape/bitmap loading and every DOS allocation) from a DOSBox entry checkpoint to its return. Memory and all four VRAM planes match exactly, including the MCB chain and its owner-name stamping rule, observed with `scripts/dosbox/trace-arena.mjs`. Segment-level evidence, conditional on the injected entry state.

## Known limitations

- Speaker audio is approximate (inaudible rates above 15 kHz are silenced, one-pole low-pass).
- **Approximations** (all in `docs/re/environment.md`):
  - Timing model: race at 15 fps minimum, calibrated work costs.
  - `9542`'s interrupt-dependent stale stack word.
- Menu screens, shops, saves and results have **no reference comparison yet** (their RNG depends on timing). They are exercised by the demo and browser runs only.
- MT-32, AdLib, Tandy, CGA, Hercules and joystick paths are unsupported. Reaching one stops the game with a diagnostic (default strict mode) or is reported (`?mode=demo`).
- No production deployment has been configured.

## Next milestone

1. Reference checkpoints for a menu/shop transaction and the race-results screen (segment comparisons injected at screen entry).
2. A capture with type-5 entities, to exercise the stale-slot input path.
3. A save/load round trip in the browser.
4. Segment captures for `34b0` (results), the shop purchases and `2230` (quiz), using `scripts/dosbox/capture-segment.mjs`.
