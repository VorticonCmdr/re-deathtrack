# Modern ten-city championship

`remaster.html` is an independent Babylon.js game. The faithful port remains at `index.html`, with its original simulation, menus, combat and audio. Both entry points build with Vite for static hosting. The remaster shares asset decoders but never runs the original emulator, framebuffer renderer or 15 Hz simulation.

## Race format

Each event launches a three-second countdown with the player and all nine original named rivals, using their original car models. Choose 1–99 laps (modern default: three) and one of four difficulty levels before the first championship entry, or freely in practice. All cars start on a staggered grid behind the same finish line; grid offsets do not count as lap progress. The HUD shows position, lap, race time, best lap, armor status and a ten-car minimap.

Opponents brake for corners, select passing lanes around traffic and recover after becoming stuck. Everyone uses the same 60 Hz arcade physics. Car contact uses equal-mass impulses and soft separation, with a small camera kick and amber edge flash for the player. Vertically separated cars at the overpass do not collide.

Finishing freezes the race and opens the results card. Finished drivers are ordered by their finish time; remaining drivers are ordered by distance and explicitly labeled Unfinished. Finished opponents are removed from the road to avoid blocking the finish. In practice, Race again / R starts a fresh countdown. In championship, R retires the current round and returns to the garage; finished events offer Next event. Wrecked drivers rank behind surviving unfinished drivers.

All seven active weapon families, both passive contact families and armor are implemented. Car selection, six-family upgrades, ammunition purchases and local practice saves are implemented. Paid repairs, live pits, all ten circuits, the original named roster and a saved ten-round championship are implemented. Exact original rival behavior and human combat-balance validation remain future work. This is a complete modern race loop, not feature parity with the original game. The faithful port remains playable separately.

## Controls

- Arrows / WASD: throttle, brake and steering.
- 1–7 or X: select/cycle gun, laser, particle beam, Terminator, homing missile, mines and caltrops. Clickable cockpit controls offer the same choices. Switching releases the trigger and clears stored particle charge.
- T: cycle visible missile targets. Keep a target ahead until LOCKED; braking hard can defeat an incoming missile.
- F (hold): fire the selected weapon when ready. Guns overheat; lasers spend battery; particle beams charge while selected.
- Space: handbrake; lowers lateral grip for a slide.
- C: chase / forward driver camera.
- P or Esc: pause / resume, including during the countdown.
- Q: recover to the nearby road centre, stopped and facing forward. Adds no progress and has a five-second cooldown; the race keeps running.
- R: restart in practice; retire this round to the garage in championship. Retirement awards no player points or money and advances the calendar. Damage and ammunition remain. Each new entry starts with 62.5% fuel.
- E: enter pit service when stopped on the right in the marked zone. Rivals continue racing during services.
- Settings: High / Balanced graphics, camera and optional frame statistics. Opening settings pauses and closing restores the prior pause state.
- Focus loss pauses and releases held controls.
- Sound: opt-in synthesized motor and player gun sounds, independent of original PC-speaker audio.

Braking stops the car; reverse is not implemented. Use Q when facing the wrong way. Speed uses modern world units treated as metres and converted to km/h, not an original-game conversion. Race and lap times measure simulation time. Separate practice and championship profiles persist locally, including condition, cash and ammunition. Mid-race progress and online leaderboards are not implemented.

## Architecture

- `src/remaster/garage.js`: original price extraction, vehicle specs, repair/purchase transactions and garage UI.
- `src/remaster/championship.js`: city metadata, original circuit order, roster, season standings and tie-breaking.
- `src/remaster/progression.js`: validated versioned profiles, practice migration, event identities and atomic payout receipts.
- `src/remaster/pit-ui.js`: live service controls and entry guidance.
- `src/remaster/combat.js`: swept projectile collision, armor, heat, AI firing decisions, disable/repair timers and bounded visual events.
- `src/remaster/race.js`: countdown/racing/finished state machine, shared finish line, ordering, rival driving decisions, car contacts and recovery.
- `src/remaster/driving.js`: continuous position, velocity and heading; fixed-step arcade handling, road projection, shoulder/rail response, lap progress and interpolation.
- `src/remaster/road.js`: wrapped elevation smoothing and full-footprint scenery clearance against all road segments.
- `src/remaster/main.js`: local asset loading, accumulator, keyboard input, HUD/results, diagnostics and synthesized motor sound.
- `src/remaster/scene.js`: decoded models, procedural scenery/materials, ten car renderers and damped camera.
- `src/viewer/decode.js`: shared pure asset decoders.

Physics advances at 1/60 second, with interpolation at the browser's display rate. Steering uses a speed-sensitive bicycle approximation and smoothed input; lateral velocity damping provides grip. Nearby-segment road projection preserves continuity at crossings. The shoulder slows the car and the outer corridor removes outward velocity with a small rebound. Chase position and look target are damped independently.

AI previews curvature up to 65 metres ahead, estimates corner speed and braking distance, then steers toward a look-ahead point with a smoothed passing-lane offset. Nearby traffic affects lane choice and speed. Rivals can recover after four seconds off-road or stuck; recovery retains their progress and stops their velocity. These are deterministic heuristics, not a trained racing agent or rubber-band speed boosts. Balancing still needs human racing sessions.

Car contact uses two circles per car as a forgiving footprint approximation. This is not a full rigid-body simulation; there is no suspension or airborne vehicle model. Road heights are smoothed from original samples and shared by rendering and physics. Markings follow the surface, reflectors follow the grade, and road widths use horizontal normals. Decorative scenery is checked conservatively against all road branches and moved outward or omitted where no clear site is available. It has no individual collision behavior.

Long frame gaps are capped at 100 ms to avoid a catch-up spiral. Focus loss pauses. Sustained very low frame rates can make simulation time slower than wall time; rendering itself has no 60 FPS cap. HUD updates at 10 Hz, with a cached minimap path. Static meshes are batched. Frame statistics show rolling mean/p95 intervals and render-submission CPU time, not GPU duration or measured physics throughput.

## Assets and deployment

This slice requires `SEATTLE.TRK`, `SHAPE.TBL`, `DTRACK.EXE`, and `MYCAR0.TBL` through `MYCAR2.TBL`. Vite development reads the ignored `game/` folder; static production asks the player to select their own files locally. Files are never bundled or uploaded. The existing `.gitignore` and all source assets remain unchanged. New scenery, materials and sound are procedural.

## Verification and limits

The earlier four-car milestone shakedown completed all three rival races, and a separate steering-driven run exercised a player finish in third place, contact impulses, lap timing and a reset to the countdown. Browser exploration checks the grid, countdown, driving alongside rivals, position changes, recovery and pause. The finish transition was exercised in the simulation; a complete manual browser race remains a playtesting task. These checks do not establish AI competitiveness or collision behavior in every situation.

Production build and the existing faithful-port verification suite are run separately. Desktop keyboard controls are the current target. A previous solo rendering observation was approximately 60 FPS on the development machine; it is not a ten-car or cross-device performance guarantee.

## Machine gun milestone

All ten cars carry a forward-firing machine gun: 10 rounds/second, 3/7/11 armor damage per hit for models I/II/III, 90-metre range and 190 m/s muzzle speed plus the car's speed. The garage milestone adds finite ammunition; there are no ammo pickups. Heat also governs sustained fire. Each shot adds 11.5% heat, cooling removes 24% per second, and an overheated gun unlocks at 25%. These are modern tuning values, not recovered original-game constants.

Shots sweep against two moving 3D spheres per car and select the nearest hit along the step. This prevents tunneling at high bullet speeds and respects vertical separation at overpasses. The rendered road/shoulder footprint also blocks projectiles using segment/triangle intersections. Decorative buildings and props do not yet block shots. Cars fire along their heading and pitch with no auto-aim. The reticle projects a point 45 metres along that direction; it is a direction guide, not a target lock or exact impact marker for every distance.

Muzzle flashes, tracer meshes, impact bursts, a hit marker and taking-fire warnings provide feedback. Armor is shown in standings and in the player's HUD; critical armor has a persistent warning. The effect pools are bounded. Player gun sound is synthesized and opt-in; spatial opponent gun audio is not yet implemented.

In practice, zero armor stops a car for four simulation seconds, then recovers it with full armor and a two-second shield. Career wrecks instead remain out for the event. Both are nonblocking. Shielded cars cannot fire and are nonblocking. Manual Q recovery does not repair armor or bypass disablement. Pausing freezes shots, heat, damage and recovery timers. Restart retains condition and spent ammunition. Hits and disables are included in results. Component condition now reduces engine performance, braking, drive force, grip and stability.

AI fires in bursts only when another eligible car is closely aligned ahead, including matching elevation; it uses the same heat and damage rules as the player. Existing conservative driving targets remain unchanged for now. The decoded original ties top speed to engine level (`2524:26d2`, level × 30 + 90), with damage lowering speed (`2524:44fc`). Transmission and tyre upgrades affect other setup values; a weight-based performance formula has not been confirmed in the reverse-engineering notes.

Combat exploration verified player fire, rival armor loss, overheating/cooling, and incoming AI damage in the browser. Model-level diagnostics exercised zero armor, disablement, repair, shield timing, reset, and a rising road blocking shots. These observations are not a complete balance pass or exhaustive collision verification.


## Practice garage

Open **Choose car & equipment** before racing, or **Garage** to leave a race and return to the workshop. Hellcat, Crusher and Pitbull use the original `MYCAR0..2.TBL` models, both in the garage previews and on track. The original car-specific starting equipment is confirmed in `2524:258c`: Hellcat engine/transmission tier II and 300 gun rounds; Crusher airfoil/armor tier II and 100 rounds; Pitbull armor tier III, gun model II and 100 rounds. Starting rear and projectile stocks are described in their arsenal sections below.

All six part families have three tiers. The shop reads prices at runtime from the player's `DTRACK.EXE` (EXEPACK image, DGROUP-relative `1dda[18]`); machine-gun pack prices and capacities use `1dfe[27]` and `1e34[27]`, weapon family 2. It never bundles executable bytes, models or extracted tables. Buying the next tier pays its full original price, with no invented parts trade-in. Unaffordable and maximum-tier actions are disabled and the transaction checks are repeated before mutation. Ammunition is sold in 100-round packs, capped at the model capacity; a final partial pack costs the full pack price.

Modern values intentionally differ from the original's units: engine limit 50/62/74 m/s, transmission drive force 11/13/15 m/s², brakes 19/23/27 m/s², tyre lateral grip 8/9.5/11, airfoil stability 1/1.15/1.3, armor capacity 100/200/300 HP. Engine limit is the propulsion falloff parameter, not a promised measured top speed (drag and slopes still apply). Airfoil reduces roll and raises the yaw-rate limit. There is no invented car mass multiplier; differences follow installed equipment. Gun damage now follows the original 3/7/11 progression; heat, range and cadence remain modern tuning.

This is a **practice** profile, separate from the faithful port and championship. It starts with $10,000, shares cash across three independently retained builds, offers explicit practice fund grants, and has a two-step reset for all builds/cash/ammo. Practice earns no prizes; the separate career profile supports championship rewards. The repairs milestone now retains component condition and remaining armor, provides paid repairs and live pits, and removes automatic revival in career. Practice still permits temporary armor recovery.

`deathtrack.remaster.practice.v1` was the initial validated version-1 profile with stable car indices, cash, six part tiers per car, gun model and remaining ammunition. Selection, purchases and rounds spent persist locally. Restart, returning to the garage, and refreshing do not intentionally refill ammunition. The current version checkpoints condition, fuel and ammunition once per second; pagehide/garage/restart/results flush immediately. Abrupt termination may lose the last checkpoint. Unknown or malformed saves are preserved and automatic writes blocked until the user explicitly resets the affected profile. Storage failures show a session-only warning. Multiple simultaneous remaster tabs are not synchronized; use one tab per practice profile.

Required remaster files are now `SEATTLE.TRK`, `SHAPE.TBL`, `DTRACK.EXE`, and `MYCAR0.TBL` through `MYCAR2.TBL`. Folder selection works for static builds; the development asset endpoint remains a convenience. Garage UI is keyboard accessible, responsive and scrollable independently of its persistent action bar.

Manual browser verification: original models and all car choices; brake purchase ($10,000 → $8,500, braking 19 → 23); ammunition purchase ($8,500 → $8,200, 300 → 400 rounds); Pitbull selection survives reload; firing consumes rounds and restart retains the lower count. Existing faithful-port verification remains separate from this new feature coverage.


## Repairs, live pits and championship rewards

Choose **Championship** in the garage for a separate $10,000 profile. The selected car, lap count and difficulty lock at first entry; practice grants and equipment never transfer. The calendar advances after each finished or retired event. The garage shows all ten rounds, full standings, wins and the latest payout receipt.

Each car now carries six condition values in [0,1]. Armor is current HP / installed capacity. Gun and sufficiently hard car-contact hits also wear a mechanical component; shoulder driving wears tyres while moving. Damaged engine/transmission/brakes/tyres/airfoil reduce the corresponding driving parameters. This deterministic distribution, consumption and handling scaling are modern tuning, not literal DOS formulas. Garage upgrades replace the relevant component at full condition. Repairing installed parts costs `ceil(original installed-part price × damage fraction)`; full rebuild sums those costs. No parts or ammo can be bought without funds. A car with zero armor or nearly destroyed tyres cannot start; repair it, or explicitly reset an insolvent career. Practice retains its optional grants and reset.

Every city's pit index is extracted at runtime from DS `1d04[10]`; Seattle's is 1138. The original open interval `pitIndex < point < pitIndex + 60` (Seattle: `1138 < point < 1198`) is marked turquoise on the right of the road, with signs and a **P** on the minimap. Approach guidance shows distance. Stop below 1 m/s at lateral offset >3.4 m and press **E** (or the enabled pit button). A modern protected service state holds the car without advancing its progress. Rivals keep driving, fighting and finishing. Q cannot recover out of service. Leaving grants a two-second safety shield; the car cannot fire while protected. Pausing/focus loss deliberately pauses the entire simulation, including service timers.

Services are free refuel (5 seconds to full), one existing-gun ammunition pack (2 seconds, original price/capacity) and a full repair of installed components (5 seconds, proportional prices). Charges and condition/inventory changes commit only when the timer completes; quitting or restarting before completion grants no work and charges nothing. Leaving while a service runs is disabled. Upgrades are garage-only. These durations and protection are modern UX choices. No rival pit strategy is claimed.

Fuel starts each event at 62.5%, matching original setup `0x0a00 / 0x1000`, and reaches 100% at the free pump. Modern consumption is `0.025 + speed × 0.004` percentage points per simulated second outside the pit. At zero, throttle is cut and the car brakes to a stop, ending in an out-of-fuel result. Condition and ammo persist on restart; fuel initialization is an explicit event-start rule.

Career wrecks never revive within the event. Finish places use the original runtime DS `0d2e` prize table: all ten places pay $13,000 / $9,500 / $7,000 / $4,500 / $3,000 / $2,000 / $1,000 / $500 / $250 / $0. Finished events award `(11 − place) × 100` points. Optional contracts rotate among the nine original named rivals and pay $2,000–$5,000 for a player-attributed destruction **and a finish**. The rotation is a modern placeholder for the original random offer. Quit, interruption, wreck and fuel DNF receive no prize or bounty. Requiring a finish is intentional modernization: the original can pay a non-wrecked out-of-gas result. This prevents a lucrative retire/refill loop in the preview.

Each entry receives a UUID. Settlement requires the active event identity, then stores updated cash, totals, cleared active event and receipt in one profile write. Repeated settlement is a no-op. Refresh during a race retains the latest resource checkpoint, marks the event interrupted and pays nothing; races do not resume mid-lap. A stale result cannot settle a new event. Saves are now `deathtrack.remaster.practice.v6` and `deathtrack.remaster.career.v6`, with a remembered mode. Version 3/4/5 profiles retain the complete championship, points, difficulty, laps and equipment. Version 2 profiles (or v1 practice profiles) retain equipment, condition, cash and lifetime earnings, starting a new championship with zero season points. Old keys remain untouched. Interrupted events do not advance the calendar; the same round can be entered again, retaining resource wear. Save validation checks versions, equipment, condition and receipt fields; storage failure is surfaced, and corrupt/future saves are not silently overwritten. Use one active remaster tab per profile; simultaneous tab conflict resolution remains future work.

Verification from the earlier Seattle repairs milestone: browser exploration confirmed career/practice separation, contract selection, locked career car, driving fuel/pit guidance, returning wear to the garage, and a $3 tyre repair restoring 100% condition. Model diagnostics covered pit eligibility at point 1150, five-second live service with >76 m of rival travel, a $3,100 rebuild charged once, a $300 reload and free refuel, permanent wrecks with attributed kill credit, and a full three-lap career simulation (finished second at ~380 s with damage and fuel retained). Economy diagnostics verified a second-place $9,500 prize plus $2,000 contract, no repeated payout, saved/reloaded condition/cash, no stale/interrupted payout and practice isolation. These diagnostics do not replace a complete human career balance pass or full browser pit walkthrough. Existing 166 faithful-port checks and the production build are also run.


## Ten-city season

The original circuit order, recovered from DS `18be`, is **Phoenix → St Louis → Seattle → Chicago → Orlando → Bay Area → New York → Los Angeles → Houston → Boston**. Practice provides a selector for any city. The local folder must contain all ten `.TRK` files, `SHAPE.TBL`, `MYCAR0..2.TBL`, and `DTRACK.EXE`. Original assets remain ignored and are never bundled into the build.

The field is YOU, Sly, Megadeath, Killer Angel, Lurker, Preying Menace, Crimson Death, Motor Maniac, Wrecker and Melissa. Rival models use SHAPE records `34 + 10 × rivalIndex`. The modern AI varies pace by driver and difficulty, with short firing bursts after the first six seconds. Original per-driver AI personalities, upgrades and targeting tables are not yet reproduced.

Season points are 1,000 for first down to 100 for tenth. A player DNF earns zero; rivals score their classified position when the event ends. The race ends when the player finishes or retires, so rivals may be classified without finishing. Ties break on wins, then stable driver order (an explicit modern rule). After ten rounds, first place wins the title. **Defend your title** retains the car, cash and condition, clears season scores, and raises difficulty one step up to Mega Destroyer. A lost season can be reviewed before explicitly resetting the career. Practice remains available throughout.

All original road layouts, elevations and safe roadside placements now render in 3D, with city palettes, water presence and skyline density. Seattle retains its bespoke Space Needle and mountain treatment. The other cities use shared stylized scenery: bespoke landmark art and a full visual/balance pass remain future work.

Milestone verification: season-model diagnostics covered ten-round wins and losses, reload after every round, next-season difficulty and cash retention, duplicate settlement, interruption and blocked entry after season completion. Every circuit's pit entry and nine-car AI progress were exercised against local source tracks. In a 400-second, one-lap career diagnostic with the player protected in the pit, all nine rivals on every track either finished or were wrecked; 3–5 rivals finished each event. This heavy attrition still needs human balance testing. Browser exploration checked the championship calendar, all ten practice scene switches without console errors, Phoenix's ten-car grid and HUD. This is not a complete human-driven ten-event balance run. Existing faithful-port verification and the production build are checked separately.


## Laser and particle-beam arsenal

Every car has the original base laser and particle beam. Crusher starts with laser model II, as set by `2524:258c`. The garage offers model II/III upgrades for both energy families; costs come from the original runtime weapon-price table, minus the current model's trade-in value (`1000:632e`). No battery refill is bundled with an upgrade. All gun models and remaining weapon families are now available; see the balance pass below.

| Weapon | Resource | Model I / II / III damage | Modern timing / range |
| --- | --- | --- | --- |
| Laser | 100 battery units at each event entry, one per pulse | 7 / 12 / 17 | 0.35 s between pulses, 100 m |
| Particle beam | No ammo; charges only while selected and active | 20 / 32 / 44 | 2 s charge, 130 m |

Damage formulas follow `docs/re/race.md`'s direct-fire table. Timing and ranges are modern tuning. The beam stays ready at full charge instead of reproducing the original 10/11-frame oscillation. Switching weapons clears its charge. Pit service, disablement, shields and pause stop charging; service and shields also prevent fire. Energy shots neither consume gun ammunition nor depend on gun heat. Laser battery persists in resource checkpoints and is restored to 100 on a new event, matching the original event initialization. The gun rearm service buys rounds; separate services now reload rockets and missiles.

Energy hits use a nearest-intersection ray against car volumes and road triangles, respecting slopes and vertically separated roads. Cyan laser and violet particle pulses use a fixed pool of 24 meshes; impact effects remain capped at 32. Damage uses the existing component wear, wreck, shield and kill-attribution path. Rival weapon roles rotate deterministically across guns/lasers/beams as modern tuning; an AI with an empty laser battery falls back to its gun. Individual original rival preferences remain pending. Weapon sounds are simple synthesized tones.

Verification: browser exploration bought laser II for $2,100 (damage 7→12), beam II for $1,500 (20→32), selected and fired the laser (five hits, battery 100→95), switched to the beam and observed charge reset after firing, inspected the cyan ray, paused, and returned to the garage with 92% battery and all 300 gun rounds retained. Model diagnostics covered cooldown, empty battery, charging, upgrades, kill credit, road occlusion, vertical separation, and migration of a four-round championship with 4,000 points. These checks are not a complete balance or all-weapons parity claim.


## Terminators and homing missiles

Keys **4** and **5**, or the cockpit buttons, select the launchers. Hold F to fire when ready. Rockets fly straight; missiles require **1.2 seconds** of uninterrupted tracking within a forward cone and **150 metres**, with clear line of sight. **T** or the target button cycles eligible rivals and restarts acquisition. The target bracket becomes solid when locked. Switching weapons, empty ammunition, lost sight, a finished/wrecked/protected target or entering service clears the lock. Pause freezes acquisition and flight.

| Family | Model I / II / III damage | Capacity | Flight tuning |
| --- | --- | --- | --- |
| Terminator | 45 / 92 / 180 | 15 / 10 / 5 | 65 m/s + half launch speed, 3 s lifetime, 1.1 s cooldown, 5 m blast radius |
| Homing missile | 60 / 140 / 220 | 20 / 10 / 5 | 45 m/s + half launch speed, 6 s lifetime, 2 s cooldown, 4 m blast radius |

Damage and capacity tiers follow the original tables. Flight, lock timing and splash falloff are modern tuning. Explosions deal full damage within 2 m of a car centre, falling to zero at the radius. Both player and AI use the same damage rules; the original AI-on-AI instant destruction quirk is deliberately omitted. Nearby drivers, including the shooter, can be caught in a blast. Road triangles block flight, targeting and explosion line of sight; swept collisions avoid tunnelling through moving cars.

Missiles turn at a bounded 1.1/1.25/1.4 radians per second, so they can overshoot. An incoming warning gives distance and **BRAKE HARD** guidance. Holding brake for 0.45 s while the missile is within 80 m and reducing speed below 82% of speed at launch (or 5 m/s) breaks tracking; the missile visibly diverts upward and expires. This is the modern counterpart to the original brake-to-evade timing interaction. AI drivers brake under missile threat too. Guns, lasers and particle beams can intercept enemy ordnance; interception removes the warhead without splash damage. Protected or finished targets cause an in-flight missile to coast without homing.

Original starting ammunition is now enabled: Hellcat 2 rockets / 0 missiles, Crusher 0 / 3, Pitbull 3 / 1. Models begin at tier I. The garage buys one round at its original runtime price; model changes trade in **all remaining rounds** at their current unit price and supply **one** round of the new model, matching `1000:632e`. A trade-in surplus is credited to cash. Installed-model ammunition can also be bought in live pits, with a two-second service and payment at completion. Capacity and affordability are checked again at purchase. Ammo remains spent after retirement or reload. Version 5 migrates earlier saves, preserving season progress and energy upgrades while adding the previously deferred starting ordnance. Old save keys remain untouched.

There are at most 32 live rockets/missiles and 32 corresponding render objects. Effects retain their existing cap. Rival weapon roles now rotate across all five supported families, with finite ordnance and fallback to the gun when empty. This remains modern AI tuning rather than the original individual rival preferences. Rear hazards and contact weapons are now implemented below. Gun model purchasing is implemented below.

Verification: browser exploration confirmed a two-round Terminator I trade-in for one model II round at zero extra cost, a $1,000 missile purchase, target acquisition and launch (three splash hits), and a Terminator impact (one disable). Model diagnostics covered lock gating/cycling, homing, ammo exhaustion, energy interception after muzzle clearance, brake evasion, road-blocked locks, and version-4 migration preserving a four-round season and energy upgrades. All ten circuits passed a five-minute mixed-weapon simulation with successful pit ordnance transfers, rival finishes, finite ammunition and bounded projectiles. Runtime-price rearming and gun interception also passed diagnostics; the production build and 166 faithful-port checks passed. Human balance testing, especially splash damage and AI evasion, remains necessary.


## Rear hazards and contact weapons

Keys **6** (mines) and **7** (caltrops), then **F**, deploy behind the car. All seven active weapons also have cockpit buttons. Mines and caltrops have three models, finite stock, garage purchases/upgrades and two-second pit reloads. Ram and wheel spikes are permanent passive equipment with three upgrade models and visible car-mounted geometry. The Hellcat starts with model II ram/wheel spikes; mine stocks start at 0/1/3 for Hellcat/Crusher/Pitbull. Caltrops start empty.

Prices and capacities come from the original executable's families 0 (caltrops), 3 (mines), 6 (ram) and 8 (wheel). Mine capacities are 30/15/7 and caltrops 30/20/10. Expendable upgrades trade remaining stock for one higher-model unit; passive upgrades trade the installed model. Version 6 migration retains all prior money, progress and equipment, including v5 rocket/missile models and rounds; older save keys remain untouched.

Modern combat rules:

- Deploy 3.5 m behind, arm after 0.6 s, with 1.5 s owner grace and a 1.2 s deployment cooldown. Deployment requires a road surface within 2 m vertically; failed placement or a full pool consumes nothing. Up to 64 traps, expiring at 20 s for mines and 50 s for caltrops.
- Swept three-dimensional contact catches fast crossings and separates road levels. A trap is consumed by its first eligible victim. Pit service, shields, disabled and finished cars do not trigger it. Owners can hit their own armed traps after grace expires.
- Mine damage is 20/33/46, from the original player-to-AI formula, applied symmetrically. The blast is visual; it damages the triggering car, not a splash radius.
- Caltrops remove 12/18/24 percentage points of tyre condition and 20% of current velocity. Tyre condition affects grip for player and rivals, persists for the player, and can be repaired in the garage or pit. A cockpit warning identifies tyre strikes.
- Front contact above 2 m/s closing speed adds ram damage: `(model + 1) × min(8, closingSpeed × 0.6)` with zero-based model. Moving side contact adds wheel damage of 1/2/3 and tyre wear of 0.75/1.5/2.25 points. One contact-weapon application per pair every 1.2 s prevents frame-rate-dependent damage. Ordinary collision damage remains separate.
- Rivals deploy finite hazards when another car follows within 28 m and use passive contact equipment. Individual original rival preferences and exact legacy damage asymmetry remain future tuning. Traps currently cannot be shot away.

Validation: browser purchases, passive upgrade and both rear deployments; deterministic checks for swept hazard hits, tyre wear, vertical separation, expiration, contact cooldowns and v5 migration; garage prices plus mine/caltrop pit transfers and 60-second rival simulations on all ten tracks. Existing 166 checks and production build pass. Full-season human balance testing remains outstanding.


## Gun upgrades and first measured combat balance pass

The machine-gun card offers model II and III upgrades with original runtime prices and capacities. Per `1000:632e`, an upgrade credits only complete 100-round packs of the old model, removes all old rounds, and supplies 100 new rounds. A negative net price is a clearly displayed credit. Model capacities are 1000/700/400 and damage is the original player-to-AI 3/7/11 progression, now applied symmetrically. Pack prices are $300/$800/$1200 for the supported executable. The card explains the stock replacement before purchase; maximum-tier and unaffordable purchases are blocked. Pit rearming automatically uses the new model's price/capacity. The existing v6 save already supports all gun tiers, so no migration is necessary.

`src/remaster/balance.js` holds explicit modern rival profiles: preferred front weapon, straight-line target speed (34–38 m/s before difficulty/condition), 140–200 HP armor, starting gun tier and preferred lane. Wrecker uses gun II; Lurker deploys rear hazards more frequently. These are authored identities, not claims to reproduce original rival statistics. No hidden player-position speed bonus or damage multiplier is used.

Rival changes:

- Higher straight-line pace, with +1.5 m/s per difficulty step. Curvature preview still governs corner speed, now reduced by damaged tyres; engine wear also reduces the speed target.
- Overtaking checks neighboring traffic before choosing a passing lane. If neither side is safe, rivals brake behind the car ahead. Finished/disabled cars do not influence the passing decision.
- Guns, lasers, beams and rockets require a clear road line of sight and sustained aim for 0.45/0.38/0.31/0.24 seconds by difficulty. Firing bursts remain bounded and finite; missile lock timing remains unchanged.
- Rear hazards require a pursuer in the same corridor, not merely any nearby car behind. Separate strategic drop intervals of 5–8 seconds (shorter on higher difficulty) avoid emptying the entire supply in a few seconds. Empty front weapons fall back to guns.
- Moving wheel contact damage/tyre wear is halved and the pair cooldown doubled to 1.2 seconds. Ram contact shares that cooldown. This reduces damage from prolonged crowding without removing deliberate contact attacks.

### Measurements

Deterministic runs use the original ten circuits, career wreck rules, all nine rivals and a protected stationary player in the pit. Each city has equal weight. This isolates rival pace and attrition; it does **not** measure human win rate, all player builds, or a full saved championship. No rivals remained unresolved at the time limit.

| Mean across ten cities | Before, Punk | After, Punk | Before, Mega Destroyer | After, Mega Destroyer |
| --- | ---: | ---: | ---: | ---: |
| One-lap finishers / 9 | 4.2 | 7.0 | 3.3 | 7.3 |
| One-lap wrecks / 9 | 4.8 | 2.0 | 5.7 | 1.7 |
| First finisher, seconds | 106.2 | 102.9 | 99.1 | 98.0 |

After tuning, three-lap averages were 6.3 finishers at Punk and 5.6 at Mega Destroyer; first finishes averaged 304.4 and 289.1 seconds respectively. Seattle retained six finishers at both settings. Los Angeles remains a high-attrition outlier with three finishers at both settings; it deserves human review before further global damage changes. Faster dispersal can reduce one-lap wrecks at higher difficulty, so difficulty is not defined by destruction count alone.

Reproduce current measurements with `node scripts/measure-remaster-balance.mjs 1 300` or `node scripts/measure-remaster-balance.mjs 3 900`. The script reads local original assets, checks finite states and resource bounds, emits JSON and does not access browser saves.

Checks: browser upgrades through both models (including the original net credit), maximum-tier UI and new ammo capacity; diagnostic checks for partial-pack credit, insufficient funds, max tier, pit reload prices/caps, v6 persistence and actual bullet damage at all three models. Existing 166 checks and production build pass. Human driving/weapon balance and individual original rival behavior remain follow-up work.


## Los Angeles and defensive-driving balance pass

The previous Los Angeles result (three finishers at both difficulty extremes) was investigated with an optional `onCombatEvent` diagnostic callback. It reports applied armor damage by source and location without changing combat. On Punk, the baseline accumulated approximately 227 beam, 217 missile, 230 mine, 174 gun and 156 laser damage; ordinary collision plus ram/wheel damage was under 9. The excess attrition was primarily sustained weapon exposure on the long straights, not crash pileups.

The fix is shared driving behavior rather than a Los Angeles damage exemption:

- Passing lanes remain selected for 2.5 seconds so rivals can clear a car before returning toward their preferred lane. Lane decisions use measured road offset, check nearby traffic and follow the nearest lead car.
- A rival hit from behind remembers that attacker for two seconds and can move out of its firing line when a safe lane exists. Shielded hits do not trigger this reaction. Lane-change commitment prevents constant direction changes.
- Rivals look for mine/caltrop hazards 4–32 m ahead in their current corridor, with road line-of-sight and vertical separation checks. They choose a clear lane when possible and brake when their intended path is still blocked. This is limited local awareness; hazards still hit and weapon damage values are unchanged.
- Ordinary collision cooldowns are now per pair, fixing the previous shared cooldown where a collision elsewhere could suppress damage for an unrelated pair. Passive contact weapons retain their separate per-pair cooldown.

### Current three-lap results

Forty deterministic runs: all ten cities × four difficulties, 900-second limit, career wreck rules, player protected in pit. Full data, including damage by weapon, is in [remaster-balance.json](remaster-balance.json). All 360 rivals finished or wrecked; no invalid positions or resource bounds were reported.

| Difficulty | LA finishers / 9 | LA first finish, seconds | All-city mean finishers / 9 | All-city mean first finish, seconds |
| --- | ---: | ---: | ---: | ---: |
| Punk | 8 | 340 | 7.6 | 306.8 |
| Gambler | 7 | 332 | 6.7 | 298.0 |
| Warrior | 5 | 321 | 6.3 | 291.5 |
| Mega Destroyer | 6 | 329 | 5.9 | 289.0 |

The earlier three-lap averages were 6.3 finishers on Punk and 5.6 on Mega Destroyer. Individual cities need not be monotonic: combat timing changes with pace, and LA's Warrior run finished faster but lost one more car than Mega Destroyer. Higher difficulty produces faster leaders and more attrition in the aggregate.

Run `node scripts/measure-remaster-balance.mjs 3 900 all` to reproduce all four settings; omit `all` to use just the extremes. The probe now includes damage totals by cause. These are rival-only balance measurements, not human win-rate or complete championship economy validation. Live browser checking covered Los Angeles selection, acceleration, upgraded gun hits, pause and a clean error log. Focused model diagnostics covered hazard awareness behind/above the car, shielded damage, threat expiration and two independent simultaneous collision pairs. Existing 166 checks and production build pass. Human playtesting of defensive behavior, all player loadouts and longer championships remains necessary.


## Jumps, landings, rear view and instrument layout

Crests now produce natural jumps for player and rivals. There is no jump button. A continuous vertical velocity and 9.81 m/s² gravity replace forced ground contact when the road falls away. A 0.18-second road preview requires sustained clearance (rather than a single segment kink); a short suspension settling interval after touchdown prevents repeated tiny hops. Local route continuity preserves the correct overpass layer. The existing horizontal road corridor remains enforced while airborne, so this is an arcade road-racing model rather than unrestricted off-track flight.

While airborne, steering/yaw, tyre grip, engine drive, brakes and handbrake do not provide ground forces; momentum, drag and gravity continue. Pitch follows the flight arc and blends back to road slope. Touchdown compares downward speed against the rising/falling surface: over 7 m/s relative impact scrubs speed, over 9 wears tyres, and over 12 can damage armor (capped at 18 HP). The cockpit reports AIRBORNE, TOUCHDOWN or HARD LANDING, with a bounded landing camera impulse. Disabled airborne cars still fall instead of freezing in midair. Recovery clears vertical motion without adding progress or repairing the car.

Rear-deployed hazards cannot be dropped while airborne, pit entry requires ground contact, and braking in the air cannot defeat a missile lock. The incoming-missile prompt instead advises landing to brake or intercepting the missile. Swept weapon volumes already follow the car's vertical position.

A live, horizontally mirrored rear-facing camera is displayed above the racing view. Its label identifies the nearest visible pursuer within 100 m, the side, distance, closing movement and attacks that have hit the player. Road occlusion and vertical separation constrain the label; the mirror itself renders visible world geometry, cars and projectiles. Nearby pursuers highlight the frame. Visible mine/caltrop hazards ahead get a separate warning; missile warnings take priority. This is advisory awareness, not automatic target lock or aim assistance.

Settings → Rear-view mirror toggles the extra render pass. High quality uses one 512×160 render target; Balanced uses 384×120 and refreshes every other frame. The camera and texture are reused, and scene disposal releases them. The mirror works with both chase and driver cameras. Quality mode and mirror visibility are session settings.

Race time, weapon selection/resources and speed now form a right-hand vertical column in that order. The minimap stays left and the racing line is clear. Smaller layouts compact the instrument column and move the mirror left; the weapon panel scrolls when vertical room is limited. Pit and missile prompts sit below the mirror on desktop.

Validation includes controlled crest takeoff/landing, no flat-road hopping, blocked airborne steering/braking and rear deployment, recovery reset, disabled-car descent, rear-target distance/closing/height filtering, and original-circuit AI runs at all four difficulties. Browser checks cover the live mirror, nearby pursuer labels, relocated weapon buttons, pause, chase/driver views and toggling the mirror with both quality settings. Full human jump/landing and performance tuning remains necessary; the original 166 checks do not prove remaster physics parity.

The final airborne balance probe is saved in [remaster-airborne-balance.json](remaster-airborne-balance.json), preserving the earlier grounded baseline separately. Across 40 three-lap runs (ten cities × four difficulties), rivals recorded 347 landings and every rival finished or wrecked within 900 seconds. Mean finishers out of nine were 7.4 / 6.4 / 6.1 / 6.0 from Punk through Mega Destroyer. The player was stationary and shielded in the pit for these measurements; they establish simulation completion, not player difficulty. Final verification passed all 166 existing checks and the production build (with the existing large-chunk advisory).

## Autopilot and HUD visibility

J or the footer's Autopilot button delegates steering, throttle and braking to the modern road-following controller. The original used A (`DS:9a82`, documented in `docs/re/race.md`); J avoids the remaster's WASD steering binding. The player still selects targets, switches weapons and fires. Autopilot previews corners, follows traffic and avoids local hazards with the same physical controls as manual driving. Its authored 34 m/s cruise target does not increase with difficulty; car performance, mechanical condition, fuel, grip, collisions and airborne restrictions still apply. This preserves the original driving/combat split rather than reproducing its tick-based steering or centrifugal-drift exemption.

Any driving key immediately disengages autopilot, even if the key is released between physics steps. F and weapon/target keys leave it engaged. Pausing suspends the simulation without discarding the selected mode. New events, recovery, pit entry and disabling damage disengage it. It does not automatically recover a stuck car, enter a pit, spend money, repair or refuel. The footer indicates its state even with the HUD hidden.

H or the HUD button cycles Full → Minimal → Hidden. Minimal removes standings, minimap, circuit labels and the contract overlay while retaining position/lap, instruments, mirror and combat cues. Hidden removes all racing overlays including the mirror render pass, except countdown/pause messages. Header/footer controls, pit-service UI and results remain available. Settings independently toggle time/weapons/speed, standings, minimap, combat overlays and mirror. These preferences are combined with the selected mode and stored separately from career saves in `deathtrack-remaster-display-v1`; unavailable storage falls back to session-only settings. Autopilot always starts off and is not a saved driving preference.

Validation: autopilot completed one lap on each of the ten circuits (90–168 simulated seconds), consumed fuel normally and fired zero shots without player input. For this steering diagnostic the player had a repeatedly refreshed shield, so it is not a survival or combat-balance result. Browser exploration confirmed autopilot movement, immediate manual takeover, Full/Minimal/Hidden cycling, instrument hiding, settings and preference restoration after reload. All 166 existing checks pass. Human driving/combat balance remains a follow-up.

## Named drivers and portable saves

Driver & saves is available from the opening screen (even before assets load) and from the garage. Each mode has one active named driver; export additional careers as JSON files. Names are 1–24 characters and appear on the race-entry button, standings and results. Continue career opens the saved championship garage rather than starting an event immediately.

Profiles now use `deathtrack.remaster.practice.v7` / `deathtrack.remaster.career.v7`. Version 6 migrates without changing equipment or season progress; older migrations remain available and old keys remain untouched. Export envelopes use `format: deathtrack-remaster`, envelope version 1, export time and a validated profile. No original asset bytes are included. Imports are limited to 64 KB, reject wrong-mode/unknown versions and invalid resource or season fields, and require a preview/confirmation before replacement. Choose the matching mode before importing. Imported active events become interrupted without a payout; mid-race continuation and legacy RCT interchange remain outside scope.

Changed autosaves retain the previous valid v7 checkpoint in `.backup`. Import/reset/restore preserves the exact existing stored profile in `.recovery` before replacement, even if those bytes are unreadable. Review recovery copy prefers a readable replacement recovery, then the last autosave backup. Recovery is explicit, not silent. Storage failures abort replacement before changing the in-memory profile; unreadable current saves block racing and ordinary writes until restored, imported or explicitly reset. Retirement and career restart ask for confirmation. Export remains useful when ordinary storage writes fail.

Validation: isolated in-memory-storage diagnostics exercised v6 migration, export/import identity and cash retention, invalid JSON/future version/wrong mode rejection without writes, reset/recovery, failed replacement, interrupted-event resource retention without payout and corruption preservation/recovery. Browser exploration verified naming, recovery preview and applying recovery, preserving the practice balance/equipment. No destructive checks were run on the user's career. Simultaneous tabs, cloud synchronization, multiple in-app slots and mid-lap snapshots are not implemented.

## Rival archive, track dossiers and showroom

Archive opens from the main header. Opening it during a race pauses driving; closing leaves the race paused until explicitly resumed. Browsing never changes the selected car, city, loadout or career. Rival bios, Track dossiers and Car showroom are keyboard-accessible categories with selected-entry indicators. The showroom rotation slider accepts keyboard input and does not run an animation loop.

Biographies use the original eleven-line records (nine rivals), and dossiers use twelve-line records (ten cities). Text is read from the unpacked executable at image segment base 0x23ae0 with signed offsets from DS 0x26fa0 tables 0x21cc / 0x2562, plus bases 4 / 0x2a73, matching translated `1000:a2de`. Full original rival names and line breaks are preserved; track lines are reflowed. Untrusted file text is assigned via textContent. Decoding is bounded and errors have an unavailable-content state.

The optional nine portrait BMPs and ten city BMPs are loaded alongside required racing assets, decoded through the existing resource reader and displayed in the EGA palette. Missing illustrations do not prevent racing or reading descriptions. Folder loading and the development loader both include these optional resources. No original texts or pixel dumps are copied into source.

Dossiers plot the original route and pit index, with length and elevation range explicitly labeled as modern world-scale measurements (0.05 scale, unsmoothed route). The three car previews use the original MYCAR models with authored showroom coloring. Factory equipment comes from the same fresh-profile data used by the garage; performance comes from vehicleSpec and is labeled modern starting performance, distinct from a player's upgrades/damage.

Validation: all nine biography records, all ten dossier records and 19 original illustrations decoded from local files. Browser exploration covered the categories, original text/portrait, track map/dossier and showroom rotation. Statistics and top money winners are not part of this delivery.

## Driver statistics and top money winners

Archive now includes Driver statistics and Top money winners. Statistics read a snapshot of the active profile: career earnings, current cash, settled career events, current-season rank/points/wins, finishes/DNFs, season income and the per-city result log. In-progress events are not counted. Practice explicitly reports its separate balance/last outcome without implying career statistics. Lifetime wins, lap records and combat totals are not reconstructed from incomplete old saves.

The optional original HI_SCORE is decoded as ten 19-byte records and sorted by unsigned recorded money descending, with source slot as the tie-breaker. The original inserts cash into an unsorted table (`1000:25bc`); the Archive explains that this differs from remaster lifetime earnings. Missing/truncated files display a specific fallback. Original data is read-only.

The local remaster board stores the ten highest career-earnings records, one best result per driver identity, in deathtrack.remaster.money-winners.v1. Equal totals use stable identity ordering. Saves gain a UUID driverId (an additive v7 field); existing v6/v7 profiles receive an identity when loaded, which is preserved on save/export/import. Reset creates a new identity. Renaming updates the displayed name without duplicating a record; restoring an older checkpoint never reduces its best recorded earnings. Practice never enters the board. Profiles remain authoritative; failed/unreadable board storage does not prevent a profile write, reports a warning and preserves unreadable records. Records remain browser-local rather than being bundled into individual career exports; importing a career records its retained earnings without paying money again.

Validation: isolated diagnostics checked identity migration/export, repeated-write deduplication, best-score retention, practice exclusion, top-ten bounds, original ten-record decoding and corrupt-board preservation. Browser checks covered practice statistics and original money-winner display. Existing verification and production build remain separate from remaster model diagnostics.

## Title, credits, demonstration and audio controls

The opening screen now carries the Deathtrack title and offers Title & credits and Watch demo alongside career/garage entry. The credits dialog reads all 85 original lines from the unpacked executable's DS:0530 pointer table, preserving named contributors and copyright text, with optional TITLE.BMP artwork. This is a modern static title/scrollable-credits equivalent; the faithful port retains the original TTM animation. Missing title artwork or music never blocks racing.

Watch demo starts a separate fresh-stock Hellcat race on the currently displayed circuit. It uses autopilot and periodic firing with the original nine rivals; it repeats after 90 simulated seconds or the race ending. Pause/resume, camera change and Esc/Return to menu are available. Focus loss pauses the demonstration. No idle timer starts it unexpectedly. The demo never calls garage.begin/checkpoint/settle, never replaces the player's driving state, and cannot spend funds, change inventory, advance a championship or add records. Returning restores the menu's car and mirror preferences.

Sound on is an explicit session opt-in/master toggle. Settings adds separately remembered music and effects volumes (zero mutes that channel) under deathtrack.remaster.audio.v1. DANGER.MUS supplies menu music and TRAX.MUS race/demo music. Both decode through the existing SND/LZW/MIDI readers. Playback is a deliberately simple synthesized rendition, not MT-32/OPL hardware emulation: MIDI program changes/SysEx are not reproduced. Scheduling uses a short lookahead and at most 64 active voices, with cleanup; music loops and restarts after pause or mute. Effects volume controls the existing synthesized engine and player weapon sounds; spatial rival audio remains later polish. Missing/unreadable music is reported as an available-track count. Hidden pages and paused races mute music/engine, and page exit releases music voices/audio context.

Validation: all 85 credit lines decoded, DANGER.MUS produced 299 notes (~32.2 s) and TRAX.MUS 5,924 notes (~99.5 s). A 90-second demo model run advanced and fired without any local-storage access. Browser checks covered credits/title artwork, demo launch/pause, and independent audio sliders. These checks confirm controls and decoded playback paths, not an acoustic fidelity assessment.

## Keyboard rebinding, comfort and gamepads

Settings → Controls & comfort provides 22 primary keyboard bindings, duplicate-key rejection, Escape-to-cancel capture and reset-to-defaults. Arrow driving keys and Escape pause are fixed fallbacks; Tab/Enter remain available for UI navigation. Modifier shortcuts are not captured during racing. Bindings translate physical event.code values to the existing action commands; HUD weapon keys, main action buttons and fire/target/pit prompts reflect remaps. Settings' long help paragraph explicitly describes default bindings. Keyboard release bookkeeping handles multiple keys for the same action without premature release; pausing/rebinding clears held input.

Reduced camera shake & speed zoom removes impact-induced camera roll and the speed-dependent FOV increase in both cameras and demos; it retains smooth following and necessary road/elevation tracking. The initial default follows prefers-reduced-motion, and explicit preferences are saved. Bindings, reduced motion, gamepad enablement and stick deadzone live separately from careers in deathtrack.remaster.controls.v1. A storage failure leaves session settings usable.

Standard-mapped browser gamepads support analog left-stick steering, RT/R2 throttle, LT/L2 brake, A/Cross fire, B/Circle handbrake, X/Square next weapon, Y/Triangle target, LB/L1 camera, RB/R1 autopilot, View/Select HUD, Start/Options pause, left-stick click recovery and right-stick click pit entry. Controller selection is session-local; default uses the first standard-mapped controller. Unsupported mappings receive a message instead of guessed axes. Deadzone is configurable from 10–40%; triggers have a small noise threshold. Keyboard steering takes precedence when held, while analog pedals merge by maximum value. Significant driving input disengages autopilot.

Controller polling uses fresh navigator.getGamepads() values each frame. Actions trigger on button edges, not every held frame. New connections, dialog closure and pause transitions require neutral controls before arming. Controller loss pauses a running player race. Controllers do not operate menus, accept confirmations or retire/reset profiles; those remain keyboard/mouse actions. Demo input remains separate. Mapping reference: https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API.

Validation: browser exploration confirmed settings, duplicate-key rejection and a saved replacement fire binding; model diagnostics checked neutral deadzone, signed proportional steering, independent analog triggers and full steering range. No physical gamepad was detected in this environment, so real-device layout, reconnect and handling feel still require hardware validation. This is not a claim of fully gamepad-navigable menus.

## Spatial combat audio and damage feedback

The remaster now consumes a separate, bounded presentation-event queue from combat. Successful shots from every car, armor/contact hits, projectile interceptions/explosions, hazard strikes and wrecks emit positions. Successful live pit transactions emit a completion cue only after the service callback succeeds. These events do not change combat statistics, damage, AI or saved progress. Reset clears the queue; draining consumes each event once. The queue holds at most 128 events.

`spatial-audio.js` synthesizes effects through HRTF panners with inverse distance attenuation. The listener follows the player's heading, independent of chase/cockpit view; world +Z is converted to listener-local -Z so left/right/front/rear remain consistent. The mixer has at most 24 transient voices, ten fixed engine sources (only the player and three nearest running rivals are audible), and one approaching homing-missile tone. Events outside 180 metres are discarded. A compressor controls overlapping peaks. Sources disconnect after completion; changing races clears tails. These are modern synthesized sounds, not original engine or sound-card emulation. Sound remains opt-in; all effects use Effects volume and music retains its independent level. Pause, hidden pages, mute and zero effects volume silence effects and discard pending cues rather than replaying them on resume.

Player hit text names the attack type and the attacker's current bearing, where available; it is not a precise projectile-origin indicator. Critical armor and mechanical condition recommend a pit stop. Live service completion confirms success. Bodywork darkens with armor loss, while disabled cars or cars below 35% engine / 30% armor condition emit pooled smoke (shader billboards; 30 static fallback meshes with reduced motion). Repairing the relevant condition stops new smoke, with existing trails fading out. Reduced camera shake also removes the full-screen hit flash and freezes smoke animation; text warnings remain available through the existing combat HUD controls.

Validation: production build and 166 existing checks passed. Inline diagnostics exercised player/rival fire events, damage/wreck emission, drain-once/reset behavior, the 128-event bound and spatial orientation at four headings. The browser demo ran with audio enabled after correcting an obsolete old-audio counter reference. Headphone listening, device-specific spatial perception, all live pit outcomes and sustained heavy-combat mix/performance remain human validation items. No sound occlusion through scenery or Doppler simulation is claimed.

API reference: [Web Audio PannerNode](https://developer.mozilla.org/en-US/docs/Web/API/PannerNode).

## City and car art pass / ten-circuit inspection

`city-style.js` supplies deterministic city-specific skyline density/heights, facade palettes, sky and sunlight colors, vegetation and landmark silhouettes. Orlando has palms and an observation wheel; Bay Area evergreens and a bridge; Phoenix cacti and mesas; New York dense towers and a spire; St Louis an arch; Los Angeles palms and hills; Seattle evergreens and the Needle; Houston industrial silos; Boston brick colors/cornices and a clock tower; Chicago tall towers with twin aerials. These are stylized art motifs, not geographically accurate replicas. Decorations retain conservative whole-footprint clearance against every road segment. Trees stand on the ground plane, including near elevated roads. Static scenery continues to batch by material.

The original car silhouettes remain. Shared detail adds alloy rims, rear diffusers and exhaust tips. Red rear lights brighten on observed deceleration (not a direct brake-pedal signal); damage materials and motion preferences remain intact. Original car geometry has not been replaced with newly modeled high-detail bodies.

Inspection fixed two defects: pit boards now sit 12 metres from the centerline and require clearance for their entire 5-metre board; Bay Area's coincident samples 99/100 now share their smoothed height, removing a 3.7 cm vertical sliver without shifting source indices. The visual pass also corrected additive emission that washed out the sky and facade colors.

Run `node scripts/inspect-remaster-circuits.mjs` with local originals for geometry, scenery footprint and live pit-entry measurements. The report in `docs/remaster-circuit-inspection.json` contains summaries, not original asset dumps. All ten have finite geometry, clear new decoration footprints and successful pit entry. The one coincident Bay Area sample is retained intentionally. All ten opening/demo scenes were rendered and visually inspected in the browser; no browser errors were reported. Career resources were untouched; the previous practice circuit and career mode were restored.

This is not a complete human lap or release sign-off. Crossings require focused play: Bay Area is level, New York has a 0.56 m difference, Boston has 1.94 m road-to-road separation, Orlando 3.88 m and Seattle 5.84 m. These are centerline measurements, not vehicle headroom guarantees. Prioritize New York and Boston for actual crossing/rail/camera clearance checks. Full-track scenery viewing, car-specific clearance, long-session performance and human championship balance remain open.

## Focused New York / Boston crossing repair

The focused pass reproduced insufficient grade separation in the smoothed source geometry: 0.56 m in New York and 1.94 m in Boston. `prepareRoad` now lifts only the identified upper branch of these two remaster circuits, maintaining XY coordinates, source indices, lower roads and pit references. A 22 m central region receives a constant lift; each side blends back over 120 m using a quintic smoothstep. All simulation/rendering and inspection/balance tools use the same prepared road. The faithful port and source assets are unchanged. New underside ribbons and supports make the raised crossings visible; support footprints must clear every road segment.

| Circuit | Previous road separation | Revised separation at crossing | Minimum body margin in probes | Minimum nominal chase-camera margin |
| --- | ---: | ---: | ---: | ---: |
| New York | 0.56 m | 7.06 m | 4.82 m | 2.12 m |
| Boston | 1.94 m | 7.53 m | 5.32 m | 2.62 m |

`node scripts/inspect-remaster-crossings.mjs` performs 48 deterministic runs: both cities, both routes, lateral offsets -4/0/+4 m and entry speeds 36/90/144/216 km/h. Runs start/end 115 samples from the crossing, covering the entire lift transition. All completed without switching to the other branch. A conservative 1.8 m car envelope exceeds the rendered body height of all three player cars (1.35–1.70 m). Reported margins include the 0.35 m underside offset; camera margins use the nominal chase position, not a collision-resolving camera model. Results: `docs/remaster-crossing-inspection.json`.

A local, save-independent inspection page at `.local/reviews/crossings/index.html` was used to drive through both branches of both cities at 90 km/h and inspect chase/driver views at each crossing. All four traversals completed, and browser logs reported no errors. Build and all 166 existing checks passed; the all-ten-city geometry/pit report was refreshed. These focused crossing blockers are resolved. Arbitrary airborne impacts, combat pileups, full championship balance and release performance remain broader acceptance work.


## Gritty Seattle showcase

Seattle now uses patched, cracked asphalt with tyre wear, a grey overcast sky, cooler fill lighting and restrained bloom. Road texture coordinates follow cumulative track distance, keeping detail density consistent through curves and elevation. Original road geometry and gameplay are unchanged by this presentation pass.

The ten race cars use deterministic paint and metallic/roughness atlases with panel seams, vents, numbers, rivets, grime and chipped paint. Face-oriented UVs retain the original polygon silhouettes; all three player bodies support the material. These shared car materials and combat effects apply to other remaster cities too; Seattle's asphalt, overcast treatment and scenery shadows are city-specific. The archive showroom has not been changed. Textures are generated once per scene from authored drawing instructions, with no external downloads or original asset copies. Twenty 768×512 car maps use about 40 MiB including mipmaps before driver overhead; disposal follows scene lifetime.

Filtered shadow maps and soft contact patches ground the cars. High uses a 1024² shadow map with car and batched Seattle facade/rail casters; Balanced uses 512² and car casters only. Contact patches hide while airborne. This is bounded shadow mapping, not ray tracing or volumetric lighting.

Smoke now trails in world space and expands/fades. Explosions progress from amber fire to dark smoke with short-lived sparks. Babylon shader-rendered billboards use CPU particle simulation: ten 32-particle smoke pools plus six reusable 64-particle fire / 24-particle spark pairs, a hard total capacity of 848. High emits ten smoke particles per second per damaged car and 32 fire / 12 spark particles per large blast; Balanced uses four and 16 / 6 respectively. Pools are reused rather than creating meshes per hit. Pause freezes simulation; reset clears pools. Reduced motion clears animated particles and retains static damage clouds and small fixed-size impact markers. Shaders are registered eagerly to avoid development-time lazy-loading failures.

Browser verification used `.local/reviews/gritty/index.html`, a save-independent Seattle scene with the actual renderer, ten cars, six large blasts each second, damaged-car smoke and the rear-view mirror. At 1280×720 after warm-up, sampled 180-frame windows reported:

| Quality | FPS | p95 frame interval | Average render CPU time | Observed active particles |
| --- | ---: | ---: | ---: | ---: |
| High | 60 | 17.7 ms | 3.8 ms | 430–465 |
| Balanced | 60 | 17.3 ms | 2.7 ms | 202 |

All three player bodies, pause/resume, reduced-motion clearing and particle restart were inspected; clean browser logs reported no errors. Production build and the 166 existing checks passed. The build retains its large-chunk warning. These are short local browser samples, not GPU timings, minimum-hardware guarantees or a sustained full-championship benchmark. Representative hardware, long-session memory/frame-time checks and the complete combat/hazard load remain release work. Weather and fixed time-of-day presets are delivered below. Automatic daylight is delivered below. Volumetric smoke, depth-softened particle intersections and a gritty art pass for all cities remain optional future presentation work.


## Weather, daytime and procedural sky

Settings → Sky & weather now offers Daylight, Dawn, Dusk and Moonlit night, independently combined with City default, Clear skies, Overcast, Rain or Fog. City default selects overcast for Seattle and clear elsewhere. Preferences are validated against known values, stored separately in `deathtrack-remaster-atmosphere-v1`, and applied when creating a circuit; unavailable storage falls back safely. The settings work in the menu and paused races. They are presentation preferences, not profile equipment or championship rules.

`atmosphere.js` supplies a procedural sky shader with a height-based color gradient, three noise layers for drifting clouds, a directional sun/moon disc and night stars. The same preset sets directional-light color, direction and strength, ambient fill, fog color/density and road wetness. Shadow placement follows the light direction around the player. Reflection probes refresh once after changing a preset. Night retains ambient fill and edge reflectors for racing visibility; this is stylized moonlight, not physically simulated night lighting. Fixed time-of-day presets remain available. Automatic weather and an independent automatic day/night cycle are delivered below.

Rain uses one 400-particle CPU-simulated billboard pool around the camera, with 420 particles/second on High and 160 on Balanced, and 0.8–1.1 second lifetimes. It is rendered in the world and rear-view mirror. Rain darkens asphalt and increases specular response; it does not implement puddles or screen-space reflections. Fog uses the scene's exponential distance fog. No grip, fuel, damage, AI accuracy or progression values change. Rain surface occlusion, pooled impact ripples and weather audio are now delivered below. Tyre spray and accumulation remain optional follow-ups. Real headlight beams and animated weather/daylight transitions are delivered below.

Pause freezes rain and cloud drift; scene reset clears rain. Reduced motion removes rain particles and freezes clouds while preserving the chosen lighting/fog/wetness. Turning it off resumes emission. One sky material and one fixed particle pool replace the previous baked sky texture; changing presets does not create new pools or textures.

Browser validation inspected daylight rain, dawn fog, clear dusk and rainy night; verified preference persistence after a game reload; and exercised the actual attract-mode scene without changing career resources. Pause retained stable particle counts, reduced motion cleared rain/combat particles to zero, and resume restored both. No browser errors were reported. With ten damaged cars, six large blasts per second and the mirror enabled, 180-frame windows at 1280×720 reported 60 fps: High p95 17.3 ms / 3.1 ms average render CPU (246 rain + 390 combat particles), Balanced p95 17.4 ms / 2.2 ms CPU (93 rain + 181 combat particles). These are short local measurements, not minimum-hardware guarantees or full ten-city/all-preset acceptance. Production build and all 166 existing checks passed; the existing bundle-size warning remains.


## Automatic weather transitions and lamp direction

Settings → Sky & weather → Weather now includes **Automatic · changing weather**. It begins with the city's default (overcast in Seattle, clear elsewhere), holds a settled condition for 60 seconds of running simulation time, then blends to the next over 20 seconds. The repeating sequence is clear → overcast → rain → overcast → fog → clear. This is a deterministic visual cycle, not a forecast or random championship modifier. The chosen mode is remembered with the existing atmosphere settings.

Cloud coverage, sky colors, fog density, sun/ambient lighting, rain emission, asphalt color/specular response and wetness interpolate together using smoothstep easing. Manual weather or daytime selections blend over eight running seconds; a new selection midway starts from the currently displayed mixture, avoiding a snap back to either preset. Initial scene creation applies the saved setting immediately. Rain particles fade through their normal lifetime rather than being cleared at each preset change. The reflection probe refreshes only when a transition settles, not every frame.

Pause and non-racing menu time freeze the cycle and blend progress. Settings changes made while paused begin blending when racing resumes. Reduced motion still hides rain and freezes cloud drift; gradual lighting/weather transitions continue during racing. Automatic weather runs independently of the optional automatic daylight mode; neither changes grip, rival accuracy or career resources. The existing 400-particle rain limit remains in force. Full-cycle/all-city visual acceptance and tyre spray remain follow-ups. Automatic daylight is delivered below.

Street-lamp anchors are rotated by π relative to the road tangent, turning both the arm and lens inward on both road sides. Pole positions and road clearance are retained. The orientation correction retains emissive fixtures; the subsequent night-lighting pass adds pooled nearby spotlights below.

Validation: browser exploration confirmed Automatic survives a reload, advances from Seattle overcast into rain, and increases wetness/rain emission progressively. Pause held the automatic blend at 32% with wetness 0.24; retargeting a later manual blend to fog preserved approximately 0.55 wetness at its new starting point. Both sides' inward-facing lamp arms were inspected on the Seattle route. Transition samples with the mirror enabled reported approximately 60 fps and p95 17.6 ms on High at 1280×720; these remain short local samples. Browser logs were clean. Production build and 166 existing checks passed; the existing large-bundle warning remains.


## Automatic daylight and night illumination

Settings → Sky & weather → Time of day includes **Automatic · day & night**. A six-minute loop holds each stage for 45 seconds and blends for 45 seconds through day → dusk → night → dawn → day. It uses running race time; pause and menus freeze it. Weather and daylight now have independent blend tracks, so rain can arrive while daylight fades without resetting either cycle. Manual changes retain eight-second retargetable blends. The existing preference record accepts the new automatic daytime value. Fixed daytime and weather options remain available. Reduced motion freezes cloud drift and hides rain while retaining gradual lighting changes.

`night-lighting.js` creates two cool player headlight spotlights following car position, heading and pitch, plus warm spotlights below nearby lamp lenses aimed toward the road. These illuminate road, cars and scenery through the normal material lighting. Lamps and headlights brighten with the interpolated darkness factor; rain also enables dim daytime headlights. Night does not change vehicle handling or rival targeting.

The total budget is eight lights including sun and sky: two player beams, up to three nearby street lights and one nearby rival's combined headlight beam on High. Balanced retains the two player beams and two street lights, disabling the rival beam. Slots are allocated once; street-light and rival reassignment fades out before relocation, then fades in. Street lighting additionally fades with distance, and lamp/headlight lens emission follows darkness. Materials support all eight lights so road illumination is not silently truncated to Babylon's default light count. Cone falloff is softened separately for narrow headlights and wide street lights. Headlights and nearby street lights now use filtered shadow maps in addition to sun/moon shadows. Cars, road surfaces, shoulders, concrete and guardrails/overpass undersides block local illumination. Volumetric beams and lighting every distant lamp are not implemented.


Validation: the actual game restored Automatic day & night after a reload. Browser exploration checked chase/driver night views, High/Balanced local-light budgets (six/four active local lights), and concurrent automatic weather/daylight blending. Pausing held rain at 71% and dusk at 65%, with wetness 0.79 and darkness 0.47; reduced motion cleared animated particles without changing these values. Short 180-frame night/rain/combat samples at 1280×720 with the mirror enabled reported 60 fps and p95 17.6 ms on both quality levels (High: 244 rain / 358 combat particles; Balanced: 91 / 204). These are local samples after shader warm-up, not hardware guarantees or a full-cycle/all-city performance sign-off. Browser logs were clean. Production build and all 166 existing checks passed; the existing bundle-size warning remains. Full six-minute cycle viewing, overpass light leakage and long-session night-race acceptance remain release checks.


### Local-light shadows and crossing occlusion

Each active player/rival headlight or nearby street-light slot has a PCF-filtered shadow map: up to six 512px maps on High, or four 256px maps on Balanced. Maps remain allocated; inactive slots stop refreshing, and reactivation refreshes immediately. Quality changes resize the existing maps. This keeps lighting and shader budgets bounded through dusk, dawn and lamp reassignment.

Casters include the road ribbon, shoulders/concrete, guardrails and overpass underside structures, plus enabled car bodies. The list follows car replacements so showroom/garage changes do not retain disposed meshes. A beam excludes its own emitting car because the lamps sit close to the original body shell; other cars block it. Street lights include all enabled cars. Full facade/tree occlusion remains outside this local-light caster budget, and soft shadow edges can show limited resolution at distance. Emissive lenses and ambient sky illumination are not occluded direct-light beams.

Local visual checks compared shadows on/off at New York and Boston with a downward-facing rival beam on the upper road. Enabling shadows removes the stray patch beneath the crossing while preserving the lower car's forward illumination. Seattle checks covered the ten-car field, live model replacement and rain/combat with the mirror enabled. These are focused desktop checks, not all-city or representative-hardware certification.

Validation on this local desktop: High held 60 fps (180-frame window, p95 17.6 ms; render CPU 11.6–14.0 ms) with six shadowed local lights, roughly 250 rain and 380–460 combat particles plus the mirror. Balanced held 60 fps (p95 17.6 ms; render CPU 6.8 ms) with four shadowed lights, roughly 96 rain and 181 combat particles plus the mirror. Browser console checks were clean; the existing 166-check verifier and production build passed. Longer runs and lower-end hardware remain release checks.


### Sheltered rain, splashes and passing storms

Rain now queries a static 16 m spatial index of the rendered road/shoulder, concrete and city facade triangles. The highest surface at each drop's position catches rain, including upper decks at New York/Boston crossings; a ground fallback catches open terrain. Nearby cells avoid per-drop full-scene raycasts. This covers structural surfaces, not moving car bodies or foliage. Rain retains its 400-particle cap and 420/160 particles-per-second quality rates; longer 0.8–1.1 second lifetimes let drops reach the road from the camera-local emitter.

Impacts expand and fade as translucent ripples from a fixed 32-slot High / 12-slot Balanced pool. Hidden/expired slots are reused, with no per-impact mesh or texture allocation. Tall cover suppresses drops spawned beneath it without creating phantom splashes. Pausing freezes weather effects; reduced motion clears rain/ripples and disables lightning flashes.

Sustained rain occasionally produces a single soft cloud-lightning glow, followed by thunder 1.5–4 seconds later. The first event waits 25–50 seconds of substantial rain, with 35–75 seconds between later events. Storm timing follows running race time and uses presentation-only randomness; it does not alter handling, damage or rival behavior. Reduced motion preserves thunder but suppresses the glow.

Weather audio starts through the existing Sound control and follows Effects volume, pause and page visibility. One looping filtered stereo noise voice supplies rain, attenuated and muffled beneath structural cover; at most one four-second low thunder voice plays. Mute/pause stops thunder, consumed events are not replayed on resume, and page teardown disposes audio nodes. Fine headphone/speaker mixing remains a listening check.

Validation: local browser exploration confirmed sheltered exposure (0.15) on the New York and Boston lower roads and open exposure (1) on Boston's upper road. Rain remained outside the covered road corridor; pools produced 32/12 active ripples. A natural storm advanced lightning and delayed-thunder counters. High night/rain/combat/mirror held 60 fps in a short 180-frame window (p95 17.5 ms, render CPU 7.0 ms); Balanced held 60 fps (p95 17.5 ms, CPU 4.7 ms). Sound activation and pause produced no browser errors. Existing verification passed all 166 checks, and the production build passed with the existing bundle-size warning. These samples do not replace sustained performance and listening checks.


### Sustained ten-city rain/night check

The scripted renderer completed 20 minutes of measured all-city High/Balanced rain, storm, night-lighting and mirror load, plus an all-city post-fix Balanced regression. The soak found and fixed a fifth local shadow appearing during Balanced street-light handoffs. The corrected allocation stays at four in every circuit. Baseline average rates were 59.90–60.00 fps with two isolated >50 ms stalls; no browser errors occurred. See [method, per-city results and limitations](remaster-weather-performance.md), including the repeated Chicago sample after screenshot capture changed the viewport. This closes the local all-city rain/night rendering soak, not full-career or representative-hardware performance acceptance.

## Full-race AI, physics and pits (25 October 2026)

Full-race AI/physics checks are complete across all ten circuits: 90 independent fixed-step scenarios (6.13 simulated hours), all 50 three-lap practice finishes and all 280 pit services, with no stalls or invalid states detected. Career scenarios ended in seven finishes and 33 wrecks; human championship survival/economy balance remains open. Live pit transactions exposed and verified a fix for a $1 floating-point repair overcharge. See [method, per-city outcomes, live pit verification and limitations](remaster-full-race-checks.md). The accelerated diagnostic does not replace a persisted human ten-event championship or browser performance acceptance.

## Championship balance pass (26 October 2026)

The first persistent championship balance pass is delivered: all three cars completed ten-event Punk seasons with paid upgrades/repairs and conditional pits. Focused armor/tyre pit repairs and engine-aware autopilot are implemented. Matched no-pit controls left Hellcat and Crusher unable to afford repairs; Pitbull completed without stops. All planned runs lost the title, so human wins, harder difficulties, contracts and second-season sustainability remain open. See [season strategy, cash ledgers and validation](remaster-season-balance.md).

### Archive portrait colors and rival profile facts

Archive portraits and city illustrations use the first EGA palette in `PALS.BLK`, as the faithful port does, including index 13 mapping to black. The per-driver palette selectors at DS:17ca apply only to CGA/Tandy, not the remaster’s EGA illustrations. Missing palette files report a reload message instead of silently substituting incorrect colors.

Rival bios now show Home, Favorite food, Favorite weapon and Best track. These values are decoded from the unpacked executable’s DS:181c, 17e8, 1884 and 1850 pointer tables with driver indices 1–9. They are the correct-answer entries used by `2524:21d2` / `1000:2230`; indices 10–25 are distractors and are not displayed. The quiz and its penalties remain disabled.

### Portrait de-dithering

Archive rival portraits always use 70% smoothing, without a toggle or strength slider. Old saved portrait preferences are ignored. Original files and the faithful port are unaffected.

`portrait-filter.js` implements a small custom filter, not MDAPT, xBRZ or AI restoration. It detects alternating local color changes in multiple directions, then blends those pixels with a 3×3 weighted neighborhood. A blurred color guide reduces blending across broad edges. Browser interpolation smooths enlarged portraits.

The finished 70% result is computed once per portrait and cached for the current asset set; there is no per-race-frame processing. Loading a new asset set clears the cache. City illustrations, car models, text and race rendering are unchanged.
