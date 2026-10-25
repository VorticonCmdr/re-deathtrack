# Porting conventions

This is the contract for translated code. Read it before translating a function.

## Memory model

- The game runs against a 1 MiB real-mode memory image (`src/engine/mem.js`).
- The unpacked `DTRACK.EXE` is loaded at **segment 0x01f5**, the observed DOSBox load segment, with relocations applied. Physical memory, DOS allocations and stored far pointers can then be diffed directly against DOSBox dumps.
- Ghidra (`/DTRACK_U.EXE`) uses base `0x1000`. `gseg(g)` converts a Ghidra segment and `gaddr(g,o)` builds a packed far pointer. Offsets are identical. Comments and symbol tables always cite **Ghidra** addresses.
- DGROUP is `gseg(0x36fa)` = `0x28ef`, and DS = SS = DGROUP throughout game code. Translated code addresses globals by DS offset, which is identical in both.
- Initialised data comes from the user's own `DTRACK.EXE` at runtime, so tables, strings and RNG seed data are never transcribed into the source.
- DOS memory blocks (INT 21h 48h) are allocated by `src/engine/dos.js` between the end of the program and segment `0xA000`.
- Video memory is not part of this image. The EGA model in `src/engine/ega.js` owns it.

### Accessors (`src/engine/mem.js`)

| Call | Meaning |
| --- | --- |
| `rb(o)` / `rsb(o)` | DS byte, unsigned / signed |
| `rw(o)` / `rsw(o)` | DS word, unsigned / signed |
| `rd(o)` / `rsd(o)` | DS dword, unsigned / signed |
| `wb(o,v)` `ww(o,v)` `wd(o,v)` | DS stores, truncating to width |
| `frb(s,o)` `frsb` `frw(s,o)` `frsw` `frd` `frsd` | far reads |
| `fwb(s,o,v)` `fww` `fwd` | far stores |
| `fp(s,o)` | packed far pointer `seg<<16 \| off` as an unsigned 32-bit number |
| `pseg(p)` `poff(p)` | split a packed far pointer |

- Offsets wrap at 64 KiB like real segment arithmetic.
- Word accesses at offset `0xffff` wrap to offset 0, as on an 8086.

### Stack memory

- Locals whose address is taken use `sp`-managed stack memory in DGROUP. Examples: buffers passed to `strcpy`, or `&local` passed to a callee.
- Allocate with `const p=salloc(n)` and release with `sfree(n)` before returning, in LIFO order. Use `try/finally` when the function can throw.
- Plain scalar locals stay JS variables.
- The emulated stack top is `DS:0xba40` (the EXE header's `SS:SP`).

## Integers

JS numbers are doubles. Every value that the original keeps in a register or memory must be normalised at the point where the original truncates.

| Helper (`src/engine/int.js`) | Meaning |
| --- | --- |
| `s16(x)` `u16(x)` `s8(x)` `u8(x)` `s32(x)` `u32(x)` | wrap to width |
| `idiv16(a,b)` `imod16(a,b)` | 8086 `IDIV` semantics: truncation toward zero, throws on /0 or overflow |
| `div16` `mod16` | unsigned `DIV` |
| `lmul(a,b)` `ldiv(a,b)` `lmod(a,b)` `lshl` `lshr` `lsar` | MSC long helpers, 32-bit |
| `sar16(x,n)` `shr16(x,n)` `shl16(x,n)` | shifts on 16-bit values |

- `>>` on a value that is already signed 16-bit equals `SAR`. Shifting a 16-bit value left needs `s16()` or `u16()` afterwards.
- `Math.random` and host time are never used in simulation code.

## Functions

- Every translated function carries a header comment: `// 1000:a3ca rand: <one-line purpose>`. Add evidence notes only when the behaviour is non-obvious.
- Exported name: `<purpose>` in camelCase when the purpose is known, otherwise `f1000_a3ca`. Keep a table in `src/game/symbols.js` (address → name) so cross-module calls stay greppable by address.
- Parameters are explicit JS parameters in the original order. Register-argument helpers (asm library code) document which register each parameter came from.
- Return values: 16-bit results as numbers (signedness matching the caller's use). `DX:AX` longs as 32-bit numbers. Far pointers as packed `fp()` values.
- Globals are accessed by DGROUP offset through named constants (`src/game/globals.js`), e.g. `G.protectAnswer = 0x1fb6`. Unnamed globals may use the raw offset with a trailing comment.

## Blocking and time

- A function that can wait for time, input, vertical retrace or the music driver is a **generator** (`function*`). Callers invoke it with `yield*`, so the property propagates up the call chain.
- Pure computation (3D, physics, drawing) stays an ordinary function.
- Only `src/engine/host.js` yields to the scheduler: `yield* idle()` at a busy-wait poll point, and `yield* retrace()` at a vertical-retrace wait.
  - Translated polling loops call the environment accessor (key buffer, timer counter, mouse) inside the loop. The accessor yields, which advances virtual time.
- Virtual time is counted in PIT input clocks (1,193,182 Hz). The timer ISR translation runs once per channel-0 period (divisor `0x2000` by default) from the host, never from game code.

## Environment boundary

These are the only sources of external values. Each is recorded at its consumption point by `src/engine/env.js`, so a replay can reproduce a run from inputs alone.

- keyboard scancodes (INT 9 input port `0x60`)
- mouse state (INT 33h)
- joystick (not supported; reported as absent)
- file contents (assets keyed by upper-case 8.3 name) and save/score writes
- PIT ticks and vertical retrace (virtual time)
- sound-device status and MIDI/OPL ports (default PC speaker: MPU and OPL read FFh; AdLib and MT-32 selectable by host option)

## Unsupported paths

- Code paths for Tandy, Hercules, mode-4 adapters and joystick hardware are not translated. CGA, AdLib and MT-32 are (docs/re/hardware-paths.md).
- Reaching one calls `unsupported('<address> <what>')`. That throws in strict mode, the default and the setting for tests. In demo mode it records a visible diagnostic.

## Evidence notes

Mark claims as **observed**, **static**, **regression-validated**, **approximate** or **unknown**. Approximations carry an `APPROX:` comment that names what differs.
