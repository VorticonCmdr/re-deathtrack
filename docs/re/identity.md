# Target identity

Evidence levels: **observed** (DOSBox), **static** (Ghidra/bytes), **inferred**.

## Distribution

Local `game/` directory, 92 files. `file_id.diz`: "Deathtrack (1989)(Activision, Inc.)", version 1.0. The full hash list is reproduced by `npm run verify:assets`, which checks `src/data/manifest.json`.

| File | SHA-256 | Role |
| --- | --- | --- |
| `DTRACK.EXE` | `5b23cafb2542195a7473b532e46a25023cd7bd59351445f6a7cb732807ff2928` | **Reference build.** Started by `dtrack` (`run.bat`) |
| `DTRACK.EX_` | `c28a0284bb5f7311d1f15e84d165f50d0399084788ef1b3e72fd46b97470a26a` | Unpatched original, not runnable under this name |
| `d.exe` | `7ba6c7f2717758207eaa3a67ac9fa0e0e83f2e5067d5bdcee8ad4f336d2d57f4` | LZEXE 0.90-packed, run by `demo.bat` as `d m0 s0 j0 demo`. Not analysed, out of scope |
| `int.exe` | `63f230ec…` | CARMEL Turbo Anti-Virus integrity stub. Ignored |

`DTRACK.EXE` and `DTRACK.EX_` differ in exactly one byte (static):

- Packed file offset 10991 (`0x2AEF`), which is unpacked image offset `0x28FB` (`1000:28fb` in Ghidra).
- `.EX_` has `75 06`, a JNZ. `.EXE` has `EB 06`, a JMP.
- Context, in menu handler `1000:2766`: `CMP [BP+6],[0x1fb6]` compares the player's answer to the copy-protection question with the correct index. `2524:21d2` shuffles the answers using the game RNG.
- On a wrong answer, the original falls through to `MOV word [0x1fb8],1` and then continues to `1000:2eb8` regardless. The patched build always skips setting `[0x1fb8]`.
- `[0x1fb8]` is read at three later sites (penalty behaviour, not yet analysed).
- **The port follows `DTRACK.EXE`.** The question is shown, every answer is accepted, and `[0x1fb8]` stays 0.

## Executable format (static, confirmed live)

- MZ, 16-bit real mode, Microsoft C runtime (R6000-series runtime-error strings, `_main` calling convention), medium model: far code (`RETF`, 372 functions), near data in a single DGROUP, SS = DS.
- Packed with Microsoft EXEPACK (`RB` signature; "Packed file is corrupt" stub at `2a7f:0000`).
  - Header: real `CS:IP = 0000:d39c`, `SS:SP = 31a4:0fa0`, dest_len `0x2c73` paragraphs (182,064 bytes), 1,389 relocations.
- `scripts/unexepack.mjs game/DTRACK.EXE .local/re/DTRACK_U.EXE` rebuilds a plain MZ with the unpacked image and relocations.
  - SHA-256 of `DTRACK_U.EXE`: `3f3650e4c3f649b490873ed09e1884f62a3e73dc56e2dcd627dffb17324192d6`.
- Original header `minalloc` = `0x075d` paragraphs.

## Ghidra

Project `ghidra/DeathTrack` (local, not committed).

- `/DTRACK_U.EXE` is the analysis target: load base `0x1000`, entry `1000:d39c`, `main` = `1000:0010`.
- `/DTRACK.EXE`, `/DTRACK.EX_` and `/d.exe` are **packed** files loaded as-is. Their code is EXEPACK data shifted by compression and is not valid game code. Do not use them.
- Segments in `DTRACK_U.EXE`:
  - `1000` game core and MSC runtime (`c000+`)
  - `1ff8` Dynamix system/graphics library
  - `2524` game UI/shop
  - `29f6` EGA driver
  - `2fd2` CGA driver
  - `3168` Tandy driver
  - `32e3` Hercules driver
  - `3373` mode 4 driver
  - `2c46`, `2f73`, `334e` (TBD)
  - `33ae` text data (weapon/part descriptions)
  - `36fa` DGROUP: initialised data to `5790`, then BSS up to `cd5f`
- Calling conventions were corrected by script: every function whose body contains `RETF` uses `__cdecl16far` (`scripts/ghidra/FixConv.java`).
- `scripts/ghidra/ExportAll.java` writes `decomp.c`, `disasm.asm` and `functions.tsv` to `.local/re/export/`.
- Ghidra displays `MOV DS,AX` / `MOV ES,AX` as `MOV AX,DS` / `MOV AX,ES` in this listing. Read them as segment loads.

## Runtime mapping (observed, DOSBox 0.84.0-vc1 automation build, default config)

- `C:\DTRACK` launched from a scratch copy of `game/` (`.local/dosrun`).
- INT 21h AH=30h breakpoint at the entry: `CS = 0x01f5`, PSP `0x01e5`, `SS = 0x3399` (= `0x1f5 + 0x31a4`).
- **live segment = Ghidra segment − 0x1000 + 0x01f5** (DGROUP live `0x28ef`).
- Checked bytes:
  - `CS:d39c`: `b4 30 cd 21 …`, with the relocated `mov di,28ef`.
  - RNG table at `DS:215a`: `23 dd 33 95 …`.
  - The patched byte `EB` at `CS:28fb`.
- Revalidate this mapping if the launch path, DOS version or memory configuration changes.

## Hardware boundary (static)

- **Adapter selection**: `1ff8:20ff`, from argv `GC`/`GE`/`GH`/`GT` (CGA/EGA/Hercules/Tandy) or auto-detect.
  - The adapter's driver table is copied to the 35-entry far-call table at `DS:4924`. The EGA table is at `DS:4d9c` and its slots are named `ega_slotN_*` in Ghidra.
  - DOSBox default detects EGA (2): mode `0Dh`, 320×200×16, pages at `A000`, `A200` and `A400`.
- **PIT**: `1000:c442` reprograms channel 0 to divisor `0x2000` (≈145.65 Hz). The ISR at `1000:c356`:
  - adds `0x1c2` to a 32-bit counter at `CS:c328` each tick,
  - chains to BIOS INT 8 every 8th tick,
  - calls callback slots 1–7 round-robin (each ≈18.2 Hz) from the table at `CS:c32c`,
  - and drives the music/sound tick via `[0x2d2e]`.
- **Keyboard**: `1ff8:40c7` installs an INT 9 handler at `1ff8:41ca` and an INT 1Ch handler at `1ff8:43a9`.
- **RNG**: `1000:a3ca` is an additive lagged-Fibonacci generator.
  - 56-word table at `DS:215a`, initialised from the executable's data.
  - Indices at `DS:2154`/`2156` are reset to `0x30`/`0x6e` by `1000:a403`.
  - `r = T[i] + T[j]`, stored into `T[j]`, then both indices decrease by 2 with wrap to `0x6e`.
  - `1000:c144` is the far wrapper.
- **Command line** (`2524:043c`):
  - `DEMO` sets `[0x1fa8]=1` (demo mode).
  - `Jn` sets the joystick option `[0x1fc0]`.
  - `Mn`/`Tn` set music `[0x1fb2]`.
  - `Sn` sets sound `[0x1fb0]`.
  - `Gx` selects graphics.
