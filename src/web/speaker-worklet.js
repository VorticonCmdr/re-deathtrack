// AudioWorklet that renders the PC speaker from time-stamped state changes (sample times computed by the host).
// Square wave at 1193182/divisor Hz while both gate bits are set; inaudible rates (> 15 kHz) render as silence,
// approximating the speaker cone's response (APPROX). A one-pole low-pass softens the edges.
class Speaker extends AudioWorkletProcessor{
 constructor(){super();this.q=[];this.freq=0;this.on=false;this.phase=0;this.lp=0;this.port.onmessage=e=>{for(const ev of e.data)this.q.push(ev);};}
 process(_in,outputs){
  const out=outputs[0][0],sr=sampleRate;
  for(let i=0;i<out.length;i++){
   const t=currentFrame+i;
   while(this.q.length&&this.q[0].frame<=t){const e=this.q.shift();this.freq=1193182/e.divisor;this.on=(e.gate&3)===3&&this.freq<15000;}
   let v=0;
   if(this.on){this.phase+=this.freq/sr;if(this.phase>=1)this.phase-=Math.floor(this.phase);v=this.phase<0.5?0.25:-0.25;}
   this.lp+=0.35*(v-this.lp);out[i]=this.lp;
  }
  return true;
 }
}
registerProcessor('pc-speaker',Speaker);
