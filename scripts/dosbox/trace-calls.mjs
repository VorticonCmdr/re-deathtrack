// Logs register/memory samples at execute breakpoints of the running game (live segment 01f5 = Ghidra 1000).
// Usage: node scripts/dosbox/trace-calls.mjs <offset-hex[,offset-hex...]> <hits> [--arm main] [--poke off:byte,...] [--mem off:len,...] [--out file.json]
//   --poke writes DGROUP bytes right after main is reached (e.g. 2d2a:3 selects the AdLib driver, the word the original never writes).
//   Waits for main (1000:0010) when --arm main is given (so the EXEPACK stub is done), then breaks at <offset> and records
//   AX/BX/CX/DX/SI/DI and the named DGROUP ranges at every stop (DGROUP live segment 28ef).
import {writeFile} from 'node:fs/promises';
import {api} from './client.mjs';
const args=process.argv.slice(2);
const flag=n=>{const i=args.indexOf('--'+n);return i<0?null:args[i+1];};
const [offS,hitsS]=args.filter((a,i)=>!a.startsWith('--')&&!(i>0&&args[i-1].startsWith('--')));
const offs=offS.split(',').map(x=>parseInt(x,16)),hits=+hitsS,LOAD=0x01f5,DS=0x28ef;
const mems=(flag('mem')||'').split(',').filter(Boolean).map(s=>{const [o,l]=s.split(':');return {off:parseInt(o,16),len:+l};});
const paused=await api.pause();await api.clearBreaks();
let stop=paused.stop?.stop_id??(await api.debugStatus()).stop?.stop_id??0;
async function next(budget=60000){
 const until=Date.now()+budget;
 for(;;){const w=await api.wait(stop,15000);if(w.debugging&&w.stop_id>stop){stop=w.stop_id;return w;}if(Date.now()>until)throw Error('timeout');}
}
if(flag('arm')==='main'){await api.addBreak({type:'execute',segment:LOAD,offset:0x10});await api.cont();await next(240000);await api.clearBreaks();
 for(const p of (flag('poke')||'').split(',').filter(Boolean)){const [o,v]=p.split(':');await api.batch([{op:'mem_write',offset:DS*16+parseInt(o,16),data:Buffer.from([+v]).toString('base64')}]);}}
for(const o of offs)await api.addBreak({type:'execute',segment:LOAD,offset:o});await api.cont();
const rec=[];
for(let i=0;i<hits;i++){
 const w=await next(120000),r=w.registers||{};
 const e={n:i,ax:r.eax&0xffff,bx:r.ebx&0xffff,cx:r.ecx&0xffff,dx:r.edx&0xffff,si:r.esi&0xffff,di:r.edi&0xffff,cs:r.cs,ip:r.eip&0xffff,fl:r.flags};
 for(const m of mems)e['m'+m.off.toString(16)]=Buffer.from(await api.read(DS*16+m.off,m.len)).toString('hex');
 rec.push(e);await api.cont();
}
await api.pause();await api.clearBreaks();await api.cont();
if(flag('out'))await writeFile(flag('out'),JSON.stringify(rec));
console.log(rec.map(e=>e.ax&0xff).map(b=>b.toString(16).padStart(2,'0')).join(' '));
