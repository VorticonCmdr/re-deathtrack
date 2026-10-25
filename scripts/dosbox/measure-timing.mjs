// Measures emulated-time costs in DOSBox: title->sign-up transition after a key press, and menu iteration rate.
// Emulated time comes from the game's own PIT counter CS:c328 (+0x1c2 per 145.65 Hz tick, ~6.9 ms resolution).
import {api} from './client.mjs';
const CS=0x1f5*16, DS=0x28ef0;
const u16=(b,o)=>b[o]|b[o+1]<<8;
async function snap(){const c=await api.read(CS+0xc328,4),p=await api.read(DS+0x9018,2),r=await api.read(DS+0x2154,2);return {t:(c[0]|c[1]<<8|c[2]<<16|c[3]<<24)>>>0,page:u16(p,0),rng:u16(r,0)};}
const ms=t=>t/0x1c2*1000/145.652;
const post=(path,body)=>fetch('http://127.0.0.1:8386/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
await post('/input/type',{text:'C:\ndtrack\n'});
// Wait for the title sequence (timer installed, page 0).
let s;for(;;){s=await snap();if(s.t>0x1c2*145*6)break;await new Promise(r=>setTimeout(r,200));}
console.log('title running, t=',ms(s.t).toFixed(0),'ms');
await post('/input/sequence',{events:[{key:'KBD_enter',pressed:true},{key:'KBD_enter',pressed:false,delay_ms:80}]});
const t0=(await snap()).t;let sawPage=null,firstRng=null,last=null;const rngs=[];
for(let i=0;i<4000;i++){
 s=await snap();
 if(sawPage===null&&s.page===0x15)sawPage=s.t;
 if(sawPage!==null&&last&&s.rng!==last.rng){if(firstRng===null)firstRng=s.t;rngs.push(s.t);}
 last=s;if(rngs.length>200)break;
}
console.log('page 0x15 after',ms(sawPage-t0).toFixed(0),'ms; first menu rand after',ms(firstRng-t0).toFixed(0),'ms; final page',s.page);
const span=rngs.at(-1)-rngs[0];console.log('menu rand index changes observed',rngs.length,'over',ms(span).toFixed(0),'ms (polling-limited lower bound on rate)');
