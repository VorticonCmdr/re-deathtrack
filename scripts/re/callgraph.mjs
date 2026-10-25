// Builds a call graph from the Ghidra disassembly export (.local/re/export/disasm.asm).
import {readFile,writeFile} from 'node:fs/promises';
const dir=new URL('../../.local/re/export/',import.meta.url);
const asm=await readFile(new URL('disasm.asm',dir),'utf8');
const fns=new Map();let cur=null;
// Ghidra prints targets as normalised seg:off (e.g. 0x2000:2094); convert to linear for matching.
const lin=s=>{const [a,b]=s.split(':').map(x=>parseInt(x,16));return a*16+b;};
for(const line of asm.split('\n')){
 let m=line.match(/^;==== (\S+) (\S+)/);if(m){cur={addr:m[1],name:m[2],lin:lin(m[1]),calls:new Set(),indirect:0,insns:0};fns.set(m[1],cur);continue;}
 if(!cur||!line)continue;cur.insns++;
 m=line.match(/\s(CALLF?|JMPF?)\s+(0x)?([0-9a-f]{4}):([0-9a-f]{4})\s*$/);
 if(m){const t=parseInt(m[3],16)*16+parseInt(m[4],16);if(m[1].startsWith('CALL')||m[1]==='JMPF')cur.calls.add(t);}
 else if(/\sCALLF?\s+(word|dword)? ?ptr|\sCALLF?\s+\[|\sCALLF?\s+[A-Z]{2}\s*$/.test(line))cur.indirect++;
}
const byLin=new Map([...fns.values()].map(f=>[f.lin,f]));
const out={};for(const f of fns.values())out[f.addr]={name:f.name,insns:f.insns,indirect:f.indirect,calls:[...f.calls].map(t=>byLin.get(t)?.addr||('?'+t.toString(16)))};
await writeFile(new URL('callgraph.json',dir),JSON.stringify(out));
const roots=process.argv.slice(2);if(roots.length){
 const seen=new Set(),q=[...roots];while(q.length){const a=q.pop();if(seen.has(a)||!out[a])continue;seen.add(a);q.push(...out[a].calls.filter(c=>!c.startsWith('?')));}
 const segs={};for(const a of seen){const s=a.slice(0,4);segs[s]=(segs[s]||0)+out[a].insns;}
 console.log('reachable',seen.size,segs);
}
