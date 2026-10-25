// AudioWorklet that renders the AdLib (OPL2) from time-stamped register writes (frames computed by the host).
// APPROX: synthesis by src/engine/opl2.js, which is not bit-exact against the chip.
import {Opl2} from '../engine/opl2.js';
class Opl extends AudioWorkletProcessor{
 constructor(){super();this.o=new Opl2(sampleRate);this.q=[];this.port.onmessage=e=>{if(e.data.reset)this.o.reset();for(const ev of e.data.events||[])this.q.push(ev);};}
 process(_in,outputs){
  const out=outputs[0][0];let i=0;
  while(i<out.length){
   const t=currentFrame+i;
   while(this.q.length&&this.q[0].frame<=t){const e=this.q.shift();this.o.write(e.reg,e.v);}
   let n=out.length-i;if(this.q.length)n=Math.max(1,Math.min(n,this.q[0].frame-t));
   this.o.generate(out.subarray(i,i+n),n);i+=n;
  }
  return true;
 }
}
registerProcessor('opl2',Opl);
