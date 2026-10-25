// Virtual CPU cost of work the original performs without waiting (owned by the main session).
// APPROX: the original runs unthrottled, so its speed is a property of the machine. The race frame cost
// reproduces the observed DOSBox reference rate (docs/re/identity.md: ~15.0 race frames per second).
import {state,PIT_HZ,IDLE} from '../engine/host.js';
import {work} from '../engine/ega.js';
import {ioWork} from '../engine/dos.js';
// APPROX work-cost model: the translated code runs in zero virtual time, so CPU-heavy work is charged by its
// dominant operations. Costs are least-squares fits to three DOSBox (default cycles) measurements of emulated
// time: title->sign-up 3014 ms, race setup 32b8->047c 542 ms, 047c->first frame 687 ms (predicted 3015/531/691).
// Measured with scripts/dosbox/measure-timing.mjs and measure-setup.mjs; see docs/re/environment.md.
// The menu poll quantum reproduces DOSBox's ~295 menu iterations per second on the sign-up screen.
export const pacing={raceFps:15.0,usPerVram:0.904,usPerDecoded:19.9,menuQuantum:261};
let lastVram=0,lastDecoded=0;
export function installWorkMeter(){
 lastVram=work.vram;lastDecoded=ioWork.decoded;state.quantum=pacing.menuQuantum;
 state.workMeter=()=>{
  const us=(work.vram-lastVram)*pacing.usPerVram+(ioWork.decoded-lastDecoded)*pacing.usPerDecoded;
  lastVram=work.vram;lastDecoded=ioWork.decoded;
  return Math.round(us*PIT_HZ/1e6);
 };
}
// One race-loop iteration: consume the remainder of the frame period, then yield to the host.
export function* frameCost(){
 const period=Math.round(PIT_HZ/pacing.raceFps);
 // Polls inside the frame already consumed part of the period; a long gap (menus) restarts the cadence.
 if(state.frameStart===undefined||state.clock-state.frameStart>4*period)state.frameStart=state.clock;
 const target=state.frameStart+period;
 while(state.clock<target)yield IDLE;
 state.frameStart=state.clock;
}
// Optional observation hook for tools (timing calibration, traces); never affects game state.
export const probes={fn:null};
export const probe=name=>{probes.fn?.(name);};
