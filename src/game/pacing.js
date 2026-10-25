// Virtual CPU cost of work the original performs without waiting (owned by the main session).
// APPROX: the original runs unthrottled, so its speed is a property of the machine. The race frame cost
// reproduces the observed DOSBox reference rate (docs/re/identity.md: ~15.0 race frames per second).
import {state,PIT_HZ,IDLE} from '../engine/host.js';
export const pacing={raceFps:15.0};
// One race-loop iteration: consume the remainder of the frame period, then yield to the host.
export function* frameCost(){
 const period=Math.round(PIT_HZ/pacing.raceFps);
 // Polls inside the frame already consumed part of the period; a long gap (menus) restarts the cadence.
 if(state.frameStart===undefined||state.clock-state.frameStart>4*period)state.frameStart=state.clock;
 const target=state.frameStart+period;
 while(state.clock<target)yield IDLE;
 state.frameStart=state.clock;
}
