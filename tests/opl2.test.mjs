import test from 'node:test';
import assert from 'node:assert/strict';
import {Opl2} from '../src/engine/opl2.js';

const F0=49716;
// channel c with silent modulator (AR=0 keeps it at max attenuation), additive connection, sustained carrier AR15/DR0/SL0/RR rr
function voice(o,c,{fnum=0x241,block=4,wave=0,rr=15,tl=0,am=0,vib=0,key=1,ar=15}={}){
 const m=[0,1,2,8,9,10,16,17,18][c],k=m+3;
 o.write(0x20+m,0x21);o.write(0x40+m,0);o.write(0x60+m,0);o.write(0x80+m,0x0f);
 o.write(0x20+k,0x21|am<<7|vib<<6);o.write(0x40+k,tl);o.write(0x60+k,ar<<4);o.write(0x80+k,0x0f&rr);
 o.write(0xe0+k,wave);o.write(0xc0+c,1);o.write(0xa0+c,fnum&255);o.write(0xb0+c,key<<5|block<<2|fnum>>8);
}
const render=(o,n)=>{const b=new Float32Array(n);o.generate(b,n);return b;};
const cross=b=>{let n=0;for(let i=1;i<b.length;i++)if(b[i-1]<0!==b[i]<0)n++;return n;};
const peak=b=>{let p=0;for(const v of b)p=Math.max(p,Math.abs(v));return p;};

test('pitch matches fnum*49716/2^(20-block)',()=>{
 for(const [fnum,block] of [[0x241,4],[0x144,3],[0x2ab,5]]){
  const o=new Opl2();o.write(1,0x20);voice(o,0,{fnum,block});
  const b=render(o,F0*2),f=cross(b)/4,e=fnum*F0/2**(20-block);
  assert.ok(Math.abs(f-e)/e<0.005,`${f} vs ${e}`);
 }
});
test('resampling keeps pitch',()=>{
 for(const sr of [44100,48000,22050]){
  const o=new Opl2(sr);voice(o,0);const b=render(o,sr*2),f=cross(b)/4,e=0x241*F0/2**16;
  assert.ok(Math.abs(f-e)/e<0.005,`${sr}: ${f} vs ${e}`);assert.ok(peak(b)<=1);
 }
});
test('AR=15 reaches full level at the first sample',()=>{
 const o=new Opl2();voice(o,0);o.generate(new Float32Array(1),1);assert.equal(o.envOf(1),0);
 const p=new Opl2();voice(p,0,{ar:10});p.generate(new Float32Array(1),1);assert.ok(p.envOf(1)>0);
});
test('key-off decays monotonically to silence',()=>{
 const o=new Opl2();voice(o,0,{rr:8});render(o,2000);
 assert.equal(o.envOf(1),0);o.write(0xb0,0x10|4<<2&0|0x00|(0x241>>8)&3|4<<2&0);
 o.write(0xb0,4<<2|0x241>>8);
 let prev=o.envOf(1);const g=new Float32Array(1);let moved=false;
 for(let i=0;i<400000;i++){o.generate(g,1);const e=o.envOf(1);assert.ok(e>=prev);if(e>prev)moved=true;prev=e;}
 assert.ok(moved);assert.equal(prev,511);assert.equal(peak(render(o,1000)),0);
});
test('release rate: higher RR decays faster',()=>{
 const t=rr=>{const o=new Opl2();voice(o,0,{rr});render(o,500);o.write(0xb0,4<<2|2);let n=0;const g=new Float32Array(1);while(o.envOf(1)<300&&n<2e6){o.generate(g,1);n++;}return n;};
 assert.ok(t(12)<t(8)&&t(8)<t(4));
});
test('total level ~0.75 dB per step',()=>{
 const pk=tl=>{const o=new Opl2();voice(o,0,{tl});return peak(render(o,4000));};
 const p0=pk(0);
 for(const tl of [4,8,16,32]){const db=20*Math.log10(p0/pk(tl)),e=0.75*tl;assert.ok(Math.abs(db-e)<0.35,`tl ${tl}: ${db} vs ${e}`);}
});
test('waveform shapes',()=>{
 // block 1, fnum 512 -> phase step 1024/sample -> exactly one 10-bit phase index per sample, period 1024
 const get=w=>{const o=new Opl2();o.write(1,0x20);voice(o,0,{fnum:512,block:1,wave:w});return render(o,2048);};
 const s=get(0);
 for(let i=1;i<512;i++)assert.ok(s[i]>0,`sine+ ${i}`);
 for(let i=513;i<1024;i++)assert.ok(s[i]<0,`sine- ${i}`);
 assert.ok(Math.abs(s[256]-(-s[768]))<1e-6&&Math.abs(s[256]-s[255+1])<1e-9);
 const h=get(1);
 for(let i=1;i<512;i++)assert.ok(h[i]>0);for(let i=512;i<1024;i++)assert.equal(h[i],0);
 assert.equal(h[1024+300],h[300]);
 const a=get(2);
 for(let i=0;i<2048;i++)assert.ok(a[i]>=0);assert.ok(Math.abs(a[100]-a[100+512])<1e-6);
 const q=get(3);
 for(let i=0;i<2048;i++){const p=i&1023;if(p>=256&&p<512||p>=768)assert.equal(q[i],0);else if(p&255)assert.ok(q[i]>0,`q ${i}`);}
 // waveform select disabled -> sine only
 const o=new Opl2();voice(o,0,{fnum:512,block:1,wave:1});const d=render(o,1024);assert.ok(d[700]<0);
});
test('tremolo and vibrato modulate the output',()=>{
 const base=(opt,bd)=>{const o=new Opl2();voice(o,0,opt);o.write(0xbd,bd);return render(o,26880);};
 const blocks=(b,n)=>{const r=[];for(let i=0;i+n<=b.length;i+=n)r.push(peak(b.subarray(i,i+n)));return r;};
 const plain=blocks(base({},0x00),600),am=blocks(base({am:1},0x00),600),am2=blocks(base({am:1},0x80),600);
 const sp=a=>Math.max(...a)/Math.min(...a);
 assert.ok(sp(plain)<1.02);
 assert.ok(sp(am)>1.05&&sp(am)<1.5,`am1dB ${sp(am)}`);
 assert.ok(sp(am2)>1.4&&sp(am2)<2.0,`am4.8dB ${sp(am2)}`);
 const cr=(b,n)=>{const r=[];for(let i=0;i+n<=b.length;i+=n)r.push(cross(b.subarray(i,i+n)));return r;};
 const hf={fnum:0x3ff,block:7},v0=cr(base(hf,0x00),4096),v1=cr(base({...hf,vib:1},0x00),4096),v2=cr(base({...hf,vib:1},0x40),4096);
 const spread=a=>(Math.max(...a)-Math.min(...a))/Math.min(...a);
 assert.ok(spread(v0)<0.002);assert.ok(spread(v1)>0.002);assert.ok(spread(v2)>spread(v1)*1.5,`${spread(v1)} ${spread(v2)}`);
});
test('feedback and FM change the spectrum',()=>{
 const mk=fb=>{const o=new Opl2();voice(o,0);o.write(0x60,0xf0);o.write(0x40,0);o.write(0xc0,1|fb<<1);return render(o,3000);};
 const a=mk(0),b=mk(7);let d=0;for(let i=0;i<3000;i++)d+=Math.abs(a[i]-b[i]);assert.ok(d>10);
 const fm=new Opl2();voice(fm,0);fm.write(0x60,0xf0);fm.write(0x40,0x10);fm.write(0xc0,0);
 const ad=new Opl2();voice(ad,0);ad.write(0x60,0xf0);ad.write(0x40,0x10);ad.write(0xc0,1);
 const x=render(fm,3000),y=render(ad,3000);let e=0;for(let i=0;i<3000;i++)e+=Math.abs(x[i]-y[i]);assert.ok(e>10);
});
test('rhythm mode: ch6-8 sound only from rhythm key bits',()=>{
 const setup=(rhy)=>{const o=new Opl2();o.write(0xbd,rhy?0x20:0);for(let c=6;c<9;c++)voice(o,c,{fnum:0x1a0,block:2,key:1});
  // modulators too (rhythm voices use both operators of ch7/8)
  for(const m of [0x10,0x11,0x12]){o.write(0x60+m,0xf0);o.write(0x40+m,0);}
  return o;};
 const off=setup(true);assert.equal(peak(render(off,4000)),0,'B6-B8 key-on ignored in rhythm mode');
 const nor=setup(false);assert.ok(peak(render(nor,4000))>0.01,'normal mode sounds');
 for(const bit of [1,2,4,8,16]){
  const o=setup(true);o.write(0xbd,0x20|bit);const b=render(o,4000);assert.ok(peak(b)>0.01,`bit ${bit}`);
  o.write(0xbd,0x20);const t=render(o,200000);assert.equal(peak(t.subarray(150000)),0,`release ${bit}`);
 }
 // BD affects only ch6, HH/SD only ch7, TOM/TC only ch8: distinct outputs
 const out=bit=>{const o=setup(true);o.write(0xbd,0x20|bit);return render(o,2000);};
 const bd=out(16),hh=out(1),sd=out(8);assert.notDeepEqual(Array.from(hh),Array.from(sd));assert.notDeepEqual(Array.from(bd),Array.from(hh));
});
test('deterministic',()=>{
 const run=()=>{const o=new Opl2(48000);o.write(1,0x20);voice(o,0,{am:1,vib:1,wave:2});voice(o,3,{});voice(o,7,{});o.write(0xbd,0xe0|0x1f);return render(o,20000);};
 assert.deepEqual(Array.from(run()),Array.from(run()));
 const o=new Opl2();voice(o,0);const a=render(o,500);o.reset();voice(o,0);assert.deepEqual(Array.from(a),Array.from(render(o,500)));
});
test('KSL attenuates high notes and register decode of operator map',()=>{
 const pk=ksl=>{const o=new Opl2();voice(o,0,{fnum:0x2ff,block:7});o.write(0x43,ksl<<6);return peak(render(o,4000));};
 const p0=pk(0),p1=pk(1),p2=pk(2),p3=pk(3);
 assert.ok(p0>p2&&p2>p1&&p1>p3,`${p0} ${p2} ${p1} ${p3}`);
 const o=new Opl2();voice(o,5);assert.ok(peak(render(o,2000))>0.01); // channel 5 at operator offsets 0x0a/0x0d
});
