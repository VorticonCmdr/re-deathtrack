# Ten-circuit full-race AI, physics and pit checks

25 October 2026. **90 independent scenarios, 6.13 simulated hours, 57 finishes and 33 career wrecks.** All 50 practice races completed three laps. All 40 pit runs completed physical approach, seven services and rejoining: **280 services**, with rivals advancing and no progress awarded to the parked player. No diagnostic stalls, timeouts or invalid physics/resources were detected.

## Method

`scripts/inspect-remaster-races.mjs` runs the production race, driving and combat modules at a fixed 60 Hz using locally decoded original circuits and pit indices. It uses actual garage vehicle specifications for Hellcat, Crusher and Pitbull, with a controlled mixed loadout (300 gun rounds, two rockets, two missiles, three mines, three caltrops and tier-two ram/wheel spikes). The player uses actual autopilot, periodically cycles weapons and fires; rivals use their production decisions. Practice re-engages autopilot after normal four-second disable recovery. There is no teleport or artificial rescue during these full-race runs.

Each scenario has a three-lap target and 900-second ceiling. Once per simulated second the diagnostic checks finite car coordinates/velocities, valid condition and combat resources, and player forward progress. It records landings, normal recoveries, weapon damage, tyre feedback and terminal outcomes. Player stalls over 30 seconds and pit approaches over 45 seconds fail. A career wreck is a valid terminal outcome, not a completed three-lap race. Runs end with the player result; they do not wait for every unfinished rival.

Pit runs steer and brake into the actual right-side pit window from normal race starts. A controlled service adapter supplies fuel, ammunition, rocket, missile, mine, caltrop and repairs through the production service timer. These runs verify service sequencing and race integration, **not garage pricing or save persistence**; those were checked separately in the browser below.

## Per-city results

All five practice columns are completed three-lap times in simulated seconds. H = Hellcat, C = Crusher, P = Pitbull; D0/D3 are difficulty indices. Career outcomes list D0 / D1 / D2 / D3 for the light-armored Hellcat with the controlled mixed loadout.

| Circuit | H baseline D0 | H pits D0 | H pits D3 | C pits D0 | P pits D0 | Career D0 / D1 / D2 / D3 |
|---|---:|---:|---:|---:|---:|---|
| Orlando | 427 | 452 | 421 | 444 | 460 | finish / wreck / wreck / wreck |
| Bay Area | 430 | 423 | 390 | 419 | 415 | wreck / wreck / wreck / wreck |
| Phoenix | 344 | 346 | 326 | 348 | 346 | wreck / wreck / wreck / wreck |
| New York | 321 | 322 | 314 | 335 | 335 | wreck / finish / wreck / wreck |
| St. Louis | 283 | 288 | 278 | 297 | 301 | wreck / finish / wreck / wreck |
| Los Angeles | 381 | 388 | 358 | 392 | 390 | wreck / wreck / wreck / finish |
| Seattle | 435 | 421 | 396 | 426 | 431 | wreck / wreck / wreck / wreck |
| Houston | 271 | 258 | 248 | 262 | 257 | wreck / wreck / wreck / finish |
| Boston | 279 | 282 | 276 | 293 | 300 | wreck / finish / wreck / wreck |
| Chicago | 344 | 330 | 316 | 330 | 342 | wreck / wreck / finish / wreck |

## Live pit integration and repair fix

A separate local browser origin protected the existing driver saves. A focused Seattle review staged the player at the pit, while the production race, garage transaction handler and pit UI ran with real rivals and rain/night rendering. It is a focused UI fixture, not evidence of a complete browser-driven race.

The review found a repair rounding bug: `500 * (1 - .7)` evaluates slightly above $150, and `Math.ceil` quoted $151. Repair cost now removes only floating-point round-off before rounding actual fractional dollars upward. Garage and pit quotes share this calculation. The staged six-part repair quote and charge changed from $3,521 to **$3,520**. Browser verification showed cash $10,000 → $6,480, armor 60% → 100%, and remaining repair quote $0.

Actual rearming transactions then charged $300 for a gun pack, $1,100 for a Terminator, $1,000 for a missile, $500 for mines and $75 for caltrops, leaving **$3,505**. Free refueling restored the tank to 100%; rejoining closed the pit panel and resumed driving. Pause freezes service progress and disables service/rejoin actions; rivals advance while service runs normally.

## Interpretation and remaining work

Career survival was **7/40** (D0: 1/10, D1: 3/10, D2: 1/10, D3: 2/10). These independent, light-armored autopilot runs do not buy upgrades, choose tactical pit stops or use human combat strategy. They expose heavy attrition worth investigating, but are insufficient evidence for changing damage globally or certifying difficulty progression. Next: a persisted ten-event championship playthrough with sensible upgrades, repairs and pit strategy, followed by targeted survival/economy balancing.

This is accelerated simulation, not six hours of real-time browser rendering. It complements the [rain/night rendering soak](remaster-weather-performance.md); representative-hardware endurance, all-preset transitions, physical-controller and headphone checks remain open. Original-game feature parity still requires the final ledger/release audit.

## Reproduce

Requires the user's local original files in ignored `game/`. No save access or bundled original assets.

```sh
node scripts/inspect-remaster-races.mjs baseline 0
node scripts/inspect-remaster-races.mjs pits 0
node scripts/inspect-remaster-races.mjs pits 3
node scripts/inspect-remaster-races.mjs pits 0 '' 1
node scripts/inspect-remaster-races.mjs pits 0 '' 2
node scripts/inspect-remaster-races.mjs career 0
node scripts/inspect-remaster-races.mjs career 1
node scripts/inspect-remaster-races.mjs career 2
node scripts/inspect-remaster-races.mjs career 3
```

An optional city ID limits a run, e.g. `pits 0 seattle`. A failed invariant, timeout, missing pit service or nonfinishing practice race returns a nonzero exit. Raw local runs are written under `.local/`; the [checked-in results](remaster-full-race-checks.json) omit concurrent-process timing measurements, which are not a reliable performance benchmark.

Final validation: the focused Seattle pit rerun passed after the repair fix; the production build and existing 166-check verification suite passed. The suite primarily covers the faithful port and is not new remaster coverage. No browser errors were recorded during the live pit review.
