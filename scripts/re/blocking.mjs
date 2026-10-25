// Computes the set of functions that must be generators: seeds (poll points, waits, paced loops) and
// every direct caller of them. Indirect calls are listed for manual review.
import {readFile,writeFile} from 'node:fs/promises';
const g=JSON.parse(await readFile(new URL('../../.local/re/export/callgraph.json',import.meta.url)));
const seeds={
 '1ff8:4457':'kbdGetKey poll','1ff8:44a0':'kbdIsHeld poll','1ff8:4486':'kbdStickDir poll','1ff8:4025':'mouseGetPos poll','1ff8:4068':'mouseButton poll',
 '1ff8:3ee5':'joyRead poll','1ff8:3f62':'joyDir poll','1ff8:3fc2':'joyButton poll','1000:a39c':'timerGet poll',
 '1000:a3a0':'timerWait','1000:aeaa':'waitVRetrace','1000:047c':'race loop (frame pacing)',
};
const callers={};for(const [a,f] of Object.entries(g))for(const c of f.calls)(callers[c]??=new Set()).add(a);
const why=new Map(Object.entries(seeds)),q=Object.keys(seeds);
while(q.length){const a=q.shift();for(const c of callers[a]||[])if(!why.has(c)){why.set(c,`calls ${a}`);q.push(c);}}
const out=[...why.entries()].sort().map(([a,w])=>({addr:a,why:w,indirect:g[a]?.indirect||0}));
await writeFile(new URL('../../src/game/blocking.json',import.meta.url),JSON.stringify(Object.fromEntries(out.map(o=>[o.addr,o.why])),null,0).replace(/","/g,'",\n"')+'\n');
console.log(out.length,'generator functions;',out.filter(o=>o.indirect).length,'with indirect calls:',out.filter(o=>o.indirect).map(o=>o.addr).join(' '));
