# Brief for translation agents

You translate one bounded part of DTRACK.EXE into JavaScript for a faithful browser port. Correctness beats speed.

## Read first

1. `docs/porting-conventions.md`: the memory model, accessors, integers, generators and the environment boundary. It is binding.
2. `docs/re/AGENT_BRIEF.md`: how to read the Ghidra export (`.local/re/export/decomp.c` and `disasm.asm`) and the image. Ignore its "Output" section; your output is code.
3. The analysis docs for your area in `docs/re/`: `graphics.md`, `input-timer-sound.md`, `resources.md`, `gameflow.md`, `race.md`.
4. The engine you build on:
   - `src/engine/mem.js`
   - `src/engine/int.js`
   - `src/engine/host.js` (`idle`, `retrace`, `register`, `callFar`/`callFarG`, `unsupported`, vectors)
   - `src/engine/ega.js` (EGA hardware: `wr`/`rd`/`out`)
   - `src/engine/dos.js`
   - `src/game/crt.js`

## Rules

- **One JS function per original function.**
  - The export name is `f<seg>_<off>` with the **Ghidra** address, for example `export function f1ff8_4a48(...)`.
  - Add a semantic alias as a second export if you like: `export {f1ff8_4a48 as openResource}`.
  - Callers in other modules import by the address name, so they need no coordination.
  - Header comment: `// 1ff8:4a48 openResource: <purpose>`.
- **Generators:**
  - A function listed in `src/game/blocking.json` is a `function*`, and calls to it are `yield* fXXXX()`.
  - Every other function is a plain function. Never make a function a generator unless the list says so.
  - If you find an indirect call (through a pointer in memory) whose target can block, use `yield* callFarG(ptr,...)` and report it.
- **Poll points:** the input readers `1ff8:4457`, `44a0`, `4486`, `4025`, `4068`, `3ee5`, `3f62`, `3fc2` and `1000:a39c` start with `yield* idle()`. `1000:a3a0`'s wait loop yields on every iteration.
- **Function pointers stored in memory:** every original function whose address is stored in data or taken for an indirect call must be registered: `register(0x1000,0xa3be,f1000_a3be)`, or with `{gen:true}` for a generator. Put the registrations at the bottom of your module.
- **Width and signedness:**
  - Follow the disassembly. Use `rw`/`rsw` according to how the original interprets the value: signed compares `JL`/`JG`, unsigned `JB`/`JA`.
  - Wrap with `s16`/`u16` wherever the original truncates.
  - Use the `int.js` helpers for `IDIV`/`DIV`/`MUL`/`IMUL` and the MSC long helpers.
- **Register-argument and flag-returning helpers** (asm library code): make the JS signature explicit and document the register mapping. Where the original returns a flag such as CF, return it in an object or as a second value.
- **Hardware:**
  - Video memory goes through `ega.wr(off,v)` / `ega.rd(off)`, where `off` is the offset from segment A000. A200 and A400 are offsets `0x2000` and `0x4000` above it.
  - Ports `0x3c4`–`0x3cf` and `0x3d4`/`0x3d5` go through `ega.out`. Port `0x3da` reads go through `vstatus()` from `src/game/bios.js` (owned by the main session, which adds whatever you need; ask for it in your report).
  - INT 10h, INT 21h and INT 33h go through `src/game/bios.js`.
  - Never touch `src/engine/*` or files outside your ownership list. If you need an engine change, describe it in your report.
- **Unsupported adapters/devices** (Tandy, Hercules, MCGA mode 4, joystick hardware): don't translate them. The branch calls `unsupported('<addr> <what>')`. CGA (adapter id 1), AdLib and MT-32/MPU-401 are in scope and are translated; see `docs/re/hardware-paths.md`.
- **No invention.** If something can't be determined, write `// UNKNOWN:` and choose the literal translation of the instructions. Mark approximations `// APPROX:`.
- **Quirks:** keep observable quirks (bugs included) and comment them `// QUIRK:` with a reference to the analysis doc.
- **Tests:** write a focused test file `tests/<area>.test.mjs` for logic you can check without the whole game:
  - decoders against real files from `game/`
  - pure functions against hand-computed expectations from the disassembly
  - EGA output for small draw calls
  Tests must fail on mismatch. Never skip tests. Use `tests/assets.mjs` to load the game files; a missing file throws.
- **Must pass:** `node --test tests/` before you finish. Do not commit. The main session integrates.

## Report

At the end, report in under 400 words:
- the files written
- the functions translated (count)
- functions deliberately not translated (unsupported paths)
- engine or `bios.js` needs
- open uncertainties
- indirect calls found

## `src/game/bios.js` interface (main session owns it)

- `int10(r)`, `int21(r)`, `int33(r)`, with `r = {ax,bx,cx,dx,si,di,ds,es}`. Results come back in `r`, and `r.cf` is set for DOS. INT 21h covers files, memory 48h/49h/4Ah, vectors 25h/35h, DTA, findfirst/next, version and disk free. `GameExit` is thrown by AH=4Ch.
- `outp(port,v)` and `inp(port)` handle the PIT (40h–43h), speaker 61h, PIC, EGA ports, 3DAh, 60h, and 201h/331h/388h (absent devices read FFh).
- `vstatus()` reads 3DAh.
- The `mouse` and `speaker` state objects are exported for the audio and presentation layers.
- To invoke an interrupt vector the game installed (e.g. INT 1Ch from the BIOS INT 8), use `interrupt(n)` from host.js. Real ISRs (INT 8 `1000:c356`, INT 9 `1ff8:41ca`, INT 1Ch `1ff8:43a9`) are registered with `register(...)`, so the vector table entries the game writes through INT 21h AH=25h resolve to them.
- MSC far-heap/DOS details: DGROUP is 64 KiB, and the program block ends at DGROUP+0x1000 (identity.md).

## Ownership (one agent per row; touch only your files)

| Agent | Original code | Files |
| --- | --- | --- |
| runtime | `1000:a390–a40f`, `1000:c000–ffff` (MSC runtime incl. stdio with FILE structs at the original `_iob` offsets, heap, long maths, timer ISR and install, music sequencer, device layer, speaker driver), segments `32e3` (sfx bank) and `334e` (sfx interpreter) | `src/game/crt.js` (extend), `src/game/timer.js`, `src/game/music.js`, `src/game/sfx.js`, `tests/runtime.test.mjs` |
| sys | segment `1ff8` (chunk/stream library, memory, graphics library wrappers, polygon clipper, keyboard ISR, mouse, joystick stub, adapter selection for EGA) | `src/game/sys.js` (split into `src/game/sys/*.js` if large), `tests/sys.test.mjs` |
| ui | segment `2524` (title/TTM, credits, attract/demo script, sound glue, shop helpers, file picker, hardware init) | `src/game/seg2524.js`, `tests/ui.test.mjs` |
| flow | `1000:0000–6dbb` (main, dialog pages, dispatcher, shops, standings, results, saves) | `src/game/flow.js`, `tests/flow.test.mjs` |
| egadrv | segment `29f6` (EGA slots and helpers) | `src/game/egadrv.js`, `tests/egadrv.test.mjs` |
| race | `1000:6dbc–9fff` (input, physics, AI, weapons, damage) | `src/game/race.js`, `tests/race.test.mjs` |
| raceview | `1000:a000–a38f` and `1000:a410–bfff` (race rendering glue, HUD, object projection, shape loading, hit tests) | `src/game/raceview.js`, `tests/raceview.test.mjs` |
| render3d | segments `2c46` (3D maths, shapes, matrices) and `2f73` (scanline ground/road fill) | `src/game/render3d.js`, `tests/render3d.test.mjs` |

**Cross-module calls** go through the late-bound table in `src/game/link.js`.
- Call `F.f1ff8_4a48(...)` (or `yield* F.f1000_6a90()` for a listed generator) after `import {F,provide} from './link.js'`.
- Every module ends with `provide({...all its fXXXX_YYYY functions})`.
- Within your own module, call functions directly.
- Calling a function nobody has provided throws `Untranslated function fXXXX_YYYY`, which is how integration finds gaps.
- In tests, stub functions from other areas with `override({...})` from link.js. `provide` refuses duplicates, and other modules may already provide the real function.
- List the cross-module functions you call in your report.

## Calling convention for translated functions (binding, all modules)

- **Parameters mirror the pushed stack words exactly**, one JS parameter per 16-bit word, in the original's left-to-right C order:
  - a far pointer is two parameters `(off, seg)`
  - a long is `(lo, hi)`
  - a near pointer or int is one parameter
- **Return values:** 16-bit results as numbers. `DX:AX` results (far pointers, longs) as one packed number: `(DX<<16|AX)>>>0`, the same as `fp(seg,off)`.
- Register-argument helpers document their register mapping as before.
