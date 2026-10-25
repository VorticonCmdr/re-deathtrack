# Environment contract

These are the values that come from outside the translated game logic: where they enter, how the port produces them, and how replays record them.

| Value | Consumed at | Port provider | Recorded for replay |
| --- | --- | --- | --- |
| Keyboard scancodes | INT 9 handler `1ff8:41ca`, which reads port 60h | Browser `keydown`/`keyup` → set-1 scancode, stamped with wall-mapped virtual time (`src/web/main.js`), delivered at the next PIT tick (`src/engine/host.js`) | `state.log` `input` entries; headless runs take an event file (`scripts/run-headless.mjs --events`) |
| Mouse position and buttons | INT 33h AX=3 (`1ff8:4025`, `4068`) | `src/game/bios.js` `mouse`, from canvas events. X is doubled (640-wide driver space) | same |
| Joystick | port 201h | Absent: reads FFh. `1ff8:3dd1` uses the documented stub | – |
| Files | INT 21h | The user's own game folder (`FileSystem`, 8.3 names). Writes go to `localStorage` in the browser and to memory in tests | – |
| Timer ticks | IRQ 0 → `1000:c356` | Virtual PIT at the programmed divisor | Virtual time |
| Vertical retrace | port 3DAh (`1000:aeaa`, `2524:478a`) | Derived from virtual time at 70.086 Hz (VGA mode 0Dh timing, as in DOSBox) | Virtual time |
| Sound device | detection probes (`1000:cb3e` MPU-401, `1000:c8e5` OPL) | Default: MPU-401 and AdLib absent (ports read FFh), so the PC speaker is selected. `?sound=adlib`: OPL2 at 388h/389h, MPU absent. `?sound=mt32`: MPU-401 UART at 330h/331h, OPL absent (`src/game/devices.js`). Tandy stays absent | host option |
| OPL timers and status | IN 388h in `1000:c8e5` | Timer 1/2 overflow follows virtual time plus the cost of the port accesses themselves (`cost.usPerPort` = 2.4 µs, **APPROX**, chosen so the detection count gives the DOSBox delay constants `[2dba]=2`, `[2dbc]=10`) | OPL write stream (`opl.events`) |
| MPU-401 | IN/OUT 330h/331h, IRQ 2 (INT 0Ah, `1000:cc2d`) | ACK FEh for every command, status 3Fh/BFh, level-triggered IRQ while data is queued (DOSBox behaviour). MIDI bytes written in UART mode are time-stamped (`mpu.events`) | MIDI byte stream |
| `9542`'s stale `[BP-4]` | `1000:9778` (`MOV BX,[BP-4]`) | Deterministic carry (`staleStack.bpm4`). **APPROX**, see below | Captured per frame as `stale9542` at the consumption point |

## Interrupt-dependent stack garbage (`1000:9778`)

- **Evidence (observed):**
  - A DOSBox write watchpoint on the stack slot `DS:b9b4` during the demo race caught about 20 writers. The most frequent was the timer ISR `1f5:c356`, from the FLAGS/CS/IP pushed on interrupt entry.
  - A closed-loop replay diverged at one frame, where DOSBox had read `0x01f5` from the slot. That value is the game's code segment, pushed by an IRQ that landed inside `9542`'s prologue (after `PUSH BP`, before `SUB SP,3Ah`).
- **Consequence:** in the original, the value a type-5 entity's `rel` is copied from depends on interrupt timing. The port cannot derive it from game state.
- **Normal play:** the deterministic carry is used (the last `[BP-4]` the port wrote in `6dbc`/`9542`).
- **Replay:** the captured value is injected at `9542` entry, so the comparison isolates game logic. This is conditional evidence and is labelled as such in `docs/scenarios/*.json`.

## Divide faults

- Once `2524:0279` → `1ff8:3af2` installs INT 0 = `1ff8:3b1c`, a divide overflow halves the dividend (arithmetic shift) and retries.
- A divide by zero then loops forever. The port raises `HangError` at that point.
- `src/engine/int.js` follows whatever INT 0 vector is live.

## Timing model (APPROX, calibrated)

The original runs unthrottled, so its speed is a property of the machine. The port models a DOSBox default-cycles machine.

| Item | Port value | Evidence |
| --- | --- | --- |
| Race frame period | 1/15 s minimum per loop iteration (`frameCost`) | Observed 416 frames in 27.7 s in demo mode |
| Menu poll quantum | 261 PIT clocks per input poll → 293.5 menu iterations/s | DOSBox: 294.9/s on the sign-up screen (`DS:1f2e` counter vs `CS:c328`) |
| CPU work | 0.904 µs per EGA memory access + 19.9 µs per decoded stream byte, charged at the next poll | Least-squares fit to title→sign-up 3014 ms, `32b8`→`047c` 542 ms, `047c`→first frame 687 ms. Predictions: 3015 / 531 / 691 ms |

- Virtual time never runs ahead of the wall clock in the browser, so charged work takes real time.
- That timing is observable: a key press that ends the title is released before the sign-up menu starts polling, as in DOSBox.
- RNG state depends on menu iteration counts (`rand` once per `66d2` call), so the RNG sequence of a session follows the timing model. A recorded input timeline replays deterministically in the port.
- Timeline replays will not match DOSBox, because the counts of polls before a race differ.

## Sound devices

- **Selection** is made only by what the ports answer. The game's own auto-detection order (MT-32, AdLib, Tandy, speaker) then chooses the driver, so the translated detection code runs unchanged.
- **MT-32:** the browser forwards `mpu.events` to a Web MIDI output (`src/web/midi.js`). The port bundles no synthesizer. Without an output the status line says so and the music is silent.
- **AdLib:** `src/engine/opl2.js` synthesises the register stream in an AudioWorklet (`src/web/opl-worklet.js`). It is an independent implementation, **APPROX** (not bit-exact). Sound effects stay on the PC speaker.
- **Re-entrancy:** `1000:cbd0` ends with `CLI … STI` (`cbf2`), so the first byte queued inside a timer ISR re-enables interrupts for the rest of that ISR. Observed in DOSBox: IF is clear only at the first byte of each burst (queue empty), set at all others. The port's ISRs take no virtual time, so when the 256-byte MIDI queue is full `cbd0` advances virtual time inside the call (nested timer ticks) so the slot-8 tick can drain it. The statement in `input-timer-sound.md` that IF stays clear through every timer callback holds only until such an STI.
- **Verification:** `docs/scenarios/sound-startup.json` (MIDI bytes and OPL register writes against DOSBox). Times are not compared.

### Cost of absent-device probes (default speaker mode)
- With the MPU-401 and OPL absent, `1000:cb3e` polls port 331h 65536 times before giving up, and `1000:c8e5` does a few hundred accesses (initial `[2dba] = 10`, `[2dbc] = 80`). At the APPROX 2.4 µs per access that is about 0.16 s of virtual time added to the boot, before the title. The DOSBox references never ran this path (their MPU answered). Later timings (title → sign-up, race setup) are relative and unaffected.
