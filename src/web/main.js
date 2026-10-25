// Browser host: asset loading, presentation of the EGA display page, input adapters and wall-clock pacing.
import './game.css';
import {createMachine,SetupError} from '../engine/machine.js';
import {runUntil,state,PIT_HZ,queueEvent,UnsupportedError} from '../engine/host.js';
import {pageIndices,regs,rgb200} from '../engine/ega.js';
import {SCANCODES} from './scancodes.js';
import {startGame} from '../game/boot.js';
import {browserStorage} from './storage.js';
import {createAudio} from './audio.js';
import {createMidi} from './midi.js';
import {hw,opl,mpu} from '../game/devices.js';
import {rw,rb} from '../engine/mem.js';

const $=s=>document.querySelector(s);
$('#app').innerHTML=`<main class="shell"><canvas id="screen" width="320" height="200" aria-label="Deathtrack"></canvas>
<p id="status" role="status">Loading game files…</p>
<label id="pick" class="hidden">Open Deathtrack folder<input id="folder" type="file" webkitdirectory multiple></label></main>`;
const canvas=$('#screen'),ctx=canvas.getContext('2d'),image=ctx.createImageData(320,200),status=$('#status');
const params=new URLSearchParams(location.search);

async function devAssets(){
 const r=await fetch('./__assets');if(!r.ok)return null;
 const list=await r.json(),m=new Map();
 await Promise.all(list.map(async f=>{const b=await fetch('./__asset/'+encodeURIComponent(f.name));if(b.ok)m.set(f.name.toUpperCase(),new Uint8Array(await b.arrayBuffer()));}));
 return m;
}
async function folderAssets(files){const m=new Map();for(const f of files)if(!f.name.startsWith('.'))m.set(f.name.toUpperCase(),new Uint8Array(await f.arrayBuffer()));return m;}

// vNow: virtual time corresponding to the wall clock. The game never runs ahead of it, so work charged by the
// cost model (src/game/pacing.js) takes real time, as on the original machine.
let gen=null,last=0,halted=false,vNow=0;
const audio=createAudio(),midi=createMidi(t=>{notice=t;status.textContent=t;});let notice='';
// Browsers start audio only after a user gesture.
for(const ev of ['keydown','mousedown'])addEventListener(ev,()=>{if(hw.sound==='mt32')midi.start();audio.start().catch(e=>console.warn('Audio unavailable',e));},{once:false,passive:true});
const pixels=new Uint8Array(320*200);
function present(){
 pageIndices(regs.start,pixels);
 const pal=regs.palette.map(rgb200),d=image.data;
 for(let i=0;i<pixels.length;i++){const c=pal[pixels[i]];d[i*4]=c>>16;d[i*4+1]=c>>8&255;d[i*4+2]=c&255;d[i*4+3]=255;}
 ctx.putImageData(image,0,0);
}
function halt(e){
 halted=true;
 status.textContent=e instanceof UnsupportedError?`Stopped: ${e.message}`:`Stopped by an error: ${e.message}`;
 status.className='error';console.error(e);
}
function frame(now){
 if(halted)return;
 // Advance virtual time by real elapsed time, capped so a background tab does not run minutes at once.
 const dt=Math.min(now-last,100);last=now;vNow+=dt/1000*PIT_HZ;
 try{if(state.clock<vNow){const r=runUntil(gen,vNow);if(r.done){status.textContent='The game has exited.';halted=true;}}}
 catch(e){halt(e);}
 present();audio.pump(state.clock);midi.pump(state.clock);
 if(state.diagnostics.length)status.textContent=`Demo mode recovery: ${state.diagnostics.at(-1).what}`;
 requestAnimationFrame(frame);
}
function start(assets){
 try{
  const strict=params.get('mode')!=='demo';
  const args=params.get('args')?params.get('args').split(' '):[];
  createMachine({assets,storage:browserStorage(),strict,args});
  const sound=params.get('sound')||'speaker';
  gen=startGame({sound});
  status.textContent=strict?'':'Best-effort mode: unsupported paths are reported, not fatal.';
  if(sound==='mt32')status.textContent='MT-32 selected: click the page to connect a MIDI output.';
  $('#pick').classList.add('hidden');
  last=performance.now();vNow=state.clock;requestAnimationFrame(frame);
 }catch(e){status.textContent=e instanceof SetupError?e.message:`Cannot start: ${e.message}`;status.className='error';$('#pick').classList.remove('hidden');console.error(e);}
}

// Input events are stamped with the virtual time at which they physically happened (wall-mapped), never earlier
// than the machine's clock; the host delivers them at the next PIT tick at or after that time.
const stamp=()=>Math.max(state.clock,vNow+(performance.now()-last)/1000*PIT_HZ);
addEventListener('keydown',e=>{const c=SCANCODES[e.code];if(c===undefined||!gen)return;e.preventDefault();queueEvent({t:stamp(),type:'key',code:c,down:true});});
addEventListener('keyup',e=>{const c=SCANCODES[e.code];if(c===undefined||!gen)return;e.preventDefault();queueEvent({t:stamp(),type:'key',code:c,down:false});});
const mousePos=e=>{const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(319,Math.floor((e.clientX-r.left)/r.width*320))),y:Math.max(0,Math.min(199,Math.floor((e.clientY-r.top)/r.height*200)))};};
canvas.addEventListener('mousemove',e=>{if(gen)queueEvent({t:stamp(),type:'mouse',...mousePos(e),buttons:e.buttons&3});});
canvas.addEventListener('mousedown',e=>{if(gen){e.preventDefault();queueEvent({t:stamp(),type:'mouse',...mousePos(e),buttons:e.buttons&3});}});
canvas.addEventListener('mouseup',e=>{if(gen)queueEvent({t:stamp(),type:'mouse',...mousePos(e),buttons:e.buttons&3});});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
// Read-only probe for automated browser acceptance tests (tests/browser/acceptance.mjs).
window.__deathtrack={rw,rb,sound:()=>({device:hw.sound,oplWrites:opl.count,midiBytes:mpu.count}),audioRunning:()=>audio.running,audioLevel:()=>audio.level(),clock:()=>state.clock,diagnostics:()=>state.diagnostics.slice(),halted:()=>halted,status:()=>status.textContent};
$('#folder').onchange=async e=>start(await folderAssets([...e.target.files]));

const dev=await devAssets().catch(()=>null);
if(dev&&dev.size)start(dev);else{status.textContent='Select your Deathtrack game folder. Files stay in this browser.';$('#pick').classList.remove('hidden');}
