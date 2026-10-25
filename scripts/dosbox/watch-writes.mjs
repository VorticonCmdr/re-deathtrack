// Logs which code changes a memory word, using DOSBox write watchpoints (value-change polling).
// Usage: node scripts/dosbox/watch-writes.mjs <seg> <off> <hits> [--race]  (seg/off hex)
import {api} from './client.mjs';
const [segS,offS,hitsS='200']=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const seg=parseInt(segS,16),off=parseInt(offS,16);
const paused=await api.pause();await api.clearBreaks();
let stop=paused.stop?.stop_id??0;
if(process.argv.includes('--race')){
 await api.addBreak({type:'execute',segment:0x1f5,offset:0x04ed});await api.cont();
 for(;;){const w=await api.wait(stop,15000);if(w.debugging&&w.stop_id>stop){stop=w.stop_id;break;}}
 await api.clearBreaks();
}
await api.addBreak({type:'memory',segment:seg,offset:off,trigger:'write'});
await api.addBreak({type:'memory',segment:seg,offset:off+1,trigger:'write'});
await api.cont();
const counts=new Map();
for(let i=0;i<+hitsS;i++){
 let w;for(;;){w=await api.wait(stop,15000);if(w.debugging&&w.stop_id>stop){stop=w.stop_id;break;}}
 const r=w.registers;const at=`${r.cs.toString(16)}:${(r.eip&0xffff).toString(16)}`;
 const v=await api.read(seg*16+off,2);const val=v[0]|v[1]<<8;
 const k=at;const e=counts.get(k)||{n:0,vals:new Set()};e.n++;if(e.vals.size<6)e.vals.add(val.toString(16));counts.set(k,e);
 await api.cont();
}
await api.pause();await api.clearBreaks();await api.cont();
for(const [k,e] of [...counts].sort((a,b)=>b[1].n-a[1].n))console.log(k,e.n,[...e.vals].join(','));
