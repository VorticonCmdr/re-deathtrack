# Input, timer and sound

Scope: every interaction between Deathtrack and time, input devices and sound hardware. Program `/DTRACK_U.EXE`, DGROUP `36fa`.

Evidence levels:
- **static**: read from the disassembly, ndisasm of the raw bytes, or file bytes. This is the default for every claim here.
- **inferred**: deduced from code paths but not executed.
- **unknown**: not established.

Nothing here was observed in DOSBox.

Negative findings ("no callers", "no readers", "never written") come from raw byte searches over the code image of `.local/re/DTRACK_U.EXE`, file offsets `0x15d0`–`0x28570` (segments `1000`–`33ae`), done on 2026-10-25.
- A far call to segment 1000 is searched as `9A off 00 00`, because the stored segment is pre-relocation.
- A DS operand is searched as its little-endian offset.
- Every hit was checked by disassembly.
- These searches cannot see computed or indirect references.

## Overview

### Timer
`1000:c442` hooks INT 8 and sets PIT channel 0 to divisor `0x2000` (145.652 Hz). The ISR `1000:c356` uses a phase accumulator, `CS:c355`, which it advances by `CS:c354` on every interrupt. The *pre-add* phase value selects what a given interrupt does.

| pre-add phase | action (rate at the default `c354 = 0x20`) |
| --- | --- |
| `0x00` | Add `0x1c2` to the counter `CS:c328`, then `JMPF` to the BIOS INT 8 (slot 0). The BIOS ticks 0040:006C and calls INT 1Ch = `1ff8:43a9`. Runs at 18.2 Hz |
| non-zero multiple of `0x20` | EOI, add `0x1c2` to the counter, call the user callback `CS:c350` (= `1000:a3be`), then call slot `phase>>5` (1..7). Runs on 7 of every 8 ticks; each slot runs at 18.2 Hz |
| other (`phase & 0x1f` ≠ 0) | EOI, then call slot 8 if `[2d26]` ≠ 0. Happens only after slot 8 has raised the rate |

On **every** interrupt, before any of this, the ISR decrements `[2d2e]`, which is reloaded from `[2d30]` (= 1). So the sound-effect tick `334e:0000` runs on every interrupt while `[365f]` ≠ 0 (`c35d–c3a7`).

### Time consumers
- **No wall-clock reads.** Game code never reads the 32-bit counter. Its getter `1000:c523` has no callers. There is no INT 1Ah, no INT 21h 2Ch/2Ah and no read of 0040:006C.
- The only game time base is the down-counter `[5a9e]`, which the user callback decrements. Its users:
  - `delayTicks` `1000:a3aa`
  - the title screen `2524:4850`
  - script delays `2524:0c34`
  - attract op 0x57 `2524:0624`
- **The race loop `1000:047c` is fixed-step and unthrottled.** It reads no time source, does not wait for retrace (the page flip is called with argument 0), and advances the simulation exactly one step per iteration. Menus (`1000:6a90`) likewise run one step per iteration with no wait. Their counters count iterations, not time.

### Input
- **Keyboard.** `1ff8:40c7` installs its own INT 9 handler `1ff8:41ca`, which never chains to the BIOS. It keeps:
  - a held-key table at `DS:4cb4`
  - two "virtual joystick" direction bytes at `DS:4bb8`
  - the BIOS shift flags and the BIOS key ring (0040:001A–003D), which it fills itself
- **INT 16h is never used.** The readers poll and never block:
  - `1ff8:4457` dequeues a key
  - `1ff8:44a0` tests a held key
  - `1ff8:4486` reads a stick direction
- **Mouse.** INT 33h functions 0, 0Fh, 3 and 4 only. The game draws the cursor itself.
- **Joystick.** Probed by `1ff8:3dd1` unless `J0` is given. If port 201h reads `FFh`, every reader returns 0.

### Sound
- **Music.** A Standard MIDI File (format 0, 1 track, 96 PPQN) sequencer, `1000:c731`, sits in timer slots 1, 3, 5 and 7 (72.83 Hz). It feeds one of four device drivers, chosen by **auto-detection only** in this order: Roland MT-32 (MPU-401), AdLib, Tandy, Internal Speaker.
  - The PC-speaker driver plays up to 4 voices by time-slicing PIT channel 2 from slot 8, which doubles the PIT rate.
- **Sound effects.** Always on the PC speaker. A 4-voice priority interpreter (`334e:*`) runs the command streams from `PALS.BLK` `SND:IBM:`.
- **Selection.**
  - `[1fb2]` (music on) and `[1fb0]` (effects on) come from argv `M`/`T`/`S` and from menu toggles.
  - The device-selection word `[2d2a]` and the enables `[2d28]`/`[2d2c]` are never written, so they keep their initial values: auto-detect, music subsystem on, effects subsystem on.
- **Gameplay never depends on sound.** Music completion (`[2d4e]`) is read only to restart the music. Effect voice state is read only inside the effect code.

## Function catalogue

"Blocking" means the function waits on time, input, retrace or hardware, directly or through a callee. Bounded port-polling loops are marked "bounded" (they spin on a port, not on time).

### Timer core (segment 1000)

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`1000:c356` | timerIsr | INT 8 handler. Algorithm in the Translation notes | no (ISR) | All slot calls use `CALLF CS:[..]` (bytes `2E FF 1E/9F`); Ghidra hides the CS override. DS = DGROUP during callbacks. IF stays clear through every callback; the only STI is at `c440`, immediately before IRET
`1000:c442` | timerInstall | `CLI`. Zero the 9 slots `CS:c32c..c34f` and `c350/c352`. Save the old INT 8 vector into slot 0. Set INT 8 = `c356`. PIT ch0 mode `36h`, divisor `0x2000`. `c355 = 0`, counter = 0, `c354 = 0x20`. `STI` | no | Called from `2524:4956`
`1000:c48d` | timerRestore | Restore INT 8 from slot 0. PIT ch0 mode `36h`, divisor 0 (65536) | no | from `2524:4a94`
`1000:c4ab` | timerGetSlot(n) | Returns `DX:AX` = slot n for n < 9, else 0 | no | No callers. Not a Ghidra function; ndisasm `c4ab–c4cb`
`1000:c4cc` | timerSetSlot(n, off, seg, shift) | For n < 9, under `CLI`: store the slot. If n == 8: round `c355` up to a multiple of `0x20` (`(c355+0x1f)&0xe0`). Then `AH = 0x20`, and if the pointer is non-null and 1 ≤ shift ≤ 5, `AH = 0x20>>shift`. Set `c354 = AH` and PIT ch0 divisor `AH<<8` | no | `shift` (`[BP+0xc]`) is read only when n == 8 and the pointer is non-null. `2524:4956` and `1000:cdac` push 3 arguments only, which is harmless
`1000:c523` | timerGetCounter | `DX:AX = CS:c32a:c328` | no | No callers
`1000:c52d` | timerSetUserCallback(off, seg) | `CS:c350/c352` | no | Only via `2524:4942`, called once from `2524:02f4` with `1000:a3be`

### Time consumers (from the timing sweep)

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`1000:a3be` | timerTickCallback | `if ([5a9e] != 0) [5a9e]--` | no (ISR) | Unsigned non-zero test
`1000:a390` | timerSet(n) | `[5a9e] = n` | no |
`1000:a39c` | timerGet | `AX = [5a9e]` | no |
`1000:a3a0` | timerWait | Loops while `s16([5a9e]) > 0` | **yes** (timer) | Signed test (`JG`). Exits at once if the value is ≥ `0x8000`
`1000:a3aa` | delayTicks(n) | `timerSet(n); timerWait()` | **yes** | Unit: user-callback ticks (7/8 × 145.65 ≈ 127.4 Hz average)
`1000:c070` | delayTicksFar(n) | Wrapper of `a3aa` | **yes** | Callers `2524:0c49`, `0c5c`
`2524:4850` | titleScreen | `timerSet(720)`. Polls `timerGet`. On each change, palette cycle `2524:478a` and `anyInputPending` `2524:0534`. Exits at 0 or on input | **yes** (timer, input) |
`2524:478a` | titlePaletteCycle | Rotates palette bytes, then `1000:aeaa` | **yes** (retrace) | Adapter 2/3 only
`1000:aeaa` | waitVRetraceStart | Spins on 3DAh bit 3: wait while set, then while clear | **yes** (retrace) | Only caller `2524:4816`
`29f6:1d9c` | egaFlipPage(wait) | EGA slot 8 (`DS:4944`). Swaps `[3852]/[3854]`, writes CRTC 0Ch, then waits for retrace start if `wait` ≠ 0 | yes if `wait` ≠ 0 | Only call path: `1000:05bf` → `1ff8:2555` with 0, so it **never waits** in this build
`2524:0c34` | scriptStepDelays | `delayTicksFar([59e8])`, `delayTicksFar([5782])` | **yes** |
`2524:0624` | attractStep | Demo action interpreter. Op 0x57 = 300 × `delayTicks(1)` | **yes** |
`1000:047c` | raceLoop | One fixed simulation step per iteration (body `04ed–06d9`). Input through `1000:6dbc` (non-blocking). Page flip with 0 | no wait of its own | Calls `2524:03f2` to restart music; see Sound glue

### Keyboard (segment 1ff8)

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`2524:0260` | hardwareInit (input + timer part) | In order: `kbdInstall(1)` (1ff8:40c7), `mouseInit` (3fee, skipped for adapter 4, which instead sets `[1fc2]=0x128`, `[1fc4]=0xc5`), pointer clip `[3843..3849]`, `joyCalibrate` (3dd1) if `[1fc0]`, `soundTimerInit(0xd)` (2524:4956, `02e0`), `setTickCallback(1000:a3be, 0xd)` (`02f4`) | bounded (3dd1) | So `3dd1` runs **before** `c442`. The 0xd arguments are ignored
`2524:3c2c` | setPointer(x, y, noMouseSet) | Inclusive clamp to 0..`[1fc2]` × 0..`[1fc4]` (defaults 0x140, 0xc8). If `noMouseSet == 0` and a mouse is present: `mouseSetPos`. If a mouse is present: `mouseGetPos` overwrites `[5a10]/[5a12]` (the mouse wins). If the position changed versus `[5a16]/[5a18]`: `[99bc] = 1` | no |
`1ff8:40c7` | kbdInstall(hook1c) | Saves INT 9/1Ch to `CS:40bf..40c5`. INT 9 = `41ca`. If arg ≠ 0, INT 1Ch = `43a9`. Tandy fix-ups. `[4bb4] = 1`. Clears NumLock (`0040:0017 &= ~0x20`). Sets CapsLock if `[4bb5]` | no | Self-modifying writes at `4140/4146` affect only a Tandy branch that is never enabled
`1ff8:418c` | kbdRestore | Flush the ring, restore INT 9/1Ch | no | from shutdown `1ff8:21cd`
`1ff8:41ca` | int9Handler | Reads port 60h, acks with port 61h bit 7, sends its own EOI, **no chain**. Algorithm in the Translation notes | no (ISR) | Ctrl+Esc → `1000:044a` → `1000:0344` (`"Exit(1)"`) from inside the ISR
`1ff8:43a9` | int1cVirtualStick | Integrates `[4bb8]` directions into axes `4d0d/4d11` (±0x7f, step `[4d19]`) | no (ISR) | Output has **no readers**. IRET, no chain
`1ff8:4457` | kbdGetKey | Under CLI: if head ≠ tail, `AX` = ring word at head, head += 2 wrapping `[0040:0082]`→`[0040:0080]`; else 0 | no | `scan<<8 \| ascii`
`1ff8:44a0` | kbdIsHeld(sc) | `[4cb4+sc] & 1` | no | No BP frame; arg at `[SP+4]`. No bounds check
`1ff8:4486` | kbdStickDir(stick) | `[4d23 + [4bb8 + (stick≠0)]]`: bit 1 up, 2 down, 4 left, 8 right | no | No BP frame
`2524:0534` | anyInputPending | key with ASCII ≠ 0 (dequeues it), mouse L/R, or joystick A button 0/1 | no |

### Menus and event code

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`1000:6a90` | menuFrame | One iteration: `2524:0382` (music restart). Pointer moves 1 px from the joystick or `kbdStickDir(0)` (cooldown `[1f1e]`). Mouse overrides through `2524:3c2c`. Select `[9aee]`. Calls hook `[1f20]`. Redraws the pointer | no |
`1000:66d2` | menuKeyHook (`[1f20]`) | `rand()`. Dequeues a key. Tab → next item. Enter/Space held → select. Alt+C → `1ff8:3dd1` (if `[1fc0]`). `S` → `2524:03dc` (effects toggle). `T` → `2524:039c` (music toggle). Every 200 calls in demo → `2524:0624`. `[9b82] = 1000:3f92(...)` | no | Counts iterations, not time
`1000:3f92` | menuEvent | Stores pointer/button/key, hit-tests (`1000:3fe4`), returns the event code | no |
`1000:6998` | menuPointerShape | Swaps the pointer shape on a zero/non-zero transition of `[9b82]` | no |
`1000:4770` | getMenuId | `AX = [9018]` | no |
`1000:4774` | getMenuItem | `AX = [a464]` | no |
`1000:67e8`, `1000:68dc` | menuLoop, pauseMenuLoop | Loop on `6a90` until event `0xd` (release over an item) | **yes** (input, polling) | `68dc` is also used by pause `1000:75ea`
`1000:6dbc` | raceInput | Fire buttons, `kbdGetKey`, Esc → pause, ASCII jump table at `CS:716a` | no |
`1000:7216` | raceSteer | `joyDir(0)` or `kbdStickDir(0)` → speed `[8926]`, steering `[a97a]` | no |

### Mouse (segment 1ff8)

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`1ff8:3fee` | mouseInit | INT 33h AX=0. Present if AX=FFFFh. Then AX=0Fh (16,16) and AX=4 (0,0). Result → `[aa9a]` | no | Skipped for adapter 4
`1ff8:4014` | mouseShutdown | INT 33h AX=0 | no |
`1ff8:4025` | mouseGetPos(&x,&y) | AX=3; `x = CX>>1`, `y = DX` | no |
`1ff8:404b` | mouseSetPos(x,y) | AX=4; `CX = 2x`, `DX = y` | no |
`1ff8:4068` | mouseButton(which) | AX=3; `which == 0` → `BX&1`, else `(BX>>1)&1` | no |
`1ff8:408a` | mouseRaw | Generic INT 33h pass-through | no | No callers. No AX=0Ch handler anywhere
`1ff8:0006` | loadPointers | Pointer shapes from PALS.BLK → `[9bf6]` | no | Format not analysed

Cursor drawing (`1000:6c3c–6ccd`, through driver slots):
1. Save the background on the back page (slot 5, `DS:4938`).
2. Draw the shape (slot 3, `4930`).
3. Copy the old and new rectangles to the front page (slot 4, `4934`).
4. Restore the back page (slot 7, `4940`).

The back page never keeps the cursor. There is no show/hide call.

### Joystick (segment 1ff8)

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`1ff8:3d5d` | joyAxisRaw (BL = mask) | Near, register argument. Waits ≤ 255 polls of 201h for the bit to clear; on timeout `AX = 0x00ff`. Otherwise counts | **bounded** (port 201h) |
`1ff8:3dd1` | joyCalibrate | PIT ch0 → divisor 0. Times 1000 polls of 201h with PIT latch reads (`IN 40h`). **Reloads PIT ch0 from `[9bc0]`**. Probes the 4 axes and sets the presence flags `[4b9a]` (A) and `[4b9b]` (B) | **bounded** (201h) | Called from `2524:02d7` (before the timer install) and from `1000:674f` (Alt+C in menus)
`1ff8:3d99` | joyScale (AX = raw, BL = centre, CX = scale) | Near, register arguments. Returns a signed value clamped to ±0x7f, with a dead zone (< 8 → 0) | no | Reached only when a stick is present
`1ff8:3ee5` / `3f62` / `3fc2` | joyRead / joyDir / joyButton | Return 0 without port access when the stick is absent | via `3d5d` when present | `3fc2` sets only AL when absent

### Sound glue (segment 2524)

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`2524:4956` | soundTimerInit | `timerInstall`. If `[2d28]`: slots 1, 3, 5, 7 = `1000:c731`. Device by `[2d2a]` (1 speaker, 2 Tandy, 3 AdLib, 4 MT-32, other = auto-detect MT-32 → AdLib → Tandy → speaker). Install with `1000:cd72` if detected. If speaker or Tandy, `[2d34] = 1`. `[2d38] = 1`. Returns `soundDeviceType()` | bounded (detection) | `[2d28]`=1 and `[2d2a]`=0 are never written. The `[2d34]` and `[2d38]` writes happen even when detection failed (`4a46→4a5f`). Called from `2524:02e0`
`2524:4a94` | soundTimerShutdown | `32e3:0013` (stop effects). Speaker off. If a device: stop music, `cdac` uninstall. Clear slots 1/3/5/7. `timerRestore`. Speaker off. `[2d38] = 0` | via `cbb6` on MT-32 | from `1ff8:21cd`
`2524:4b00` | soundDeviceType | `[2d32]`: `2ec8`→4, `2d8a`→3, `3004`→2, `34d6`→1, else 0 | no |
`2524:4b34` | loadMusic(name) | Opens the file and reads chunk `"SND:"` through the 1ff8 loader (decompresses). Returns a far pointer | no | `danger.mus` → `[8f06]` (main `0179`); `trax.mus` → `[8f02]` (`2524:01da`)
`2524:01da` | loadRaceMusic | Probes for a 128 KiB allocation (`1ff8:3a08(0,2)`, then frees it). If it succeeds, loads `trax.mus`. Otherwise frees `danger.mus` and sets `[1fb2] = 0` | no | inferred: the allocation is a free-memory test
`2524:039c` | toggleMusic | No music loaded → `[1fb2] = 0`. Else if on: `[1fb2] = 0`, `c6dc` mute. Else `[1fb2] = 1`; if device type ≤ 2, speaker gate on (`c54a`); `c6fa` unmute | no |
`2524:03dc` | toggleEffects | `[1fb0] ^= 1` (as 0/1) | no |
`2524:23fe` | setSoundOption(k) | Writes the *inverse* of option k into `[1fb2]/[1fb0]`, then calls `03dc` and `039c`, which toggle them back. Net result: k=0 both on, 1 effects only, 2 music only, 3 none | no | No direct callers (inferred: menu jump table). `2524:2396` displays the same 0–3 mapping
`2524:03f2` | playMusic(ptr) | `c715` stop; if `[1fb2]` and ptr ≠ 0, `c60a(ptr, 1)` | no |
`2524:0382` | menuMusicKeepAlive | If `c552() == 0`, `playMusic([8f06])` | no | Every menu frame
`2524:041a` | playEffect(n) | If `[1fb0]` and `[8f9c]` (bank loaded): `2524:4cfa(n, 1)` | no | Callers: `1000:6dbc`, `731a`, `7a9c`, `7daa`, `7fbe`, `9bcc`; `2524:426c`
`2524:4cfa` | startEffect(n, prio) | If `[2d2c]`: `[365f] = 1` (wakes the ISR effect tick), `32e3:043f(n, prio)` | no |
`2524:4cb6/4cbc/4cc2/4cc8/4cce/4cd4/4c9e/4cda` | wrappers | `c715` stop, `c6dc` mute, `c6fa` unmute, `c6a3` pause, `c6c1` resume, `c552` status, `c60a(p,1)` play, play-if-idle | no | `4cda` has no callers. `1000:75ea` (pause) uses `c6a3/c6c1`
`2524:4942` | setTickCallback | → `c52d` | no |

### Music sequencer (1000:c543–c8c5)

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`1000:c543` / `c54a` | speakerGateOff / speakerGateOn | port 61h `&= ~3` / `\|= 3` | no |
`1000:c552` | musicStatus | `AX = [2d4e]` | no |
`1000:c556` / `c55c` | musicLock / musicUnlock | `[2d58] = 1 / 0` | no | No callers
`1000:c562` | musicGetPosition(far*) | Copies `[2d52..2d57]` (tick in beat, beat in bar, bar) | no | No callers
`1000:c581` | musicSetCallbackRate(n) | `[2d40] = n`, `[2d44] = 0` | no | No callers; `[2d40]` stays `0x1110`
`1000:c597` | musicSetTempo(ppq, bpm) | `[2d42] = lo16(ppq*bpm)`, `[2d44] = 0` | no | from meta 51h with (0x60, BPM)
`1000:c5ac` | musicSetTimeSig(nn, denom, q) | `[2d48] = q`, `[2d46] = 0x180*nn / (q*denom)` | no | from meta 58h
`1000:c5c7` | allNotesOff | For channels 16..1: `d1f8(0xAF+ch)`, `d1f8(0x7B)`, `d1f8(0)` | via the driver (MT-32) | near
`1000:c5f3` | readVarLen | ES:SI MIDI variable-length quantity → DX:AX | no | near, register I/O
`1000:c60a` | musicPlay(far ptr, flags) | If flags bit 0 is set: requires `"MThd"`, any length, format 0, ntrks 1, division `0x60`, then `"MTrk"`. Stops old music (`c5c7` if playing). `[2d50]` = first delta, `[2d4a]` = event pointer, `[2d4e]` = flags, `[2d52..56]` = 0. Returns flags, or 0 on a bad header | no | Header words compared byte-swapped (`0x0000`, `0x0100`, `0x6000`)
`1000:c6a3` / `c6c1` | musicPause / musicResume | Set/clear `[2d4e]` bit 1 (pause runs `c5c7`) | no |
`1000:c6dc` / `c6fa` | musicMute / musicUnmute | Set/clear bit 2 (mute runs `c5c7`); note on/off are skipped while muted | no |
`1000:c715` | musicStop | If playing: `[2d4e] = 0`, `c5c7` | no |
`1000:c731` | musicTick | Timer slots 1/3/5/7 (72.83 Hz). Algorithm in the Translation notes | no (ISR) | Re-entrancy guard `[2d59]`
`1000:c7b1..c8c5` | event handlers | `c7b1` sysex F0, `c7bc` F7 continuation, `c7d8` meta, `c854` read the next delta, `c88a` note (skipped when muted), `c897` 3-byte, `c8a8` 2-byte, `c8b9` 1-byte | no | Jumped to from the `c731` tables `DS:2d5b`/`2d69`

### Device layer and drivers (1000:c8c6–d39b)

The device descriptor is a DGROUP struct (layout under Data). `[30d2]` points to the current one.

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`1000:cd68` | deviceDetect(desc) | `CALL [desc+4]` | bounded | MT-32 and AdLib probes poll ports
`1000:cd72` | deviceInstall(desc) | Shut down the old device (`[old+8]`). `[30d2] = desc`. Push `(8, [desc+14h], CS, byte [desc+16h])`, then `CALL [desc+6]` (init). `[desc+17h] = [desc+3]` (voice count). `d0ae` resets the synth. `c4cc` with the **same pushed frame** = `timerSetSlot(8, tick, CS, shift)` | no | One frame serves three calls
`1000:cdac` | deviceUninstall | `[desc+8]`, `[30d2] = 0`, `timerSetSlot(8, 0)` (rate back to `0x20`) | MT-32: waits for the queue to drain |
`1000:cdcc` | deviceRawOut(b) | `CALL [desc+0Ah]` with AL = b. Returns AX ≠ 0 if the device consumed the byte | MT-32: waits while the queue is full | `[30d2] = 0` would call `[000Ah]`; see Open questions
`1000:d1f8` | midiOut(b) | `deviceRawOut`. If that returns 0, a built-in MIDI parser: state `[37bc]` indexes jump table `DS:37a0`; channel `[37be]`, data1 `[37c0]`. Dispatches to note off `cdda`, note on `ce63`, program `cf43`, controller 7Bh+ `cf1b`, sysex `cf6d`, FFh reset `d0ae`; the rest are no-ops | via `cdcc` |
`1000:cdda` / `ce63` | synthNoteOff / synthNoteOn | Voice allocation over the list at `30d4` (voices `0x12` bytes from `30da`) and the channel table `31a0` (8 bytes per entry); calls `[desc+0Eh]` / `[desc+0Ch]` | no | Linked-list priority allocator; translate from the asm
`1000:cf1b` | synthAllOff | Every active voice: `[v+5] = 0`, `[desc+0Eh]` | no |
`1000:cf43` | synthProgram(ch, prog) | `[31a0+8ch+3] = prog`, `[+6] = 3328 + 12·prog` | no |
`1000:cf6d` | synthSysex(b) | State machine `[34c8]`. Accepts F0, then `id == byte [desc+2]` (speaker 7Fh, Tandy 7Eh, AdLib 7Ah, MT-32 41h), then cmd < 3, then a length, then collects bytes into `34a8`. Dispatches `[34d0+2·cmd]`: `cfde` channel setup, `d083` patch (`[desc+12h]`), `d09f` voice count + `d0c7` | no | The `.mus` files contain many `F0 7F` (speaker) sysex events
`1000:d0ae` / `d0c7` | synthReset / synthBuildVoices | Clears `31a0` (0x180 bytes). Builds `[desc+17h]` voices at `30da`, `[desc+18h] = 30da`, calls `[desc+10h]` | no |
`1000:d31e` | udiv32(lo, hi, dlo, dhi) | Unsigned 32/32 shift-subtract divide. Returns 0 if either operand is 0 or the divisor > the dividend | no | Used for `60000000 / tempo`
`1000:d384` | (wrapper) | → `1000:e80c` | no |
**Speaker** `34d6` | | | |
`1000:d110` | spkDetect | `AX = 1` (always present) | no |
`1000:d114` | spkInit | PIT ch2 mode `B6h`, divisor `0x14` (`[3506]`), gate on (`61h \|= 3`) | no | 59.7 kHz, inaudible "silence"
`1000:d12d` | spkShutdown | gate off | no |
`1000:d136` | spkRawOut | `AX = 0` (use the built-in parser) | no |
`1000:d139` | spkNoteOn | `[v+0Ah]` = note < 14 ? `0x14` : `DS:3508[note−14]`. Writes PIT ch2 directly only if voices ≤ 1 | no |
`1000:d159` | spkNoteOff | `[v+0Ah] = 0x14` (same ≤ 1 rule) | no |
`1000:d17b` | spkVoicesInit | Each voice: `[v+4] = 1`, `[v+0Ah] = 0x14`; `[3502]`, `[3505]` | no |
`1000:d19f` | spkTick | Slot 8. Every 2nd call (`[3504]`), if voices > 1: write the next voice's `[v+0Ah]` to PIT ch2 when it differs from `[3506]`, round-robin | no (ISR) | With 4 voices: 72.8 Hz slices, each voice 18.2 Hz
`1000:d1e8` | spkRestoreDivisor | PIT ch2 mode `B6h`, divisor `[3506]` | no | Called from the ISR after an effect ends
**MT-32 / MPU-401** `2ec8` | | | |
`1000:cb3e` | mpuDetect | Port 331h: wait for bit 6 clear, write FFh, wait for bit 6 clear, write 00h to 331h (`cb57`), wait for bit 7 clear, read 330h == FEh | **bounded** (3 × ≤ 65536 polls) | `IN 331h = FFh` → fails
`1000:cb72` | mpuInit | UART mode 3Fh. Hooks INT 0Ah (IRQ 2) → `cc2d`. Unmasks every IRQ (`OUT 21h, 0`) | no | Unsupported in the port
`1000:cbb6` | mpuShutdown | Spins until the queue `[3002]` is 0, restores INT 0Ah | **yes** (queue drained by slot 8) |
`1000:cbd0` | mpuOut | Spins while the queue is ≥ 256, then enqueues into ring `2efe` | **yes** | Does `STI`, so interrupts re-enable inside the ISR
`1000:cbfc` | mpuTick | Slot 8 (shift 4 → 2330 Hz). Sends one queued byte if 331h bit 6 is clear | no (ISR) |
**AdLib** `2d8a` | | | |
`1000:c8c6` / `c8e5` / `c93e` / `c966…cabc` | oplWrite / oplDetect / oplInit / voice ops | Port 388h, timer test | bounded | `IN 388h = FFh` → detect fails at `c8f7`. `+14h = 0`, but `cd72` pushes CS as the segment, so slot 8 becomes the non-null `1000:0000`. It is never called, because shift 0 keeps `c354 = 0x20`
**Tandy** `3004` | | | |
`1000:cc3a` / `cc58…cd26` | tandyDetect / … | Detect: F000:FFFE == FFh and F000:C000 == 21h. Port C0h | no | Tick `cd26` (shift 1)

### Sound effects (segments 32e3, 334e)

addr | proposed name | purpose | blocking? | notes
---|---|---|---|---
`32e3:009a` | sfxLoadBank(file) | Finds a free bank slot (≤ 10, 0x16 bytes at `2c2c`). Chunk `SND:INF:`: skips a word, reads count → `+10h`, word → `+12h`. `01f1` loads `SND:IBM:` and relocates. `026a` loads `SND:ITM:` → `+14h`. Returns bank+1 | no | from main `0104` with PALS.BLK → `[8f9c]`
`32e3:01f1` | sfxLoadRelocate | Loads the chunk (`026a`), then adds the buffer far pointer as a 32-bit value to each non-zero dword of the leading pointer table | no | 32-bit add of offset and segment words with carry
`32e3:026a` | loadChunk(node, file, name) | Seeks the chunk, opens a (decompressing) stream, allocates with INT 21h 48h (`1ff8:3a88`, offset 0), reads in 20000-byte pieces, links the node | no |
`32e3:05ba` | sfxSelectBank(id) | `[9a40] = id−1` if loaded | no | main `0110`
`32e3:043f` | sfxStart(n, prio) | Bounds check `n < count`. Stream = `table[n]`. If `type == 0`: voice = `050a(prio, stream)`, reject if > 4, reject if `prio[voice] > prio`, `334e:01d3(stream, voice, ITM ptr, 0)`. Then `prio[voice] = prio` (`[3628]` via ES = `[56a6]` = DGROUP), `[8ea6+2v] = n`. Returns 1 | no | type ≠ 0 skips the allocation and uses an uninitialised voice index (`[BP-0Eh]`). Every stream in PALS.BLK has type 0
`32e3:050a` | sfxPickVoice(prio, stream) | near, `[BP+4]` = prio. type 2 → 8. Header `+6` ≠ 0 and type 1 → voice 2. Else first voice 0..3 with prio 0; if none, the **last** voice with minimal prio. If `prio[v] > prio`, return 4 | no | Returning 4 passes `043f`'s `> 4` test and indexes a 5th slot (`3630`, `3651`, `3791`). Unreachable with prio 1 (inferred)
`32e3:0013` | sfxStopAll | For voices **0..2** only: `334e:01ac(v)`, `prio[v] = 0`. Then `334e:0000` | no | Voice 3 is not stopped
`32e3:0054` / `0675` / `05f5` / `0630` | sfxStopId / sfxSetFreqById / sfxUnloadBank / freeChunks | | no | No callers
`334e:0000` | sfxTick | ISR, on every interrupt while `[365f]` ≠ 0. Algorithm in the Translation notes | no (ISR) | Skipped while `[3659]` (start lock)
`334e:0078` | sfxVoiceTick | near; DI = voice, ES = stream segment | no |
`334e:00f9` | sfxVoiceStep | near command interpreter (`00f9–01ab`, including the jump-table targets `0119`, `0196`, `019d`) | no | Decompile is wrong (`(char)x < -0x80`); use the asm
`334e:01ac` | sfxVoiceStop(v) | `[3649+2v] = 0`, `[v+2] = 0`, `[v+0Ah] = 0` | no |
`334e:01d3` | sfxVoiceStart(stream far, v, itmOff, itmSeg) | `[3659] = 1`. Active, segment `[3638]`, `[35f8] = itmOff`, `[3608] = itmSeg`. If type 0, or type 1 with `+6` ≠ 0: `[v+0] = stream+8`, clear `[v+2..v+2Eh]`, `[v+2] = 1`. `[3659] = 0` | no |
`334e:0242` | sfxVoiceSetFreq(v, f) | `[v+4] = f` | no | Only from the uncalled `0675`

## Data

### Code-segment data (segment 1000)

addr | width | meaning
---|---|---
`CS:c328` | u32 | Tick counter, `+0x1c2` per base tick (≈ 65543.5/s). Readers: `c523` only (uncalled)
`CS:c32c + 4n` | far ptr ×9 | Slot n. Slot 0 = saved BIOS INT 8, 1–7 = 18.2 Hz callbacks, 8 = device tick
`CS:c350` | far ptr | User callback, `1000:a3be` for the whole session
`CS:c354` | u8 | Phase step: `0x20 >> shift`. Also the PIT divisor high byte
`CS:c355` | u8 | Phase accumulator; the pre-add value selects the action

### DGROUP: timer, menu and sound globals

off | width | init | meaning
---|---|---|---
`5a9e` | u16 (tested signed in `a3a0`) | 0 | Down-counter in callback ticks
`1fb0` | u16 | 1 | Effects enabled (argv `Sn` = digit−'0'; menu)
`1fb2` | u16 (the ISR tests the low byte only, `c395`) | 1 | Music enabled (argv `Mn`/`Tn`; menu; forced 0 when out of memory)
`1fc0` | s16 | **1** | Joystick option (argv `Jn`)
`2d26` | u16 | 1 | Slot 8 enabled. 1 before each effect tick; 0 while an effect plays on a speaker/Tandy device
`2d28` | u16 | 1 | Music subsystem (slots 1/3/5/7). Never written
`2d2a` | u16 | 0 | Device request (0 = auto). Never written
`2d2c` | u16 | 1 | Effects subsystem. Never written
`2d2e` | u8 | 1 | Effect-tick countdown, decremented every interrupt
`2d30` | u8 | 1 | Its reload. Never written, so the effect tick runs on every interrupt
`2d32` | u16 | 0 | Selected descriptor (`2ec8`, `2d8a`, `3004`, `34d6`, or 0)
`2d34` | u16 | 0 | 1 for speaker/Tandy: the ISR mutes slot 8 during effects and restores the speaker afterwards
`2d38` | u8 | 0 | Sound initialised (write-only as far as searched)
`2d40` | u16 | `0x1110` | Callback divisor (4368 ≈ 72.83 × 60)
`2d42` | u16 | `0x2d00` | `0x60` × BPM (default 120)
`2d44` | u16 | 0 | Remainder
`2d46` / `2d48` | u16 | `0x60` / 4 | Ticks per beat / beat divisor (`c5ac`)
`2d4a` | far ptr | – | Next MIDI event
`2d4e` | u16 | 0 | Flags: bit 0 playing, 1 paused, 2 muted, 3 no position counting
`2d50` | s16 | – | MIDI ticks: ≥ 0 means an event is due
`2d52/54/56` | u16 | 0 | Tick in beat, beat in bar, bar
`2d58` | u8 | 0 | Main-code lock (the tick accumulates time but does not process events)
`2d59` | u8 | 0 | `c731` re-entrancy guard
`2d5a` | u8 | 0 | Running status
`2d5b` | 7 × near ptr | – | Handlers for 8x–Ex: `c88a c88a c88a c897 c8a8 c8a8 c897`
`2d69` | 16 × near ptr | – | F0–FF: `c7b1 c8a8 c897 c8a8 c854 c854 c8b9 c7bc c8b9 c854 c8b9 c8b9 c8b9 c854 c8b9 c7d8`
`2d08`, `2d11`, `2d1a`, `2d39` | strings | | `"SND:INF:"`, `"SND:IBM:"`, `"SND:ITM:"`, `"SND:"`. `2d23`/`2d3e` = `"r"`
`30d2` | near ptr | 0 | Current descriptor
`30d4` | list head | | Voice list (doubly linked, `[n+0]` next, `[n+2]` prev)
`30da + 0x12·i` | struct | | Synth voice: `+4` flags, `+5` busy, `+6` owner channel entry, `+8` note, `+9` key, `+0Ah` divisor/frequency word, `+0Ch` …, `+0Dh` …. Partly inferred
`31a0 + 8·ch` | struct ×48 | | Channel table: `+0` mask, `+1` priority, `+2` voices allocated, `+3` program, `+4` flags, `+5` free count, `+6` patch pointer (`3328 + 12·prog`). Partly inferred
`3502` / `3504` / `3505` / `3506` | u16 / u8 / u8 / u16 | | Speaker round-robin pointer, ÷2 prescaler, count, current PIT ch2 divisor
`3508` | 114 × u16 | | Speaker divisors for MIDI notes 14..127 (65009 = 18.35 Hz … 95)
`37a0` | 14 × near ptr | | Parser states. `37bc` = state (init `0x12`, idle), `37be` channel, `37c0` data1, `37c2` mod wheel
`34c8..34d5` | | | Sysex state, length, buffer pointer; handlers `34d0` = `cfde d083 d09f`

**Device descriptor** (`2ec8` MT-32, `2d8a` AdLib, `3004` Tandy, `34d6` speaker):

off | meaning | speaker values
---|---|---
`+0` | name ptr | `34f0` "Internal Speaker"
`+2` | byte: sysex id; `+3` byte: voice count | 7Fh, 4 (MT-32 41h/0; AdLib 7Ah/0Bh; Tandy 7Eh/7)
`+4/+6/+8` | detect, init, shutdown (near) | `d110`, `d114`, `d12d`
`+0Ah..+12h` | raw out, note on, note off, voices init, patch | `d136`, `d139`, `d159`, `d17b`, `d19e`
`+14h` | slot-8 tick (offset in segment 1000) | `d19f` (MT-32 `cbfc`, Tandy `cd26`, AdLib 0)
`+16h` | byte: rate shift | 1 (MT-32 4, Tandy 1, AdLib 0)
`+17h` / `+18h` | runtime voice count / voice array | 4 / `30da`

### DGROUP: sound effects

off | width | meaning
---|---|---
`2c2c + 0x16·b` | bank | `+0` IBM data far ptr (first chunk node), `+4` next node, `+6` name, `+10h` count (11), `+12h` INF word 2, `+14h` ITM node pointer (0 when absent)
`8f9c` | u16 | Loaded bank id (0 = none)
`9a40` | s16 | Selected bank (−1 none)
`3628 + 2v` | u16 ×4 | Voice priority (0 = free)
`3638 + 2v` | u16 | Voice stream segment
`35f8 + 2v` / `3608 + 2v` | u16 | ITM offset / segment from `01d3`. `3608` is never read
`3618 + 2v` | u16 | Envelope-table base for op 2Ch. Never written (raw search: only the read at `334e:0185`)
`3649 + 2v` | u16 | Voice active (ANDed with byte `[35ef]` = 3)
`35f4` | u16 | Best priority this tick
`35f6` | u16 | Current voice ×2
`3659` | u8 | Start lock
`365b` | u16 | Global mark for ops 7Ah/(0196)
`365f` | u16 | Output voice pointer, or wake flag (`4cfa` sets 1)
`3661` | 4 × near ptr | `0196 019d 018f 0119`
`3789 + 2v` | near ptr | Voice structs `3669, 3699, 36c9, 36f9` (0x30 bytes; the table has 11 entries, 4 used)
`8ea6 + 2v` | u16 | Effect id per voice

**Effect voice struct** (0x30 bytes): `+0` stream ptr (0 = ended), `+2` tick countdown, `+4` base PIT divisor, `+6` divisor slide/tick, `+8` output divisor, `+0Ah` gate (≠ 0 → speaker on), `+0Ch` gate slide/tick, `+16h` envelope index, `+18h` envelope countdown, `+1Ah` wave phase (×16), `+1Ch` phase step, `+1Eh` wave depth (signed), `+20h` loop counter, `+2Ah` phase wrap, `+2Ch` envelope table, `+2Eh` wave pointer.

### Input data

Code-segment tables:

addr | width | meaning
---|---|---
`1ff8:40bf/40c1` | far ptr | Saved INT 9 vector (offset, segment)
`1ff8:40c3/40c5` | far ptr | Saved INT 1Ch vector
`1000:716a` | 64 × near ptr | `raceInput` dispatch on `toupper(ascii)`, 20h..5Fh. Default `7216`. Non-default entries: ' ' `6f1e`, '1'/'!' `7111`, '2'/'@' `7118`, '3'/'#' `7120`, '4'/'$' `7128`, '5'/'%' `7130`, '6'/'^' `7138`, '7'/'&' `7140`, '+'/'=' `707a`, '-'/'_' `708a`, A `714c`, C `70d2`, H `70fe`, M `70a0`, P `706c`, S `7162`, T `715a`, W `7106`
`1000:705a` | 7 × near ptr | Space/fire action indexed by `[9bc8]−1` (weapon type)

DGROUP:

The full detail is in the keyboard rows above.

off | width | meaning
---|---|---
`4cb4[0x59]` | u8 | Per scancode. Bit 0 held. `0x04` letter. Bit 3 stick index. Bits 4–7 direction 1..9
`4bb8[2]` | u8 | Virtual stick direction (0 none, 1 R, 2 DR, 3 D, 4 DL, 5 L, 6 UL, 7 U, 8 UR, 9 centre)
`4c02` / `4c5b` | u8 ×0x59 | Unshifted / shifted ASCII. Bit 7 marks a shift key
`4d23[10]` | u8 | Direction → bitmask `00 08 0a 02 06 04 05 01 09 00`
`4d0d..4d13` | s16 | INT 1Ch axes. No readers
`4bb2`, `aa9a` | u8, u16 | Mouse present
`4b9a`, `4b9b` | u8 | Joystick A / B present
`9bc0` | u16 | PIT ch0 divisor reloaded by `3dd1`. Never written (BSS, inferred 0)
`9b82` | u16 | Menu event: 0 outside, 0Bh inside the box, 0Ch held over an item, 0Dh released over an item (activate, item in `[a464]`), 0Eh text field

## Environment touch points

- **PIT.**
  - Ch0 mode 36h: divisor `0x2000` (`c442`), `(0x20>>shift)<<8` (`c4cc`), 0 (`c48d`, `3dd1`), `[9bc0]` (`3dd1`).
  - Ch0 latch reads (`OUT 43h,0/6`; `IN 40h`) in `1ff8:3dd1` only.
  - Ch2 mode B6h + divisor: `d114`, `d167`, `d19f`, `d1e8`.
  - **Ch2 divisor without a mode write**: `334e:005b–0062`.
- **Port 61h.** Bits 0–1 in `c39c`, `c543`, `c54a`, `d114`, `d12d`, `334e:006d`. Bit 7 pulse in INT 9.
- **PIC.** EOI `OUT 20h,20h` (ISR, INT 9, `cc2d`). `OUT 21h,0` in `cb72` (MT-32 only).
- **Interrupt vectors** (INT 21h 35h/25h): 08h (`c442`, `c48d`), 09h and 1Ch (`40c7`, `418c`), 0Ah (`cb72`, `cbb6`, MT-32 only).
- **INT 33h** functions 0, 0Fh, 3, 4. **No INT 16h, no INT 1Ah.**
- **Ports.**
  - 60h; 201h (`3d5d`, `3dd1`, `3ebb`, `3fdd`); 3DAh (`aeaa`, `29f6:1dcc`, Tandy `3168:*`).
  - 330h/331h (MPU), 388h/389h (OPL), C0h/C1h (Tandy).
- **BIOS data.** `0040:0017`, `001A`, `001C`, ring `001E–003D`, `0080`, `0082`, `0063` (CRTC base), `0096` (Tandy).
  - 0040:006C is updated by the chained BIOS INT 8 but never read.
- **ROM.** `F000:FFFE`, `F000:C000` (Tandy probes `cc3a`, `1ff8:528a`).
- **Files.**
  - `PALS.BLK` (`SND:` → `INF:`, `IBM:`; there is no `ITM:` chunk; also the pointer shapes).
  - `danger.mus`, `trax.mus`: each is an `SND:` chunk, method 2 (compressed) per the header, holding an SMF. The decompression belongs to the asset loader.

## Translation notes

### Timer ISR on a virtual clock

- Host loop: keep a PIT ch0 divisor register, written by `OUT 43h,36h` followed by two `OUT 40h` bytes (low, high; 0 means 65536). Raise IRQ 0 every *divisor* PIT input clocks.
  - That one rule covers `c442` (`0x2000`), `c4cc` (`(0x20>>shift)<<8`: 4096 with the speaker device, 512 with MT-32), `c48d` (65536), and both writes in `1ff8:3dd1`.
  - In the normal flow, `c4cc` keeps `c354<<8` equal to the divisor. Only `3dd1` breaks that (the Alt+C hazard below).
  - Before `c442` hooks INT 8, IRQ 0 runs only the BIOS INT 8 model (0040:006C++, INT 1Ch, which is still the BIOS stub until `40c7` hooks it). It runs at whatever divisor is set: the BIOS default 65536, or the value `3dd1` left.
- `timerIsr`, in this order:
  1. `if (--byte[2d2e] == 0) { byte[2d2e] = byte[2d30]; if (w[365f]) { w[2d26] = 1; sfxTick(); if (w[2d34]) { if (w[365f]) w[2d26] = 0; else if (byte[1fb2]) { port61 |= 3; spkRestoreDivisor(); } } } }`
  2. `old = c355; c355 = u8(old + c354);`
  3. If `old == 0`: `counter += 0x1c2`, then run the BIOS INT 8 model (0040:006C++, INT 1Ch = `int1cVirtualStick`, EOI). Return.
  4. Else if `old & 0x1f`: `if (w[2d26]) slot8()`. Return.
  5. Else: `counter += 0x1c2; if (c350) c350(); slot[old>>5]?.()`.
- The effect tick therefore runs at the **interrupt** rate:

  | device | interrupt rate | effect tick |
  | --- | --- | --- |
  | none / AdLib | 145.65 Hz | 145.65 Hz |
  | speaker / Tandy | 291.3 Hz | 291.3 Hz |
  | MT-32 | 2330 Hz | 2330 Hz |

  Effect durations scale with the device. In the port the speaker is always detected, so 291.3 Hz.
- Slots 1–7 and the user callback keep their base rates regardless of the shift. With shift 1, slot 8 runs on the 8 odd interrupts per 256-phase cycle (145.65 Hz).
- No callback nests: IF stays clear. The exception is the MT-32 `cbd0` (`STI`), which is unsupported.
- Bit-exact: the counter is a u32 that wraps. `c4cc` rounds the phase up when slot 8 is set.
- **Alt+C hazard** (inferred): `1000:674f` → `1ff8:3dd1` reprograms PIT ch0 with `[9bc0]` = 0 (65536) after the timer install. From then on interrupts arrive 8× (speaker device: 16×) slower while the ISR logic is unchanged, and the music, effects and `[5a9e]` all slow down. The divisor-register rule above reproduces this, provided the `3dd1` stub keeps its PIT write.
- **`3dd1` divides by the elapsed PIT count without a guard**: `SUB SI,DI` / `MOV AX,6FCCh` / `DIV SI` at `3e1e–3e25` (the zero test at `3e27` checks the quotient, not the divisor).
  - `[1fc0]` defaults to 1, so this runs at every startup.
  - A literal translation whose latched PIT readback (`IN 40h` at `3de6/3dea`, `3e03/3e07`) does not move during the 1000-poll loop gets SI = 0, and `div16` throws before the title screen.
  - **Required stub** for "no joystick" (port 201h absent): `CLI`; PIT ch0 mode 36h divisor 0; PIT ch0 mode 36h divisor `[9bc0]` (keep both writes); `[4b9a] = [4b9b] = 0`; `[4bab] = 1`; return `AL = 0`.
  - This skips the 201h polls and the PIT readback. `[4bab]` is read only by `3d5d`, which is never reached with both flags 0. `APPROX:` the real value of `[4bab]` is unused.

### Blocking and the generator boundary

| kind | functions |
| --- | --- |
| generators (time) | `a3a0`, `a3aa`, `c070`, `2524:0c34`, `2524:0624`, `2524:4850` |
| generators (retrace) | `aeaa`, `2524:478a`; `29f6:1d9c` only when its argument ≠ 0 |
| generators (input) | the menu loops `1000:67e8`, `1000:68dc` and their callers (pause `1000:75ea`): each iteration must `yield* idle()` |
| loop pacing | the race loop has no wait at all, so the host must pace it: `APPROX:` one frame per chosen virtual interval |

**Pacing changes outcomes, not just speed.**
- `rand()` (`1000:a3ca`) is called once per menu iteration (`1000:66d2`) and once per race frame (`1000:7216`).
- The number of menu iterations before a race therefore sets the RNG state at race start, including the copy-protection answer shuffle `2524:21d2`.
- Menu and race iterations must sit at deterministic virtual-time points: a fixed number of PIT clocks per iteration, chosen once.
- Recorded inputs replay correctly only against those same points, so the env log must key inputs by iteration or virtual time, never by host time.
| bounded port loops, not time waits | `3d5d`, `3dd1`, `cb3e`, `c8c6`, `c8e5`. Translate them with the port values below, or stub the detection to return "absent" |
| never in the port | `cbb6`, `cbd0` (MT-32 queue waits) |

### Port values for the supported configuration

- `IN 331h` → FFh: `cb3e` fails after 65536 polls. It can be short-circuited to 0 because the polls have no side effects beyond time.
- `IN 388h` → FFh: `c8e5` fails at `c8f7`.
- `F000:FFFE` ≠ FFh (for example FCh): Tandy fails.
- The speaker is then selected:
  - `[2d32] = 34d6`, `[2d34] = 1`, `[2d38] = 1`, `[30d2] = 34d6`
  - slots 1/3/5/7 = `c731`, slot 8 = `d19f` with shift 1, `c354 = 0x10`, PIT ch0 divisor `0x1000`
  - `spkInit` leaves the gate on with PIT ch2 divisor `0x14`
- Joystick absent: use the required `3dd1` stub (under "Timer ISR on a virtual clock"), not `IN 201h` → FFh with a literal translation, because of the divide by the elapsed PIT count. `[4b9a] = [4b9b] = 0`, so later joystick reads do no port I/O.

### Music tick `1000:c731`

1. If `[2d59]`, return. Set `[2d59] = 1`.
2. If `([2d4e] & 3) == 1`:
   - `q, [2d44] = divmod([2d44] + [2d42], [2d40])` (16-bit unsigned `DIV` with DX = 0). Then `[2d50] += q`.
   - Unless `[2d58]`, loop while `s16([2d50]) >= 0`:
     - Read a byte. If it is < 80h, use running status `[2d5a]` and do not consume the byte.
     - If < F0h: `[2d5a] = status`, dispatch `2d5b[(s&0x70)>>4]`.
     - Else, if F0h–F7h, `[2d5a] = 0`. Dispatch `2d69[s&0x0f]`.
   - Each handler sends the event bytes with `midiOut`, then `c854` reads the next delta: `[2d50] -= delta`.
   - If bit 3 is clear, it advances the position counters with the carries `[2d46]`/`[2d48]`.
   - Meta FF:
     - 2Fh = `musicStop`
     - 51h: `[2d42] = lo16(0x60 * udiv32(60000000, tempo24))`
     - 58h = `c5ac`
     - others skipped
3. Set `[2d59] = 0`.

- Quirk: `c60a` stores the **first** delta as `+delta` (`c675`), not `−delta`. The first event therefore plays on the first tick, and the first delta is added to the next wait instead of subtracted.
- The status byte is always re-sent explicitly (running status is expanded). The `d1f8` parser depends on this: its note-off state does not reset for running status (`d250`).

### Speaker music output

- `ce63`/`cdda` allocate the 4 speaker voices. `d139` stores PIT divisors.
- `d19f` time-slices PIT ch2 at 72.8 Hz across the 4 voices: an arpeggio. Idle voices hold divisor `0x14` (59.7 kHz), so the gate stays on permanently.
- The audio model must treat very high PIT ch2 frequencies as silence (`APPROX:` the speaker's real response).

### Effect tick `334e:0000` (DI-based register code)

- If `[3659]`, return.
- `[365f] = 0`, `[35f4] = 0`.
- For v = 3..0 (BX = 6,4,2,0), if `byte[3649+BX] & byte[35ef]`:
  - If `[3628+BX] >= [35f4]`: `[35f4]` = it, `[365f] = voice`. This is selected **before** the step. Ties go to the lowest v.
  - `ES = [3638+BX]`, `[35f6] = BX`, `sfxVoiceTick`.
- If `[365f]`: `OUT 42h` = low then high byte of `[voice+8]` (no mode write). Port 61h bits 0–1 = 3 if `[voice+0Ah]` ≠ 0, else 0.
- If no voice is active, the speaker is left untouched.

`sfxVoiceTick` (DI = voice):
1. `if (--[2] == 0) step()`.
2. `[0Ah] += [0Ch]; [4] += [6]`.
3. `ax = [1Ah] + [1Ch]`. If ax ≠ 0:
   - `if (ax >= [2Ah] unsigned) ax -= [2Ah]`, then `[1Ah] = ax`.
   - `dx = hi16(s16(ES:byte[[2Eh] + (s16(ax)>>4)] << 8) * s16([1Eh]))`.
   - Otherwise `dx = 0`.
4. `[8] = dx + [4]`.
5. If `[18h]` and `--[18h] == 0`: envelope walk at `ES:[[2Ch] + [16h]]`, 4-byte entries:
   - `w1 == FFFFh` → `[0Ah] = w0` (and `[0Ch] = 0` if w0 == 0), continue.
   - Else `[0Ch] = w0`, `[18h] = w1`.
   - `[16h] += 4` each.

`step` (SI = `[0]`), repeat:
- `b = byte & 0x7e`. The test `CMP BL,80h; JNL` is a signed compare that is always true, so bit 7 is ignored and the stream-end branch at `014b` is reached only through op 02h.
- `b ≤ 78h`: `w = word`.
  - `b < 2Ch`: `[b] = w`. If `b == 2`, stop: if w == 0, the voice ends (`[0] = 0`, `[3649]`, `[3628]` = 0); else save SI.
  - `b == 2Ch`: `[2Ch] = ES:[[3618+v] + 2w]`, `[2] = 0`, save SI. The voice then waits 65536 ticks; `[3618]` is never written. Unused by the data.
  - `2Eh ≤ b ≤ 78h`: `[2Eh] = ES:[[35f8+v] + 4w]`, `[2Ah] = ES:[... + 2]`. Wave select.
- `b == 7Ah`: `[365b]` = SI after the operand, `SI += w`.
- `b == 7Ch`: `[2] = 0`, save SI. Hold for 65536 ticks. Unused.
- `b == 7Eh`: loop. `w` = relative offset. If `[20h] == 0`, jump. Else `[20h]--`, and jump unless it reached 0. Count N runs the body N times.
- `0196` (resume at `[365b]`) is reachable only through `b == 78h`, which takes the field path, so it is unreachable.

### PALS.BLK effect data

Decoded by a scratch script from `game/PALS.BLK` in place. All 11 streams end on `dur=0` with no unknown op.

- The `SND:IBM:` body is method byte 0, u32 size 501, then the content.
  - Content: 11 dword offsets, then the streams.
  - Each stream starts with an 8-byte header: `type`, `length`, 0, 0. Every stream is type 0.
- Commands are `op byte, u16` (`7Ch` takes no operand). Fields: `02h` dur, `04h` freq (PIT divisor), `06h` freq slide, `0Ah` gate, `1Ch` phase step, `1Eh` depth, `20h` loop count, `2Eh` wave.

| # | commands (one `\|` per `dur`) |
| --- | --- |
| 0 | freq=400 wave(0) depth=3000 gate=on fslide=100 dur=300 \| gate=0 dur=0 |
| 1 | gate=3 freq=500 fslide=5 dur=120 \| end |
| 2 | gate=on freq=1500 fslide=5 dur=80 \| end |
| 3 | loop=1 fslide=400 wave(0) pstep=16 depth=4096 freq=1000 gate=on dur=15 \| gate=0 dur=10 \| loop(−18) end |
| 4 | loop=6 freq=500 on dur=20 \| off dur=20 \| loop(−15) end |
| 5 | loop=6 freq=1500 on dur=15 \| off dur=15 \| loop(−15) end |
| 6 | on loop=5 fslide=0 freq=2000 dur=30 \| fslide=50 dur=20 \| loop(−18) off end |
| 7 | freq=1100 wave(0) pstep=16 depth=4096 gate=3 depth=6096 fslide=120 dur=20 \| depth=8000 fslide=240 dur=40 \| depth=10000 fslide=480 dur=60 \| end |
| 8 | on freq=2000 dur=20 \| end |
| 9 | on freq=5000 dur=15 \| off dur=20 \| on dur=15 \| end |
| 10 | on freq=12000 dur=30 \| end |

Streams 7 and 10 carry unreachable trailing bytes.

**Wave quirk.** The bank still loads without an `ITM:` chunk: `01f1` returns AX=1 after relocating (`32e3:025a`), and `009a` treats only AX=0 as failure (`019b–01a2`). The ITM result is stored unchecked (`01c7`). There is no `SND:ITM:` chunk, so `[bank+14h] = 0` (inferred: `026a` returns 0 when the chunk seek fails) and `043f` pushes `DS:0000/0002` (0, 0) as the ITM pointer (inferred: DS:0000–0007 are zero in the file and stay zero).
- `wave(0)` therefore reads `ES:[0]` = the relocated dword `table[0]`: `[2Eh] = 0x2c` (stream 0's offset), `[2Ah]` = the chunk buffer's **segment**.
- Streams 3 and 7 step the phase by 16 per tick for ≤ 120 ticks, so the samples are the IBM chunk's own bytes from content offset `0x2d` upward. The phase stays below 0x780, so the segment-valued wrap never triggers.
- Translate it literally. Only a chunk segment below `0x780` would change the result.

Starting an effect:
- Every caller uses priority 1. A 5th concurrent effect replaces voice 3.
- When effects overlap, the speaker plays the lowest-numbered active voice (the oldest allocation); the others run silently.

### Input

The INT 9 algorithm (`41ca`), for byte s from port 60h:
1. `sc = s & 0x7f`. If sc ≥ 59h, EOI and exit.
2. `old = st[sc]; st[sc] = (old & (0xfe | (s>>7))) ^ 1`. A release toggles bit 0.
3. Release:
   - If `old & 0xf8` and `[4bb8 + ((old>>3)&1)] == old>>4`, clear it.
   - `[4bb6] = 0`.
   - Shift-key bits are cleared in `0040:0017`.
4. Press:
   - Set the stick direction.
   - Shift keys set or toggle `0017` and insert nothing.
   - Otherwise build the ASCII: Ctrl → `a|0x80` (and −20h for letters); Caps (letters) → −20h; Shift → the shifted table.
   - `w = s<<8 | a`.
5. Ring insert unless `tail == next(head)`. This is a wrong "full" test: a new key is dropped whenever exactly one key is pending. Preserve it.
6. Ctrl+Esc: undo, flush, fatal exit.

- Last direction wins per stick. Releasing a key clears the stick only if that key is the current direction.
- Initialise the BIOS area in the image: `0080 = 1Eh`, `0082 = 3Eh`, `001A = 001C = 1Eh`, `0017 = 0`.
- The INT 1Ch handler has no observable effect (its axes are unread). Translate it or omit it.
- Mouse: X is halved on read and doubled on write. Return the mouse state from `env.js` at each INT 33h call.

## Open questions

- **Reference runs versus the port** (inferred): the DOSBox default configuration emulates an intelligent-mode MPU-401 and an OPL. If the MPU answers `FEh` at `cb3e`, the reference run uses the MT-32 path: PIT at 2330 Hz, effects 8× faster than with the speaker, music sent as MIDI. Unknown until checked live, by reading `[2d32]` and `CS:c354`.
- **No device detected** (static): with `[30d2] = 0`, a running sequencer would call `CALL [000Ah]` through `cdcc`, which is garbage. Detection always succeeds through the speaker, so this is inferred unreachable.
- Synth voice and channel struct field meanings (`30da`, `31a0`) are partly inferred. Translate `cdda`, `ce63`, `cfde` and `d0c7` instruction by instruction.
- The `.mus` content (SMF header after decompression) was not verified. `c60a` silently refuses anything that is not format 0, 1 track, 96 PPQN (static).
- Writers of `[5782]` (script delay): none found by direct search (static, limited).
- The pointer-shape format (`1ff8:0006`): not analysed.
- `2524:4584` and `2524:13e2` (attract and script helpers): not traced.
- The real frame rate of the race loop on reference hardware, needed for the port's pacing: unknown.
- Mouse-present return value of `3fee` (driver-dependent) and the DOSBox value of port 201h without a joystick (assumed FFh): inferred.
