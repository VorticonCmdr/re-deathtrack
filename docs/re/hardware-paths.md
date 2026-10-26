# Hardware paths: CGA, AdLib, MT-32

Scope of this work: the CGA video path (adapter id 1), the AdLib music driver (`2d8a`) and the MT-32/MPU-401 music driver (`2ec8`). Tandy, Hercules/mode-4 and joystick stay unsupported (`unsupported()`).

## Reference evidence (observed)

- The DOSBox reference runs (default config: VGA, MPU-401 present, Sound Blaster/OPL present) selected **MT-32** (`DS:2d32 = 2ec8`) and the **EGA** adapter (`DS:385d = 2`). So an MPU-401 trace exists for free: breakpoints at `1000:cbd0` (queue a byte) and `1000:cbfc` (drain a byte).
- AdLib is reachable in DOSBox by writing `DS:2d2a = 3` after the game starts and before `2524:4956`. That is the device-selection word the original never writes. It makes `soundTimerInit` install `2d8a` provided `1000:c8e5` (OPL detect) succeeds.
- CGA is reachable with `dtrack GC`: argv `GC` -> request 1 -> mask `DS:49b6[1] = 1` -> `1ff8:21f5` returns 1 without probing hardware. DOSBox's VGA machine supports INT 10h mode 6 and B800.
- The DOSBox automation bridge cannot change `machine`, `sbtype` or `mpu401` (settable keys: port, headless, mute, protocol).

## Device selection (port, at the hardware boundary)

Game code is not changed to select devices. The environment answers on the ports, and the translated detection code runs as written.

| Option | URL / API | Effect |
| --- | --- | --- |
| sound `speaker` (engine default; browser default is `mt32`) | `?sound=speaker` | MPU and OPL absent: reads FFh |
| sound `adlib` | `?sound=adlib` | OPL2 present at 388h/389h (timers follow virtual time), MPU absent |
| sound `mt32` | `?sound=mt32` | MPU-401 present at 330h/331h, IRQ 2; bytes go to a MIDI sink (Web MIDI output). OPL absent so only the MT-32 can be chosen. |
| video `ega` (default) | | `INT 10h AH=12h BL=10h` answers EGA |
| video `cga` | `?video=cga` or argv `GC` | INT 10h/BIOS data report a CGA; the detection chain falls through to id 1 |

The default stays EGA + speaker, the verified configuration.

## Checklist of sites that depend on the adapter/device

Found by searching the export for the DS operand (`.local/re/export/disasm.asm`), 2026-10-25. Every site must be audited: translated, or marked unsupported, with the result recorded in the status column.

| Variable | Meaning | Functions that read or write it |
| --- | --- | --- |
| `DS:385d` | adapter id | `1000:045a`, `1ff8:20ff`, `3b7a`, `44b4`, `52b1`, `2524:0260`, `17a6`, `46c8`, `470a`, `478a`, `29f6:0044`, `2fd2:0252`, `3168:009e`, `3373:000b` |
| `DS:95d6` | adapter id (game copy) | `1000:0010`, `1208`, `ae8e`, `2524:043c`, `2f73:000f`, `2f73:02a4` |
| `DS:896c` | low-colour (CGA/Tandy) flag | `1000:24c4`, `2e4a`, `4808`, `4bd4`, `4d06`, `7610`, `767c`, `76e2`, `775e`, `77c8`, `8c10`, `ba72`, `2524:0260`, `0c66`, `18f4`, `203a`, `2bbe`, `2c9a`, `3cd6`, `406e` |
| `DS:4d8c` | Tandy page mapping (stays unsupported) | `1ff8:23ba`, `3194`, `3810`, `44b4`, `2f73:000f`, `03ed`, `3168:*` |
| `DS:49b5` | adapter request mask | `1ff8:20ff`, `21f5` |
| `DS:385c` | Tandy/CGA keyboard flag | `1000:c00e`, `1ff8:41ca`, `528a`, `2fd2:0252` |
| `DS:2d32` | selected sound device | `2524:4956`, `4a94`, `4b00` |
| `DS:30d2` | current device descriptor | `1000:cd72`, `cdac`, `cdcc`, `cdda`, `ce63`, `cf1b`, `cf84`, `d083`, `d09f`, `d0c7` |
| `DS:2d2a` | device-selection word (never written) | `2524:4956` |

Existing `unsupported()` sites that this work turns into translations: see `grep -rn "unsupported(" src/game`.

## Evidence levels used here

- Segment comparison: a function (or driver call sequence) against DOSBox from an injected entry state.
- Closed-loop replay: several frames/calls driven by the port with recorded environment inputs.
- Independent runtime scenario: the port's own providers, no reference comparison.
- Browser acceptance: real Chrome.

Audio output (OPL synthesis, MIDI delivery) is never compared sample by sample; the comparable artifact is the time-stamped register/byte stream.

## Game-side CGA audit (adapter id 1), 2026-10-25

Method: each function's disassembly (`.local/re/export/disasm.asm`) read against the JS in `src/game`; "already correct" means both branches of the `[896c]` / adapter test were already translated literally. Evidence level: static (no DOSBox comparison yet). `2fd2:*`, `1ff8:20ff/21f5/44b4`, `bios.js`, `src/web/*` and `cga.js` belong to the driver/hardware work.

`[0x896c]` low-colour sites:

| Function | JS | Result |
| --- | --- | --- |
| `1000:24c4` pumpFuel | `flow.js` | already correct (colour 0 instead of 0Ch) |
| `1000:2e4a` drawCarName | `flow.js` | already correct (colour 0Eh for car 0) |
| `1000:4808` drawBox | `flow.js` | already correct (speckles skipped; the loop counters still run) |
| `1000:4bd4` drawButtonBg | `flow.js` | already correct (4 colour tests) |
| `1000:4d06` drawShadowText | `flow.js` | already correct (0Fh instead of 0Eh) |
| `1000:7610` `767c` `76e2` `775e` hit marker save/mark/check/restore | `race.js` | already correct (4-pixel marker cross) |
| `1000:77c8` radarDots | `race.js` | already correct (3x3 rect via `3810` instead of a pixel) |
| `1000:8c10` hudOverlay | `race.js` | already correct (warning text colour 0) |
| `1000:ba72` mirrorBackground | `raceview.js` | already correct (road stripes 6/0 by row parity) |
| `2524:0260` hardwareInit | `seg2524.js` | translated: the `030a` branch was `unsupported()`; now sets `[896c]=1`, `1cf0[10]=0`, `1cdc[10]=3` and the 100 ground records (`9258+8r` = AAAAh/5555h by parity, `9252+8r` = 0 / AAAAh). Id 4 still stops earlier at `0285` (Tandy pointer limits) |
| `2524:0c66` TTM interpreter | `seg2524.js` | already correct (op `R` with colour 3: two `c03e` boxes) |
| `2524:18f4` raceInit | `seg2524.js` | already correct (ground records are not rebuilt on CGA) |
| `2524:203a` applyPalette | `seg2524.js` | already correct (CGA/Tandy only) |
| `2524:2bbe` setTextColourMode | `seg2524.js` | already correct |
| `2524:2c9a` fillPanel | `seg2524.js` | already correct |
| `2524:3cd6` minimap | `seg2524.js` | already correct |
| `2524:406e` armour bar | `seg2524.js` | already correct |

Result: 1 translated, 19 already correct (counting `7610 767c 76e2 775e` separately), 0 unreachable.

Adapter-id sites (`[385d]` / `[95d6]`):

| Function | Result |
| --- | --- |
| `1000:0010` main | translated: id 1 now calls `1000:a536` (INT 10h mode 6) |
| `1000:045a` | already correct (only id 3 differs; `c00e` depends on `[385c]`, 0 on CGA) |
| `1000:1208` loadSkylineMap | translated: the `140c` branch (CGA) converts through `2fd2:014e` into a block of total/2 bytes, 80-byte rows; id 3 (`12cf`) stays unsupported |
| `1000:ae8e` | already correct (EGA only, no-op elsewhere) |
| `2524:043c` | already correct (`GC` -> mask 1, then `1ff8:20ff`) |
| `2524:17a6` | already correct (id 4 only) |
| `2524:46c8` `470a` `478a` palette cycling | unreachable on CGA (return at once unless id 2/3) |
| `2f73:000f` drawSky | translated: `00f0` CGA branch (RAM copy of 80-byte rows); id 3 (`01c5`) and MCGA stay unsupported |
| `2f73:02a4` | translated: id 1 jumps to `035f`; id 4 (also `035f`) stays unsupported |
| `2f73:035f` / `0513` | translated (CGA ground fill, near span routine); `03ed` / `0564` / `05bb` are Tandy / mode 4, not translated |
| `2f73:05d8` | already correct |
| `1ff8:3b7a` loadPalette | already correct (chunk tag `DS:4b86[id]`, `PAL:CGA:`; the data is read by driver slot 19) |
| `1ff8:52b1`, `29f6:0044` | unreachable on CGA (EGA only) |
| `sys/loaders.js` `BMP:VGA:` / `SCR:VGA:` | unaffected (`[385f]` is never written); bitmaps and screens are 4 bpp packed for every adapter and converted by driver slots 13/14 |

Open points for the DOSBox comparison (`dtrack GC`): `2f73:0513` counts the middle bytes after the left partial byte was already written, so the span ends up to 4 pixels (one byte) past `b` (static reading, quirk kept); `2f73:00f0` reaches a near `RET` from a far call when `[9642] <= top-start` (the port throws; never seen); `1000:1208` assumes the driver exports `2fd2:014e` as `F.f2fd2_014e(dstOff,dstSeg,srcOff,srcSeg,0x140,rows,0)`.
