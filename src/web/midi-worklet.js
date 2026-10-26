// AudioWorklet fallback for the MT-32 option: a small built-in General-MIDI-style synth fed with time-stamped MIDI messages.
// APPROX: the game's patches are MT-32 timbres (set by SysEx, ignored here); program numbers only pick a rough instrument family.
// Channel 10 is the MT-32 rhythm part and is played as noise/sine drums.
const FAM=[ // per program>>3: wave (0 sine,1 tri,2 saw,3 pulse), attack, decay, sustain, release (s), brightness 0..1
 [1,.003,.9,.15,.25,.55],[1,.002,.5,.0,.12,.7],[3,.01,.2,.7,.15,.5],[3,.005,.6,.3,.2,.6],
 [1,.005,.3,.6,.15,.4],[2,.08,.3,.8,.35,.5],[2,.06,.2,.8,.3,.45],[2,.05,.2,.8,.25,.6],
 [3,.004,.15,.6,.12,.7],[3,.01,.15,.7,.15,.6],[2,.01,.1,.8,.1,.9],[2,.008,.1,.8,.1,.8],
 [2,.15,.5,.7,.5,.4],[0,.02,.3,.6,.3,.9],[2,.01,.5,.2,.2,.8],[1,.003,.4,.0,.2,.7]];
class Voice{constructor(ch,n,v,f){this.ch=ch;this.n=n;this.v=v/127;this.f=f;this.ph=0;this.lp=0;this.t=0;this.lvl=0;this.rel=false;this.hold=false;this.on=true;}}
class Synth extends AudioWorkletProcessor{
 constructor(){
  super();this.q=[];this.vs=[];this.seed=1;
  this.c=Array.from({length:16},()=>({pg:0,vol:100,ex:127,pan:64,bend:0,sus:false,rpn:0,range:2}));
  this.port.onmessage=e=>{for(const m of e.data)this.q.push(m);};
 }
 rnd(){this.seed=(this.seed*1664525+1013904223)>>>0;return this.seed/2147483648-1;}
 msg(b){
  const s=b[0],ch=s&15,c=this.c[ch];
  switch(s&0xf0){
   case 0x90:if(b[2]){this.noteOn(ch,b[1],b[2]);break;}
   case 0x80:this.noteOff(ch,b[1]);break;
   case 0xb0:{
    const d=b[2];
    if(b[1]===7)c.vol=d;else if(b[1]===11)c.ex=d;else if(b[1]===10)c.pan=d;
    else if(b[1]===64){c.sus=d>=64;if(!c.sus)for(const v of this.vs)if(v.ch===ch&&v.hold){v.hold=false;v.rel=true;}}
    else if(b[1]===120||b[1]===123)for(const v of this.vs)if(v.ch===ch)b[1]===120?v.on=false:this.noteOff(ch,v.n,true);
    else if(b[1]===121){c.vol=100;c.ex=127;c.pan=64;c.bend=0;c.sus=false;}
    break;}
   case 0xc0:c.pg=b[1];break;
   case 0xe0:c.bend=((b[2]<<7|b[1])-8192)/8192;break;
  }
 }
 noteOn(ch,n,v){
  for(const o of this.vs)if(o.ch===ch&&o.n===n&&!o.rel)o.rel=true; // retrigger
  if(this.vs.length>=40){const k=this.vs.findIndex(o=>o.rel)>=0?this.vs.findIndex(o=>o.rel):0;this.vs.splice(k,1);}
  this.vs.push(new Voice(ch,n,v,ch===9?this.drum(n):FAM[this.c[ch].pg>>3]));
 }
 noteOff(ch,n,force){
  for(const v of this.vs)if(v.ch===ch&&v.n===n&&!v.rel&&!v.hold){if(this.c[ch].sus&&!force)v.hold=true;else v.rel=true;}
 }
 drum(n){ // [kind: 0 sine kick/tom, 1 noise, base freq, decay s, tone mix]
  if(n<=36)return {d:1,k:0,fr:55,dc:.22,mix:0};
  if(n===38||n===40||n===37)return {d:1,k:1,fr:190,dc:.16,mix:.35};
  if(n===42||n===44)return {d:1,k:1,fr:0,dc:.05,mix:0};
  if(n===46)return {d:1,k:1,fr:0,dc:.3,mix:0};
  if(n>=41&&n<=50&&n!==46&&n!==49)return {d:1,k:0,fr:80+(n-41)*18,dc:.25,mix:0};
  return {d:1,k:1,fr:0,dc:.8,mix:0};
 }
 sample(v,dt){
  const f=v.f;let x;
  if(f.d){ // drum
   const e=Math.exp(-v.t/f.dc*5);if(e<.002){v.on=false;return 0;}
   const nz=this.rnd(),tn=f.fr?Math.sin(v.ph)*e*(1+(f.k?0:1)):0;
   if(f.fr)v.ph+=6.2832*f.fr*(f.k?1:1+e)*dt;
   const hp=nz-v.lp;v.lp+=(nz-v.lp)*.2;
   x=(f.k?(f.mix?nz*.5+tn*f.mix:hp):0)*e+(f.k?0:tn);
   return x*v.v;
  }
  const [w,a,d,s,r,br]=f;
  if(v.rel){v.lvl-=v.lvl*dt/Math.max(r/5,1e-3);if(v.lvl<.001){v.on=false;return 0;}}
  else if(v.t<a)v.lvl=v.t/a;
  else v.lvl=s+(1-s)*Math.exp(-(v.t-a)/d*4);
  const fq=v.fq;v.ph+=fq*dt;if(v.ph>=1)v.ph-=1;const p=v.ph;
  x=w===0?Math.sin(6.2832*p):w===1?4*Math.abs(p-.5)-1:w===2?2*p-1:(p<.35?1:-1);
  v.lp+=(x-v.lp)*(.08+.9*br*br);
  return v.lp*v.lvl*v.v*.5;
 }
 process(_in,outputs){
  const L=outputs[0][0],R=outputs[0][1]||L,dt=1/sampleRate;
  for(let i=0;i<L.length;i++){
   const t=currentFrame+i;
   while(this.q.length&&this.q[0].frame<=t)this.msg(this.q.shift().bytes);
   let l=0,r=0;
   for(const v of this.vs){
    const c=this.c[v.ch];
    v.fq=440*Math.pow(2,(v.n-69+c.bend*c.range)/12);
    const g=c.vol/127*(c.ex/127),y=this.sample(v,dt)*g;
    const pn=(c.pan-64)/64;l+=y*Math.min(1,1-pn);r+=y*Math.min(1,1+pn);
    v.t+=dt;
   }
   L[i]=Math.tanh(l*.5);R[i]=Math.tanh(r*.5);
  }
  this.vs=this.vs.filter(v=>v.on);
  return true;
 }
}
registerProcessor('midi-synth',Synth);
