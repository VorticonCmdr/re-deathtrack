# Current status

Updated 2026-10-25.

## Supported build

- `DTRACK.EXE`, SHA-256 `5b23cafb…ff2928`: Deathtrack 1.0 (1989) PC, with the one-byte copy-protection patch. Asset set: `src/data/manifest.json` (92 files).
- Display: EGA mode 0Dh (default, the adapter DOSBox detects), or CGA with `?video=cga` (argument `GC`: the game sets BIOS mode 6, 640x200 two colours, dithered; the driver programs mode 4 first).
- Sound: PC-speaker path by default (music and effects), rendered in the browser by an AudioWorklet from time-stamped PIT/port 61h changes. The browser test asserts non-silent output. Audio fidelity (speaker response) is APPROX and has not been compared with hardware or DOSBox output.
- Optional music hardware: `?sound=adlib` (OPL2 register stream rendered by `src/engine/opl2.js`, an independent APPROX synth; effects stay on the speaker) and `?sound=mt32` (MPU-401 UART, MIDI bytes sent to a Web MIDI output; the port has no MT-32 synth, ROMs or fallback).
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
| `npm run verify` | asset identity (92 hashes); 166 unit/module/scenario tests; closed-loop race replays (EGA and CGA) and segment comparisons | routine/segment + closed-loop |
| `npm run verify:browser` | real Chrome: boot → menus → race with real keyboard/mouse on EGA and on CGA (`?video=cga`); AdLib and MT-32 options (non-silent OPL output, MIDI bytes sent); fails on errors, diagnostics or missed milestones | browser acceptance |
| `node scripts/replay-race.mjs <dir> 0 399 --strict` | the replay alone, with per-range diffs | closed-loop |
| `node scripts/run-headless.mjs --args demo --seconds 120` | independent runtime scenario with the port's own environment providers, plus screenshots | independent scenario (no reference comparison) |

`npm run verify` needs the local game files, and the scenario test needs the local capture `.local/captures/demo-race-start` (recipe in `docs/scenarios/demo-race-start.json`). If either is missing, it fails with a setup error.

## Verified scenarios

- **demo-race-start**: 400 DOSBox checkpoints from race start.
  - The port runs the race loop closed-loop from checkpoint 0. **All 399 following checkpoints match exactly**: conventional memory except the documented ISR/sound/stack exclusions, and all four EGA planes.
  - Negative controls (one skipped RNG step, one altered byte) are detected.
  - Evidence is conditional on the injected start state; the race contained no interrupt-dependent stale read.

- **segment-race-setup**: `1000:32b8` (race setup: `.TRK`/`.MAP`/shape/bitmap loading and every DOS allocation) from a DOSBox entry checkpoint to its return. Memory and all four VRAM planes match exactly, including the MCB chain and its owner-name stamping rule, observed with `scripts/dosbox/trace-arena.mjs`. Segment-level evidence, conditional on the injected entry state.

- **sound-startup**: the MIDI bytes the MT-32 driver queues (first 692 equal DOSBox's 700 captured) and the AdLib register writes (299 of 299, plus the detection delay constants) from the program start. Times are not compared; audio is not compared.
- **cga-race-start**: 150 DOSBox checkpoints of a CGA demo race (`dtrack GC demo`). All 149 following frames match exactly: conventional memory, B800 RAM and the EGA planes. Same conditional-start caveat as demo-race-start.
- **cga-segments**: CGA driver init (`2fd2:0252`), hardware init (`2524:0260`, with five documented sound/joystick exclusions), ground fill (`2f73:035f`) and sky strip (`2f73:000f`) match DOSBox from injected entry states, memory and B800.

- **CGA display (one observation, not a committed test):** a paused DOSBox mode-6 screen (B800 RAM read through the API, frame from `/video/frame`) and `cgaFrame()` rendered from that RAM agree on all 128,000 pixels (9,013 lit). Mode 4 colours were not compared.

## Known limitations

- Speaker audio is approximate (inaudible rates above 15 kHz are silenced, one-pole low-pass).
- **Approximations** (all in `docs/re/environment.md`):
  - Timing model: race at 15 fps minimum, calibrated work costs.
  - `9542`'s interrupt-dependent stale stack word.
- Menu screens, shops, saves and results have **no reference comparison yet** (their RNG depends on timing). They are exercised by the demo and browser runs only.
- Tandy, Hercules/mode-4 and joystick paths are unsupported. Reaching one stops the game with a diagnostic (default strict mode) or is reported (`?mode=demo`).
- **CGA:** the title, menus and races are verified only as far as the captures above (race loop, sky, ground, driver init). The other driver slots (sprites, glyphs, lines, dissolve) are translated and checked against the original instructions by `tests/x86mini.mjs`, but not against DOSBox. Colour handling of mode 4 and the work-cost of B800 accesses (`work.vram` per byte) are APPROX; the menu timing on CGA is not calibrated.
- **Boot time:** with the MPU and OPL absent the port spends about 0.16 s of APPROX virtual time in the absent-device probes (docs/re/environment.md); the DOSBox references never ran that path.
- **AdLib:** synthesis is approximate (not bit-exact, no comparison with an OPL reference); the OPL port-access cost (2.4 µs) is fitted to one DOSBox count.
- **MT-32:** needs a connected MIDI output (real MT-32 or Munt) and a browser with Web MIDI permission; nothing is audible otherwise. Byte times are not compared.
- No production deployment has been configured.

## Next milestone

1. Reference checkpoints for a menu/shop transaction and the race-results screen (segment comparisons injected at screen entry).
2. A capture with type-5 entities, to exercise the stale-slot input path.
3. A save/load round trip in the browser.
4. Segment captures for `34b0` (results), the shop purchases and `2230` (quiz), using `scripts/dosbox/capture-segment.mjs`.
