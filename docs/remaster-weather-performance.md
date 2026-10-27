# Ten-city rain/night performance soak — 25 October 2026

Completed 20 minutes of measured renderer load: 60 seconds on High and 60 seconds on Balanced for each original circuit, plus five-second warm-ups. Each sample toured the entire road with ten damaged cars, six explosion events per second, rain/ripples, natural lightning/thunder, night lights/shadows, weather audio and the rear-view mirror. The ten scene rebuilds also exercised disposal and re-creation.

This is a **scripted rendering diagnostic**, not a real-time AI/physics or full-career playthrough. Road poses are interpolated along the circuit to guarantee geometry coverage. The CPU figure includes preparing the diagnostic frame and rendering, but is not GPU time. No driver saves were touched.

## Results

The baseline recorded 72,017 frames over 1,200.48 measured seconds. All cities experienced natural lightning and delayed thunder. Average frame rates were 59.90–60.00 fps, with 99th-percentile frame times of 17.6–17.7 ms. There were no browser errors. Two isolated stalls exceeded 50 ms: Orlando Balanced at 67.7 ms and Los Angeles Balanced at 116.8 ms. Their cause was not established; do not attribute them to the shadow fix or claim they are eliminated.

High stayed within six local shadow maps. Balanced briefly reached five instead of four during street-lamp handoffs: two desired lamps and a fading old lamp could occupy all three allocated street slots. `night-lighting.js` now reserves only two street slots on Balanced and clears the third before assignment. Existing lamp fade behavior remains within those slots.

After the fix, a fixed-viewport regression toured all ten circuits on Balanced: 20 measured seconds each, with a full 60-second repeat for Chicago, plus warm-ups. Every sample held a maximum of four shadows and approximately 60 fps, with no frames over 50 ms and no browser errors. The short Orlando/Los Angeles repeats did not reproduce the baseline stalls. This regression does not replace the longer baseline or a multi-hour endurance run.

| Circuit | Baseline High fps | High p99 ms | High CPU mean ms | Fixed Balanced fps | Fixed Balanced p99 ms | Max local shadows |
|---|---:|---:|---:|---:|---:|---:|
| orlando | 60.00 | 17.7 | 6.3 | 60.00 | 17.7 | 4 |
| bay_area | 60.00 | 17.7 | 6.3 | 60.00 | 17.7 | 4 |
| phoenix | 60.00 | 17.6 | 6.0 | 60.00 | 17.6 | 4 |
| nyc | 60.00 | 17.6 | 6.1 | 60.00 | 17.6 | 4 |
| st_louis | 60.00 | 17.7 | 6.1 | 60.00 | 17.7 | 4 |
| la | 60.00 | 17.6 | 6.5 | 60.00 | 17.7 | 4 |
| seattle | 60.00 | 17.7 | 6.4 | 60.00 | 17.6 | 4 |
| houston | 60.00 | 17.7 | 5.9 | 60.00 | 17.6 | 4 |
| boston | 60.00 | 17.7 | 7.1 | 60.00 | 17.7 | 4 |
| chicago | 60.00 | 17.6 | 7.2 | 60.00 | 17.7 | 4 |

## Measurement limits and reproduction

- Local macOS Chromium 156 in-app browser, initial CSS viewport 1280×720, device pixel ratio 2; each quality preset retains its own internal resolution scaling.
- Screenshot capture resized the last baseline Chicago Balanced sample after roughly six seconds. That sample is retained with a warning in the raw data and excluded from fixed-resolution comparisons. The post-fix run pinned the viewport and recorded 1280×720 in every sample, including the full-minute Chicago repeat. The other baseline samples did not record per-frame viewport history.
- Browser-reported JavaScript heap varied with garbage collection (roughly 72–136 MB in baseline snapshots), rather than rising monotonically. This is not GPU-memory measurement or proof of leak freedom.
- Rain stayed within 400 particles, splash pools within 32/12 slots, and combat pools remained bounded. Weather randomness is presentation-only; the storm timings are not deterministic.
- The manual diagnostic is `.local/reviews/soak/index.html` through Vite. Start all ten cities for the full baseline; `?regression=1` runs the shorter Balanced check. Keep the viewport fixed, avoid other rendering tabs/builds during collection, and save the visible Results JSON. Long frames are retained; only the five-second warm-up and paused/hidden time are excluded.
- Remaining release work: representative lower-end hardware, multi-hour endurance/GPU-memory checks, real AI/physics and human championship sessions, loading and audio listening checks. All-city fixed rain/night rendering is now checked; every weather/daylight transition combination is not.

Raw measurements: [baseline](remaster-weather-soak-baseline.json), [post-fix regression](remaster-weather-soak-regression.json).
