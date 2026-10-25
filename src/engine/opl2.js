// Yamaha YM3812 (OPL2 / AdLib) synthesizer core, written from the documented chip behaviour. Pure JS, no I/O, no allocation in generate().
// Tables (derived, not copied): LS[i]=round(-log2(sin((i+0.5)*pi/512))*256) for i=0..255 (quarter-wave log-sine, 1/256 octave units);
// EXP[i]=round((2^((255-i)/256)-1)*1024) for i=0..255; a linear value is (EXP[a&255]+1024)>>(a>>8) for an attenuation a in 1/256 octave.
// Envelope units are 0.1875 dB = 8 log units. Operator output is signed, up to about +-2040 (11 bit); phase modulation adds it 1:1 to the 10-bit
// phase (full scale = +-2 cycles = 4*pi, the documented maximum). APPROX notes: envelope step timing/increment patterns, attack curve,
// noise LFSR (23-bit, taps 0/14), rhythm phase tricks, DAC scaling (sum/16384, clipped) and linear resampling are modelled, not bit exact.
// Resampling: native rate is 49716 Hz; any other sampleRate is produced by linear interpolation of consecutive native samples.
const LS=new Int32Array(256),EXP=new Int32Array(256);
for(let i=0;i<256;i++){LS[i]=Math.round(-Math.log2(Math.sin((i+0.5)*Math.PI/512))*256);EXP[i]=Math.round((Math.pow(2,(255-i)/256)-1)*1024);}
const M2=[1,2,4,6,8,10,12,14,16,18,20,20,24,24,30,30]; // MULT*2 (0 = x0.5)
const KSLROM=[0,32,40,45,48,51,53,55,56,58,59,60,61,62,63,64]; // attenuation in 0.75 dB at octave 7, indexed by F-num>>6
const KSLSH=[31,1,2,0]; // KSL field -> shift (1.5/3/6 dB per octave; 0 = off)
const VP=[0,1,2,1,0,-1,-2,-1]; // vibrato pattern, 8 steps of 1024 samples (6.07 Hz)
const EX=[0,0x11,0x55,0x77]; // 8-tick bit patterns: extra +1 increments for rate fraction 0..3
const OPCH=[0,1,2,0,1,2,-1,-1,3,4,5,3,4,5,-1,-1,6,7,8,6,7,8]; // reg offset (0..0x15) -> channel
const OPCA=[0,0,0,1,1,1,0,0,0,0,0,1,1,1,0,0,0,0,0,1,1,1];
const A=0,D=1,S=2,R=3; // envelope states
export class Opl2{
 constructor(sampleRate=49716){
  this.sr=sampleRate;this.step=49716/sampleRate;
  const I=()=>new Int32Array(18),C=()=>new Int32Array(9);
  this.am=I();this.vib=I();this.egt=I();this.ksr=I();this.mult=I();this.ksl=I();this.tl=I();this.ar=I();this.dr=I();this.sl=I();this.rr=I();this.wv=I();
  this.ph=I();this.env=I();this.st=I();this.key=I();this.kslA=I();
  this.fn=C();this.blk=C();this.kon=C();this.fb=C();this.cn=C();this.kc=C();this.fa=C();this.fbb=C();
  this.reset();
 }
 reset(){
  for(const k of ['am','vib','egt','ksr','mult','ksl','tl','ar','dr','sl','rr','wv','ph','st','key','kslA','fn','blk','kon','fb','cn','kc','fa','fbb'])this[k].fill(0);
  this.env.fill(511);this.st.fill(R);
  this.wse=0;this.dam=0;this.dvb=0;this.rhy=0;this.rb=0;this.nts=0;this.cnt=0;this.tc=0;this.vc=0;this.lfsr=1;
  this.acc=1;this.s0=0;this.s1=0;this.pos=1; // resampler state
 }
 envOf(o){return this.env[o];} // current envelope attenuation of operator o (0..511), for tests/diagnostics
 _chg(c){ // recompute key code and key scale level of channel c
  const f=this.fn[c],b=this.blk[c];this.kc[c]=b<<1|(f>>(this.nts?8:9)&1);
  const base=Math.max(0,KSLROM[f>>6]-8*(7-b));
  for(let k=0;k<2;k++){const o=c*2+k,s=this.ksl[o];this.kslA[o]=s?(base>>KSLSH[s])<<2:0;}
 }
 _keys(){ // apply key state: normal channels from B0.5, rhythm channels 6-8 from BD bits
  for(let o=0;o<18;o++){
   const c=o>>1;let on=this.kon[c];
   if(this.rhy&&c>=6){const r=this.rb;on=c===6?r>>4&1:o===14?r&1:o===17?r>>1&1:o===16?r>>2&1:o===15?r>>3&1:0;}
   if(on&&!this.key[o]){this.key[o]=1;this.ph[o]=0;this.st[o]=A;if(this._rate(o,this.ar[o])>=60){this.env[o]=0;this.st[o]=D;}}
   else if(!on&&this.key[o]){this.key[o]=0;this.st[o]=R;}
  }
 }
 _rate(o,r){if(!r)return 0;const kc=this.kc[o>>1],v=4*r+(this.ksr[o]?kc:kc>>2);return v>63?63:v;}
 write(reg,val){
  reg&=0xff;val&=0xff;
  if(reg===1){this.wse=val>>5&1;return;}
  if(reg===8){this.nts=val>>6&1;for(let c=0;c<9;c++)this._chg(c);return;}
  if(reg===0xbd){this.dam=val>>7&1;this.dvb=val>>6&1;this.rhy=val>>5&1;this.rb=val&0x1f;this._keys();return;}
  if(reg>=0xa0&&reg<=0xa8){const c=reg-0xa0;this.fn[c]=this.fn[c]&0x300|val;this._chg(c);return;}
  if(reg>=0xb0&&reg<=0xb8){const c=reg-0xb0;this.fn[c]=this.fn[c]&0xff|(val&3)<<8;this.blk[c]=val>>2&7;this.kon[c]=val>>5&1;this._chg(c);this._keys();return;}
  if(reg>=0xc0&&reg<=0xc8){const c=reg-0xc0;this.fb[c]=val>>1&7;this.cn[c]=val&1;return;}
  const k=reg&0x1f,g=reg&0xe0;
  if(k>0x15||OPCH[k]<0||g<0x20||g>0xe0||g===0xa0||g===0xc0)return;
  const o=OPCH[k]*2+OPCA[k];
  switch(g){
   case 0x20:this.am[o]=val>>7;this.vib[o]=val>>6&1;this.egt[o]=val>>5&1;this.ksr[o]=val>>4&1;this.mult[o]=val&15;break;
   case 0x40:this.ksl[o]=val>>6;this.tl[o]=val&63;this._chg(o>>1);break;
   case 0x60:this.ar[o]=val>>4;this.dr[o]=val&15;break;
   case 0x80:this.sl[o]=val>>4;this.rr[o]=val&15;break;
   case 0xe0:this.wv[o]=val&3;break;
  }
 }
 _eg(o){ // one envelope step; update rate = 2^(hi-13) per sample (hi>=13) or one tick per 2^(13-hi) samples, increments 1(+1) per fraction pattern
  const st=this.st[o];let r;
  if(st===A)r=this._rate(o,this.ar[o]);else if(st===D)r=this._rate(o,this.dr[o]);
  else if(st===S){if(this.egt[o])return;r=this._rate(o,this.rr[o]);}else r=this._rate(o,this.rr[o]);
  if(!r)return;
  if(st===A&&r>=60){this.env[o]=0;this.st[o]=D;return;}
  const hi=r>>2,sh=hi>=13?0:13-hi,c=this.cnt;
  if(c&((1<<sh)-1))return;
  const inc=(1+(EX[r&3]>>((c>>sh)&7)&1))<<(hi>13?hi-13:0);
  let e=this.env[o];
  if(st===A){e-=((e*inc)>>3)+1;if(e<=0){e=0;this.st[o]=D;}this.env[o]=e;return;}
  e+=inc;
  if(st===D){const s=this.sl[o],lv=(s===15?31:s)<<4;if(e>=lv){e=lv;this.st[o]=S;}}
  this.env[o]=e>511?511:e;
 }
 _slot(o,ph,tr){ // operator output for 10-bit phase ph
  ph&=1023;const w=this.wse?this.wv[o]:0;let neg=ph&512;
  if(w===1&&neg)return 0;
  if(w===3&&ph&256)return 0;
  if(w>=2)neg=0;
  let q=ph&255;if(ph&256)q=255-q;
  let e=this.env[o]+(this.tl[o]<<2)+this.kslA[o]+(this.am[o]?tr:0);if(e>511)e=511;
  const a=LS[q]+(e<<3),sh=a>>8;if(sh>=12)return 0;
  const v=(EXP[a&255]+1024)>>sh;return neg?-v:v;
 }
 _tick(){
  const cnt=this.cnt,tcv=this.tc,vcv=this.vc;
  const t=tcv>>6,tri=t<105?t:210-t,tr=(tri>>2)>>(this.dam?0:2),vs=this.dvb?1:2,vp=VP[vcv>>10];
  for(let o=0;o<18;o++)this._eg(o);
  const ph=this.ph,rhy=this.rhy;let sum=0;
  const n=this.lfsr&1,p14=ph[14]>>10,p17=ph[17]>>10;
  const x=((p14>>2^p14>>7)&1|(p14>>3^p17>>5)&1|(p17>>3^p17>>5)&1)&1; // percussion phase bit from hi-hat/cymbal phases
  for(let c=0;c<9;c++){
   if(rhy&&c>=7){
    let s;
    if(c===7)s=this._slot(14,(x<<9)|(0x34<<((x^n)<<1)),tr)+this._slot(15,(p14&0x100?0x200:0x100)^(n<<8),tr);
    else s=this._slot(16,ph[16]>>10,tr)+this._slot(17,(x<<9)|0x80,tr);
    sum+=s*2;continue; // rhythm voices are twice as loud as FM outputs
   }
   const f=this.fb[c],m=this._slot(c*2,(ph[c*2]>>10)+(f?(this.fa[c]+this.fbb[c])>>(8-f):0),tr);
   this.fbb[c]=this.fa[c];this.fa[c]=m;
   const cr=this._slot(c*2+1,(ph[c*2+1]>>10)+(this.cn[c]?0:m),tr);
   sum+=this.cn[c]?m+cr:cr;
  }
  // phase advance (vibrato applied per operator)
  for(let o=0;o<18;o++){
   const c=o>>1;let fn=this.fn[c];
   if(this.vib[o]){const fo=(fn>>7)*vp;fn+=fo<0?-((-fo)>>vs):fo>>vs;}
   ph[o]=(ph[o]+(((fn<<this.blk[c])*M2[this.mult[o]])>>1))&0xfffff;
  }
  this.cnt=cnt+1|0;this.tc=tcv+1===13440?0:tcv+1;this.vc=vcv+1&8191;
  const l=this.lfsr;this.lfsr=l>>1|((l^l>>14)&1)<<22;
  return sum;
 }
 generate(out,n){
  if(this.step===1){for(let i=0;i<n;i++){const v=this._tick()/16384;out[i]=v>1?1:v<-1?-1:v;}return;}
  let a=this.acc,s0=this.s0,s1=this.s1;
  for(let i=0;i<n;i++){
   while(a>=1){a-=1;s0=s1;s1=this._tick();}
   const v=(s0+(s1-s0)*a)/16384;out[i]=v>1?1:v<-1?-1:v;a+=this.step;
  }
  this.acc=a;this.s0=s0;this.s1=s1;
 }
}
