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
| sound `speaker` (default) | `?sound=speaker` | MPU and OPL absent: reads FFh |
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
