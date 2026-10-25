// Emulated time between race-setup milestones in demo mode, from the game's PIT counter CS:c328.
import {api} from './client.mjs';
const CS=0x1f5*16;
const ms=t=>t/0x1c2*1000/145.652;
const post=(path,body)=>fetch('http://127.0.0.1:8386/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
const marks=[0x32b8,0x047c,0x04ed];
const paused=await api.pause();let stop=paused.stop?.stop_id??0;await api.clearBreaks();
for(const m of marks)await api.addBreak({type:'execute',segment:0x1f5,offset:m});
await api.cont();
await post('/input/type',{text:'C:\ndtrack demo\n'});
const seen=[];
while(seen.length<3){
 let w;for(;;){w=await api.wait(stop,15000);if(w.debugging&&w.stop_id>stop){stop=w.stop_id;break;}}
 const ip=w.registers.eip&0xffff;const c=await api.read(CS+0xc328,4);const t=(c[0]|c[1]<<8|c[2]<<16|c[3]<<24)>>>0;
 if(marks.includes(ip)&&!seen.find(s=>s.ip===ip)&&(seen.length?ip===marks[seen.length]:ip===marks[0]))seen.push({ip,t});
 await api.cont();
}
await api.pause();await api.clearBreaks();await api.cont();
console.log(`32b8->047c ${ms(seen[1].t-seen[0].t).toFixed(0)} ms, 047c->first frame ${ms(seen[2].t-seen[1].t).toFixed(0)} ms`);
