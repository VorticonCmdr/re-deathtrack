# Championship economy and pit strategy

26 October 2026. All three starting cars completed a full ten-event, three-lap **Punk** season using upgrades, paid repairs, persistent equipment and conditional pit stops. Each finished every event; all three lost the title (Hellcat sixth, Crusher and Pitbull seventh). This demonstrates season completion under one repeatable strategy, not championship-winning balance.

## Delivered changes

- **Focused pit repairs:** armor and tyres can each be repaired independently in five seconds at the same original component price used by the garage. A full rebuild remains available. The pit panel shows armor/tyre condition, quotes and affordability. This removes the requirement to pay for unrelated mechanical repairs when only armor or tyres are urgent. No repair discount or free condition reset was introduced.
- **Engine-aware autopilot:** straight-line cruise previously stayed at 34 m/s regardless of engine tier. It now requests 34 / 38.2 / 42.4 m/s for the three factory engine limits, still subject to condition, traffic avoidance and existing curvature/braking constraints. Manual driving limits and rival pace are unchanged. This fixes an upgrade benefit missing from autopilot; it does not make autopilot a guaranteed winner.
- **Shared transactions:** garage upgrades and garage/pit service now use the same UI-independent economy functions exercised by the season diagnostic. Existing prices, rounding correction, ammo limits and insufficient-funds checks remain in force.

## Matched season comparison

Every run begins with $10,000 and the selected car's actual factory equipment. Cash, ammunition, component wear, points and history persist across rounds. The no-pit controls use exactly the same purchasing and weapon policy, with pit entry disabled.

| Car | Strategy | Events settled | Finishes | Pit stops | Final cash | Final rank |
|---|---|---:|---:|---:|---:|---:|
| Hellcat | planned | 10/10 | 10 | 3 | $1,009 | 6 |
| Crusher | planned | 10/10 | 10 | 1 | $1,493 | 7 |
| Pitbull | planned | 10/10 | 10 | 0 | $1,337 | 7 |
| Hellcat | no-pits | 4/10 | 3 | 0 | $1,639 | Incomplete |
| Crusher | no-pits | 9/10 | 8 | 0 | $1,367 | Incomplete |
| Pitbull | no-pits | 10/10 | 10 | 0 | $1,337 | 7 |

Hellcat without pits was wrecked in Chicago and could not afford essential repairs before Orlando. Crusher without pits was wrecked in Houston and could not afford repairs for Boston. Both controls intentionally stop with a diagnostic failure rather than inject money or skip the repair gate. Pitbull's conditional strategy needed no stops, so its two results are identical; this is not independent replication.

For planned seasons, Hellcat earned $21,500 and spent $30,491; Crusher earned $14,000 and spent $22,507; Pitbull earned $13,250 and spent $21,913. With the initial $10,000, these reconcile exactly to the final balances. Remaining funds are narrow and cars still have damage: completion does not imply a fully repaired setup or a sustainable winning second season.

## Strategy and diagnostic scope

`scripts/inspect-remaster-season.mjs` uses production race, combat, driving, progression and transaction functions. Tracks, pit positions and prices are decoded locally from ignored original files. Browser saves are never accessed: the script supplies an isolated in-memory storage adapter, saves checkpoints every ten simulated seconds, and reconstructs the progression store after every settlement. It checks cash reconciliation, duplicate-payout protection, exact profile reload equality, finite positions, pit progress and a 900-second event limit. Persistence checks exercise serialization and loading, not physical browser storage failure behavior.

Before a race, repair armor below 90%, tyres below 80%, and other parts below 70% when affordable. Prioritize armor upgrades while preserving $4,000; other handling upgrades require a $6,000 reserve. Buy gun ammunition only with reserve cash. This is one conservative authored policy, not an optimized driver.

During races, use actual autopilot, fire a half-second burst every three seconds, spend gun rounds then the laser battery, then switch to the charged particle beam. The initial exploratory driver stayed on an empty laser; those exploratory outcomes are excluded from the matched results. Player ordnance and destruction contracts are not used. Rivals retain their actual combat behavior.

Approach the real pit physically if fuel falls below 15%, affordable armor is below 60% (30% on the final lap), or affordable tyres are below 35%. Once stopped, selectively repair armor/tyres and buy ammunition if reserves allow; refuel below 35%. No diagnostic teleport, practice resurrection, bonus income or replenished weapon loadout is used. The final planned runs completed four stops and eight paid services, including two tyre repairs and two ammunition packs. No fuel stop was needed in these three-lap runs; free refueling was covered in the earlier [full-race audit](remaster-full-race-checks.md).

## Browser and regression verification

On an isolated local origin, the production pit UI was checked with $2,305 and a $3,520 full-rebuild quote. Rebuild was disabled, while a $1,200 armor repair remained available. Completion restored armor from 60% to 100%, left tyres at 70%, and reduced cash to $1,105. A $150 tyre repair then restored tyres to 100%, left $955 and retained $2,170 of unrelated repairs. Service completion disabled the now-unneeded buttons; rejoining closed the panel and resumed driving. No browser errors were recorded.

The actual garage charged $5,000 for Hellcat's armor upgrade and raised capacity from 100 to 200 HP. The completed Hellcat diagnostic profile was loaded into the real garage: all ten calendar results, $21,500 earned, 5,100 points, $1,009 cash and the losing-season screen matched the report.

All ten three-lap practice circuits also finished after the autopilot change. The production build and existing 166-check suite passed; those existing checks primarily cover the faithful port, while the season diagnostics supply this remaster evidence.

## Remaining acceptance

Human championship wins, harder difficulties, contracts, varied weapon-upgrade/loadout choices and second-season sustainability remain open. The fragile no-pit outcomes make repair reserves and energy-weapon use meaningful, but one deterministic policy cannot establish the full economy curve. Keep original prices/rewards for now; validate those broader strategies before making global damage or payout changes. Representative-hardware endurance and final original-feature parity/release checks also remain open.

## Reproduce

```sh
node scripts/inspect-remaster-season.mjs 0 planned
node scripts/inspect-remaster-season.mjs 1 planned
node scripts/inspect-remaster-season.mjs 2 planned
node scripts/inspect-remaster-season.mjs 0 no-pits
node scripts/inspect-remaster-season.mjs 1 no-pits
node scripts/inspect-remaster-season.mjs 2 no-pits
```

Hellcat and Crusher no-pit controls currently return nonzero because essential repairs become unaffordable. Full results and transaction ledgers: [season-balance JSON](remaster-season-balance.json). Local reports also retain the final profile for isolated garage inspection.
