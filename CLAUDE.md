# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A faithful browser port of *Deathtrack* (1989, DOS), written in vanilla JS and served with Vite. Each function of the original `DTRACK.EXE` is translated into JS that runs on an emulated real-mode memory image. The current state, verified scenarios and limitations are in `docs/STATUS.md`; keep that file current when behaviour or verification changes.

## Commands

```sh
npm run dev               # game at /, asset inspector at /viewer.html (serves game/ via /__assets)
npm run verify            # strict: 92 asset hashes + node --test tests/ (fails on skipped/zero tests)
npm run verify:browser    # real Chrome via puppeteer-core: boot -> menus -> race
node --test tests/race.test.mjs                        # one test file
node scripts/run-headless.mjs --args demo --seconds 120   # headless run with screenshots in .local/headless
node scripts/replay-race.mjs .local/captures/demo-race-start 0 399 --stop   # race replay vs DOSBox, per-range diffs
```

- Tests need `game/`. `tests/scenario-demo-race.test.mjs` also needs `.local/captures/demo-race-start`. A missing fixture is a setup failure, never a skip.
- `npm run unpack:exe` rebuilds `.local/re/DTRACK_U.EXE`, the unpacked MZ that Ghidra analyses.

## Architecture

- **Engine** (`src/engine/`, no game knowledge):
  - `mem.js`: 1 MiB image plus DS/far accessors. The EXE is loaded at DOSBox's segment `0x01f5`, so DGROUP is `0x28ef`; `gseg()`/`gaddr()` convert from Ghidra's `0x1000` base. Comments always cite Ghidra addresses.
  - `int.js`: 8086/MSC integer semantics. Divide faults follow the live INT 0 vector (the game's handler halves the dividend and retries).
  - `ega.js`: EGA planes, latches, write/read modes and registers.
  - `dos.js`: DOSBox-identical MCB arena, job-file-table handles, 8.3 names.
  - `host.js`: virtual PIT time, vectors, a function registry keyed by address (far pointers stored in data stay callable), and the generator scheduler.
  - `machine.js`: builds the machine from the user's DTRACK.EXE (hash-checked), including the PSP and environment block.
  - `checkpoint.js`: loads and diffs DOSBox checkpoints.
- **Game** (`src/game/`): one module per original code region. Ownership is in `docs/TRANSLATION_BRIEF.md`.
  - Modules: `flow.js` (`1000:0000–6dbb`), `race.js`, `raceview.js`, `render3d.js` (`2c46`/`2f73`), `egadrv.js` (`29f6`), `sys/` (`1ff8`), `seg2524.js`, `crt.js`/`timer.js`/`music.js`/`sfx.js` (MSC runtime and drivers).
  - `bios.js` provides INT 10h/21h/33h and ports at register level.
  - Cross-module calls go through the late-bound `F.fSEG_OFF` table in `link.js`; every module ends with `provide({...})`.
- **Generators:** functions listed in `src/game/blocking.json` (poll points, waits, race loop) are `function*` and are called with `yield*`. Input readers `yield* idle()`.
- **Pacing:** `src/game/pacing.js` holds the race frame period, the work-cost model and the menu quantum, all calibrated against DOSBox (`docs/re/environment.md`). The browser host (`src/web/main.js`) never lets virtual time run ahead of the wall clock.
- **Calling convention:** one JS parameter per pushed 16-bit word. A far pointer is `(off,seg)` and a long is `(lo,hi)`; DX:AX returns are packed into one 32-bit number.

## Rules

- **Translate, don't invent.** Use the disassembly when widths, signedness, flags or register arguments matter, and treat decompiled C as a reading aid only. Mark `QUIRK:` (preserved original behaviour), `APPROX:` and `UNKNOWN:`.
- **Original data:** read tables and strings from the loaded image through the accessors. Never transcribe them into source.
- **No host randomness or wall-clock time in simulation code.** External values enter only through `bios.js` and host events, as listed in `docs/re/environment.md`.
- **Never commit** `game/`, `ghidra/`, `.local/` (unpacked EXE, Ghidra exports, DOSBox captures and scratch copies) or any decoded asset. DOSBox runs use the scratch copy `.local/dosrun`, never `game/`.
- **Analysis inputs:** the Ghidra program is `/DTRACK_U.EXE` (the packed `/DTRACK.EXE` entries are not valid code). The export (`scripts/ghidra/ExportAll.java` → `.local/re/export/{decomp.c,disasm.asm,callgraph.json}`) is the grep-able source for translation work.
- **Code style:** dense, minified-looking, terse names, short comments. Match it.
