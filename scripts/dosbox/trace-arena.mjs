// Traces INT 21h memory calls (48h/49h/4Ah) between two code addresses and dumps MCB headers before each call.
// Usage: node scripts/dosbox/trace-arena.mjs <startOff hex> [--demo]   (traces until the function at startOff returns)
import {api} from './client.mjs';
const LOAD=0x01f5,start=parseInt(process.argv[2],16);
const post=(path,body)=>fetch('http://127.0.0.1:8386/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
const paused=await api.pause();let stop=paused.stop?.stop_id??0;await api.clearBreaks();
async function nextStop(){for(;;){const w=await api.wait(stop,15000);if(w.debugging&&w.stop_id>stop){stop=w.stop_id;return w;}}}
await api.addBreak({type:'execute',segment:LOAD,offset:start});await api.cont();
if(process.argv.includes('--demo'))await post('/input/type',{text:'C:\ndtrack demo\n'});
let w;for(;;){w=await nextStop();if(w.registers.cs===LOAD&&(w.registers.eip&0xffff)===start)break;await api.cont();}
const sp=w.registers.esp&0xffff,ss=w.registers.ss,st=await api.read(ss*16+sp,2),retIp=st[0]|st[1]<<8;
await api.clearBreaks();
for(const ah of [0x48,0x49,0x4a])await api.addBreak({type:'interrupt',int:0x21,ah});
await api.addBreak({type:'execute',segment:LOAD,offset:retIp});
const hdr=async s=>{const b=await api.read(s*16,16);return [...b].map(x=>x.toString(16).padStart(2,'0')).join(' ');};
const watch=[0x39b8,0x39cd,0x39d1,0x3b6d,0x3b86];
await api.cont();
for(;;){
 w=await nextStop();const r=w.registers;
 if(r.cs===LOAD&&(r.eip&0xffff)===retIp&&(r.esp&0xffff)>sp){console.log('--- return');for(const s of watch)console.log(' ',s.toString(16),await hdr(s));break;}
 if(w.reason==='breakpoint'&&w.breakpoint?.type==='interrupt'||r.cs!==LOAD){
  console.log(`INT21 ax=${(r.eax&0xffff).toString(16)} bx=${(r.ebx&0xffff).toString(16)} es=${r.es.toString(16)}`);
  for(const s of watch)console.log(' ',s.toString(16),await hdr(s));
 }
 await api.cont();
}
await api.clearBreaks();await api.cont();
