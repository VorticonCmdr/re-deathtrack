// PC-speaker sound effects: bank loader (segment 32e3) and the 4-voice effect interpreter (segment 334e).
// docs/re/input-timer-sound.md "Sound effects" and "Effect tick", docs/re/resources.md "Sound-effect bank".
// Bank records at DS:2c2c + 0x16*k; voice structs (0x30 bytes) through the pointer table DS:3789.
import {rb,wb,rw,ww,frw,fww,frb,fp,pseg,poff,salloc,sfree} from '../engine/mem.js';
import {s16} from '../engine/int.js';
import {outp,inp} from './bios.js';
import {F,provide} from './link.js';

// ES = [56a6] (DGROUP, relocated) for the priority table at 3628.
const prioGet=v=>frw(rw(0x56a6),0x3628+2*v), prioSet=(v,x)=>fww(rw(0x56a6),0x3628+2*v,x);

// 32e3:0000 (fragment) ADD BP,2; JMP -> not a function entry; 32e3:0007 is a mis-split tail that calls 0013.
// 32e3:0007 (tail of the shutdown path reached from 1ff8:20ff): calls sfxStopAll and returns.
export function f32e3_0007(){return f32e3_0013();}
// 32e3:0013 sfxStopAll: voices 0..2 only (QUIRK: voice 3 is not stopped), then one effect tick. Returns 1.
export function f32e3_0013(){
 for(let v=0;v<3;v++){f334e_01ac(v);prioSet(v,0);}
 f334e_0000();return 1;
}
// 32e3:0054 sfxStopId(id): voices 0..2 whose effect id is `id`. No callers. Returns 0.
export function f32e3_0054(id){
 for(let v=0;v<3;v++)if(rw(0x8ea6+2*v)===(id&0xffff)){prioSet(v,0);f334e_01ac(v);}
 return 0;
}
// 32e3:009a sfxLoadBank(fpOrName): SND:INF:, SND:IBM: (relocated), SND:ITM:. Returns bank+1 or 0.
export function f32e3_009a(name){
 let k=0;
 for(;k<10;k++){const r=0x16*k;if((rw(0x2c2c+r)|rw(0x2c2e+r))===0)break;}
 // QUIRK: JLE lets k == 10 through when every record is used, so record 10 (DS:2d18) is written.
 if(!(k<=10))return 0;
 const rec=0x16*k;
 let file,opened;
 if(F.f1ff8_4de0(name)){file=name;opened=0;}
 else{file=F.f1ff8_4a48(name);if(!file)return 0;opened=1;}
 let err=(F.f1ff8_4ade(file,0x2d08,0)|0)>=0?0:1;
 if(!err){
  const skip=salloc(2);
  try{F.f1000_c214(skip,2,1,file);}finally{sfree(2);}
  F.f1000_c214(0x2c3c+rec,2,1,file);
  F.f1000_c214(0x2c3e+rec,2,1,file);
 }
 if(!err)err=(f32e3_01f1(0x2c2c+rec,file,0x2d11)&0xffff)<1?1:0;
 if(!err)ww(0x2c40+rec,f32e3_026a(0x2c2c+rec,file,0x2d1a)); // stored unchecked (resources.md wave quirk)
 if(opened)F.f1ff8_4da4(file);
 return err?0:k+1;
}
// 32e3:01f1 sfxLoadRelocate(rec, fp, tag): load the chunk, then add the node's block far pointer (32-bit add of
// offset and segment words) to each non-zero dword of the first rec.count entries. Returns 1, or 0.
export function f32e3_01f1(rec,file,tag){
 const node=f32e3_026a(rec,file,tag);
 if(!node)return 0;
 for(let i=0;;i++){
  if(!(rsw(rec+0x10)>i))return 1;
  const si=i<<2,src=fp(rw(node+2),rw(node)),ss=pseg(src),so=poff(src);
  const lo=frw(ss,so+si),hi=frw(ss,so+si+2);
  if((lo|hi)===0)continue;
  const sum=(lo|hi<<16)+(rw(node)|rw(node+2)<<16)>>>0;
  const d=fp(rw(rec+2),rw(rec));fww(pseg(d),poff(d)+si,sum&0xffff);fww(pseg(d),poff(d)+si+2,sum>>>16);
 }
}
const rsw=o=>s16(rw(o));
// 32e3:026a loadChunk(rec, fp, tag): seek tag, decode into a DOS block in 20000-byte steps, link a node
// {far data, next, tag[9]}. Returns the node, or 0.
export function f32e3_026a(rec,file,tag){
 let h=-1,blk=0,err,size=0,dst=0;
 if(!((F.f1ff8_4ade(file,tag,0)|0)>=0))return 0;
 const len=F.f1ff8_4d72(file)>>>0;
 h=s16(F.f1ff8_0d47(-1,file,0x2d23,len&0xffff,len>>>16));
 err=h>=0?0:1;
 if(!err){size=F.f1ff8_1310(h)>>>0;err=size!==0?0:1;}
 if(!err){blk=F.f1ff8_3a88(size&0xffff,size>>>16,1)>>>0;if(!blk)err=1;}
 dst=blk;
 while(!err&&size!==0){
  const chunk=size>0x4e20?0x4e20:size;
  const n=F.f1ff8_11f0(h,dst,chunk)&0xffff;
  err=n!==chunk?1:0;
  size=size-chunk>>>0;
  // Huge-pointer advance: offset += chunk, carry adds 0x1000 to the segment.
  const o=poff(dst)+chunk;dst=fp(pseg(dst)+(o>0xffff?0x1000:0),o);
 }
 if(h>=0)F.f1ff8_100d(h);
 let node=rec;
 if(!err){
  if((rw(rec)|rw(rec+2))!==0&&!err){
   while(rw(node+4)!==0)node=rw(node+4);
   ww(node+4,F.f1000_c272(0x10));
   if(rw(node+4)===0)err=2; // QUIRK: the last existing node's data pointer is then overwritten below
   else{node=rw(node+4);ww(node+4,0);}
  }
  ww(node,poff(blk));ww(node+2,pseg(blk));
  F.f1000_c2ce(node+6,tag);
 }
 if(err){if(blk)F.f1ff8_3ae2(poff(blk),pseg(blk));return 0;}
 return node;
}
// 32e3:043f sfxStart(n, prio): allocate a voice and start stream n of the selected bank. Returns 1 or 0.
export function f32e3_043f(n,prio){
 n=s16(n);prio&=0xffff;
 const bank=rsw(0x9a40);if(bank<0)return 0;
 const rec=s16(0x16*bank)&0xffff;
 if(!(s16(rw(0x2c3c+rec)-1)>=n))return 0;
 const tb=fp(rw(0x2c2e+rec),rw(0x2c2c+rec)),si=n<<2&0xffff;
 const so=frw(pseg(tb),poff(tb)+si),ss=frw(pseg(tb),poff(tb)+si+2);
 let v;
 if(frw(ss,so)===0){
  v=f32e3_050a(prio,so,ss);
  if(s16(v)>4)return 0;
  if(prioGet(v)>prio)return 0;
  const itm=rw(0x2c40+rec); // node pointer, or 0: then DS:0000/0002 are pushed (resources.md wave quirk)
  f334e_01d3(so,ss,v,rw(itm),rw(itm+2),0);
 }else{
  // UNKNOWN: the original uses the uninitialised local [BP-0Eh] as the voice; no PALS.BLK stream has type != 0.
  v=0;
 }
 prioSet(v,prio);ww(0x8ea6+2*v,n);
 return 1;
}
// 32e3:050a sfxPickVoice(prio, streamOff, streamSeg) (near): 8 for type 2; voice 2 for type 1 with +6 != 0;
// else the first free voice 0..3, else the last voice with minimal priority; 4 when that priority > prio.
export function f32e3_050a(prio,so,ss){
 let v;
 if(frw(ss,so)===2)return 8;
 if(frw(ss,so+6)!==0&&frw(ss,so)===1)v=2;
 else{for(v=0;v<4;v++)if(prioGet(v)===0)break;}
 if(v===4){
  let best=prioGet(0);
  for(let i=0;i<4;i++){const p=prioGet(i);if(!(best<p)){best=p;v=i;}}
 }
 if(prioGet(v)>(prio&0xffff))return 4;
 return v;
}
// 32e3:05ba sfxSelectBank(id): [9a40] = id-1 when that record is loaded. Returns 1 or 0.
export function f32e3_05ba(id){
 id=s16(id-1);
 if(id>10)return 0; // QUIRK: id-1 == 10 passes (JG)
 if(id<0)return 0;
 const r=s16(0x16*id)&0xffff;
 if((rw(0x2c2c+r)|rw(0x2c2e+r))===0)return 0;
 ww(0x9a40,id);return 1;
}
// 32e3:05f5 sfxUnloadBank(id). No callers. Returns the 0630 result, or 0.
export function f32e3_05f5(id){
 id=s16(id-1);
 if(id<0)return 0;
 if(id>10)return 0;
 if(id===rsw(0x9a40)){ww(0x9a40,0xffff);f32e3_0013();}
 return f32e3_0630(0x2c2c+(s16(0x16*id)&0xffff)&0xffff);
}
// 32e3:0630 freeChunks(node): DosFree each node's block and free() each node (including the first). No callers.
export function f32e3_0630(node){
 for(;;){
  if(node===0)return 1;
  if((rw(node)|rw(node+2))===0)return 0;
  F.f1ff8_3ae2(rw(node),rw(node+2));
  F.f1000_c280(node);
  node=rw(node+4);
 }
}
// 32e3:0675 sfxSetFreqById(id, f): voices 0..3. No callers.
export function f32e3_0675(id,f){for(let v=0;v<4;v++)if(rw(0x8ea6+2*v)===(id&0xffff))f334e_0242(v,f);}

// ---- 334e: interpreter ----
// 334e:0000 sfxTick: run every active voice (3..0), pick the output voice, drive PIT ch2 and the gate.
export function f334e_0000(){
 if(rb(0x3659)!==0)return;
 ww(0x365f,0);ww(0x35f4,0);
 for(let bx=6;bx>=0;bx-=2){
  const di=rw(bx+0x3789);
  if((rb(bx+0x3649)&rb(0x35ef))===0)continue;
  if(!(rw(bx+0x3628)<rw(0x35f4))){ww(0x35f4,rw(bx+0x3628));ww(0x365f,di);}
  ww(0x35f6,bx);
  f334e_0078(di,rw(bx+0x3638));
  bx=rw(0x35f6);
 }
 const di=rw(0x365f);
 if(di===0)return;
 const d=rw(di+8);outp(0x42,d&0xff);outp(0x42,d>>8);
 const bl=rw(di+0xa)!==0?3:0;
 outp(0x61,inp(0x61)&0xfc|bl);
}
// 334e:0078 sfxVoiceTick (near; DI = voice, ES = stream segment).
export function f334e_0078(di,es){
 ww(di+2,rw(di+2)-1);
 if(rw(di+2)===0)f334e_00f9(di,es);
 ww(di+0xa,rw(di+0xa)+rw(di+0xc));
 ww(di+4,rw(di+4)+rw(di+6));
 let dx=0;
 let ax=rw(di+0x1a)+rw(di+0x1c)&0xffff;
 if(ax!==0){
  if(!(ax<rw(di+0x2a)))ax=ax-rw(di+0x2a)&0xffff;
  ww(di+0x1a,ax);
  const bx=(s16(ax)>>4)+rw(di+0x2e)&0xffff;
  const p=s16(frb(es,bx)<<8)*s16(rw(di+0x1e));
  dx=p>>16&0xffff;
 }
 ww(di+8,dx+rw(di+4));
 if(rw(di+0x18)===0)return;
 ww(di+0x18,rw(di+0x18)-1);
 if(rw(di+0x18)!==0)return;
 for(;;){
  const bx=rw(di+0x2c)+rw(di+0x16)&0xffff;
  if(frw(es,bx+2)!==0xffff){ww(di+0xc,frw(es,bx));ww(di+0x18,frw(es,bx+2));ww(di+0x16,rw(di+0x16)+4);return;}
  const ax2=frw(es,bx);ww(di+0xa,ax2);
  if(ax2===0)ww(di+0xc,0);
  ww(di+0x16,rw(di+0x16)+4);
 }
}
// 334e:00f9 sfxVoiceStep (near command interpreter 00f9-01ab, including the jump-table targets 0119, 018f,
// 0196, 019d reached through DS:3661). DI = voice, ES = stream segment.
export function f334e_00f9(di,es){
 let si=rw(di);
 const word=()=>{const w=frw(es,si);si=si+2&0xffff;return w;};
 for(;;){
  let bl=frb(es,si);si=si+1&0xffff;
  // CMP BL,80h; JGE is a signed compare that always passes, so the end branch at 014b is reached only via op 02h.
  bl&=0x7e;
  if(bl<=0x78){
   const ax=word();
   if(bl<0x2c){
    ww(di+bl,ax);
    if(bl!==2)continue;
    if(rw(di+2)!==0){ww(di,si);return;}
    // 014b: voice ends
    const bx=rw(0x35f6);ww(bx+0x3649,0);ww(bx+0x3628,0);ww(di,0);return;
   }
   const bx=rw(0x35f6);
   if(bl===0x2c){
    // 0181: envelope select through [3618+v] (never written), then hold for 65536 ticks.
    ww(di+0x2c,frw(es,(ax<<1)+rw(bx+0x3618)&0xffff));
    ww(di+2,0);ww(di,si);return;
   }
   // 0167: wave select from the ITM offset table (ES-relative, resources.md wave quirk).
   const p=(ax<<2)+rw(bx+0x35f8)&0xffff;
   ww(di+0x2e,frw(es,p));ww(di+0x2a,frw(es,p+2));
   continue;
  }
  const tgt=rw(0x3661+(bl-0x78));
  if(tgt===0x019d){const ax=word();ww(0x365b,si);si=si+ax&0xffff;continue;}
  if(tgt===0x018f){ww(di+2,0);ww(di,si);return;}
  if(tgt===0x0119){
   const ax=word();
   if(rw(di+0x20)===0){si=si+ax&0xffff;continue;}
   ww(di+0x20,rw(di+0x20)-1);
   if(rw(di+0x20)===0)continue;
   si=si+ax&0xffff;continue;
  }
  if(tgt===0x0196){si=rw(0x365b);continue;}
  throw Error(`334e:0115 jump table entry ${tgt.toString(16)}`);
 }
}
export const f334e_0119=f334e_00f9, f334e_0196=f334e_00f9, f334e_019d=f334e_00f9; // fragments of 00f9
// 334e:01ac sfxVoiceStop(v)
export function f334e_01ac(v){const bx=v<<1&0xffff;ww(bx+0x3649,0);const si=rw(bx+0x3789);ww(si+2,0);ww(si+0xa,0);}
// 334e:01d3 sfxVoiceStart(streamOff, streamSeg, v, itmOff, itmSeg)
export function f334e_01d3(so,ss,v,itmOff,itmSeg){
 wb(0x3659,1);
 const bx=v<<1&0xffff;
 ww(bx+0x3649,1);
 const si=rw(bx+0x3789);
 ww(bx+0x3638,ss);ww(bx+0x35f8,itmOff);ww(bx+0x3608,itmSeg);
 const t=frw(ss,so);
 if(t===0||t===1){ // type 1 initialises whether or not +6 is zero (both branches reach 0222)
  ww(si,so+8);
  for(let b=0x2e;b>0;b-=2)ww(b+si,0);
  ww(si+2,1);
 }
 wb(0x3659,0);
}
// 334e:0242 sfxVoiceSetFreq(v, f): [voice+4] = f. Only from the uncalled 32e3:0675.
export function f334e_0242(v,f){ww(rw((v<<1&0xffff)+0x3789)+4,f);}

export {f32e3_009a as sfxLoadBank,f32e3_043f as sfxStart,f32e3_0013 as sfxStopAll,f334e_0000 as sfxTick};
provide({f32e3_0007,f32e3_0013,f32e3_0054,f32e3_009a,f32e3_01f1,f32e3_026a,f32e3_043f,f32e3_050a,f32e3_05ba,f32e3_05f5,f32e3_0630,f32e3_0675,
 f334e_0000,f334e_0078,f334e_00f9,f334e_01ac,f334e_01d3,f334e_0242});
