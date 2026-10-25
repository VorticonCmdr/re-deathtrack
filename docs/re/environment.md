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
| Sound device | detection probes | MPU-401, AdLib and Tandy absent, so the PC speaker is selected | – |
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
