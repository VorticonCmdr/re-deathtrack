// Captures a function-level segment: a checkpoint at the entry of a near or far function and one at its return.
// Usage: node scripts/dosbox/capture-segment.mjs <name> <entryOff hex> <near|far> [--demo] [--args "GC"] [--skip n] [--cga]
// --cga appends the 16 KiB CGA RAM at B800:0000 to each checkpoint; --args passes the command tail (the type-in is `dtrack <args>`).
// Entry segment is the game's code segment 01f5 for segment-1000 functions. Output: .local/captures/seg-<name>/.
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {api,readPlanes,readVgaRegs} from './client.mjs';
const [name,offS,kind='near']=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const skipI=process.argv.indexOf('--skip'),skip=skipI>0?+process.argv[skipI+1]:0;
const LOAD=0x01f5,entry=parseInt(offS,16),out=`.local/captures/seg-${name}`;
await mkdir(out,{recursive:true});
const post=(path,body)=>fetch('http://127.0.0.1:8386/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
const paused=await api.pause();let stop=paused.stop?.stop_id??0;await api.clearBreaks();
async function nextStop(){for(;;){const w=await api.wait(stop,15000);if(w.debugging&&w.stop_id>stop){stop=w.stop_id;return w;}}}
async function dump(file){
 const cpu=await api.cpu(),mem=await api.read(0,0xa0000),regs=await readVgaRegs(),vga=await readPlanes();
 const cga=process.argv.includes('--cga');
 const blob=new Uint8Array(0xa0000+0x40000+(cga?0x4000:0));blob.set(mem);vga.planes.forEach((p,k)=>blob.set(p,0xa0000+k*0x10000));
 if(cga)blob.set(await api.read(0xb8000,0x4000),0xa0000+0x40000);
 await writeFile(`${out}/${file}`,gzipSync(blob,{level:6}));
 return {file,sha256:createHash('sha256').update(blob).digest('hex'),cpu:cpu.registers??cpu,vga:regs};
}
await api.addBreak({type:'execute',segment:LOAD,offset:entry});await api.cont();
const ai=process.argv.indexOf('--args'),tail=ai>0?process.argv[ai+1]:process.argv.includes('--demo')?'demo':'';
if(tail||process.argv.includes('--demo'))await post('/input/type',{text:`C:\ndtrack ${tail}\n`});
let w;for(let n=0;;){w=await nextStop();const r=w.registers;if(r.cs===LOAD&&(r.eip&0xffff)===entry){if(n++>=skip)break;}await api.cont();}
const r=w.registers,ss=r.ss,sp=r.esp&0xffff;
const st=await api.read(ss*16+sp,8);const retIp=st[0]|st[1]<<8,retCs=kind==='far'?st[2]|st[3]<<8:r.cs;
const args=[...Array(8)].map((_,i)=>0);const argBytes=await api.read(ss*16+sp+(kind==='far'?4:2),32);
const words=[...Array(16)].map((_,i)=>argBytes[2*i]|argBytes[2*i+1]<<8);
const enter=await dump('entry.bin.gz');
await api.clearBreaks();await api.addBreak({type:'execute',segment:retCs,offset:retIp});await api.cont();
// The return is the first stop at the return address with SP back above the entry frame.
for(;;){w=await nextStop();const q=w.registers;if(q.cs===retCs&&(q.eip&0xffff)===retIp&&(q.esp&0xffff)>sp)break;await api.cont();}
const exit=await dump('exit.bin.gz');
await api.clearBreaks();await api.cont();
await writeFile(`${out}/manifest.json`,JSON.stringify({name,entry:`${LOAD.toString(16)}:${entry.toString(16)}`,kind,ret:`${retCs.toString(16)}:${retIp.toString(16)}`,stackWords:words,checkpoints:[enter,exit]},null,1));
console.log(`captured ${name}: entry SP ${sp.toString(16)}, return ${retCs.toString(16)}:${retIp.toString(16)}, args ${words.slice(0,6).map(x=>x.toString(16)).join(' ')}`);
