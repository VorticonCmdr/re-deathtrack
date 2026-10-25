// Music: the SMF sequencer (1000:c543-c8c5), the device layer and built-in MIDI parser (1000:cd68-d0c7, d1f8-d31e),
// the PC-speaker driver (1000:d110-d1f7) and stubs for the AdLib, MT-32 and Tandy drivers, which the port reports absent.
// Analysis: docs/re/input-timer-sound.md "Music sequencer", "Device layer and drivers", "Music tick 1000:c731".
// Device descriptors are DGROUP structs whose entries are near offsets in segment 1000 (MT-32 2ec8, AdLib 2d8a,
// Tandy 3004, speaker 34d6); they are dispatched through the host registry. Near driver entries take their register
// arguments as JS parameters: rawOut(AL) -> AX, noteOn(SI=voice, AX=velocity), noteOff(SI=voice), patch(DI, SI).
import {rb,wb,rw,ww,frb,frw,fwb,fww,gseg,gaddr,pseg,poff} from '../engine/mem.js';
import {u16,div16,mod16,mul16,div32_16,ldiv} from '../engine/int.js';
import {register,callFar,unsupported} from '../engine/host.js';
import {outp,inp} from './bios.js';
import {F,provide} from './link.js';

const near=(off,...a)=>callFar(gaddr(0x1000,off),...a);
const desc=()=>rw(0x30d2);
const incb=o=>wb(o,rb(o)+1), decb=o=>{const v=rb(o)-1&0xff;wb(o,v);return v;};

// ---- Sequencer ----
// ES:SI of the sequencer while c60a/c731 run (registers in the original).
let es=0,si=0;
const lodsb=()=>{const v=frb(es,si);si=si+1&0xffff;return v;};

// 1000:c543 speakerGateOff: port 61h &= ~3
export function f1000_c543(){outp(0x61,inp(0x61)&0xfc);}
// 1000:c54a speakerGateOn: port 61h |= 3
export function f1000_c54a(){outp(0x61,inp(0x61)|3);}
// 1000:c552 musicStatus: AX = [2d4e]
export function f1000_c552(){return rw(0x2d4e);}
// 1000:c556 musicLock: [2d58] = 1
export function f1000_c556(){wb(0x2d58,1);}
// 1000:c55c musicUnlock: [2d58] = 0
export function f1000_c55c(){wb(0x2d58,0);}
// 1000:c562 musicGetPosition(far dst): copies the 3 words at DS:2d52 under the lock. dst is a packed far pointer.
export function f1000_c562(off,seg){
 wb(0x2d58,1);for(let i=0;i<3;i++)fww(seg,off+2*i,rw(0x2d52+2*i));wb(0x2d58,0);
}
// 1000:c581 musicSetCallbackRate(n): if n != 0: [2d40] = n, [2d44] = 0
export function f1000_c581(n){n=u16(n);if(n){ww(0x2d40,n);ww(0x2d44,0);}}
// 1000:c597 musicSetTempo(a, b): [2d42] = lo16(a*b), [2d44] = 0
export function f1000_c597(a,b){ww(0x2d42,mul16(a,b));ww(0x2d44,0);}
// 1000:c5ac musicSetTimeSig(a, b, c): [2d48] = c; [2d46] = (0x180*a) / lo16(c*b), DIV with the full DX:AX dividend.
export function f1000_c5ac(a,b,c){ww(0x2d48,c);const bx=mul16(c,b)&0xffff;ww(0x2d46,div32_16(mul16(0x180,a),bx));}
// 1000:c5c7 allNotesOff (near): for ch = 16..1: midiOut(0xAF+ch), midiOut(0x7B), midiOut(0)
export function f1000_c5c7(){for(let cx=0x10;cx;cx--){f1000_d1f8(cx+0xaf&0xff);f1000_d1f8(0x7b);f1000_d1f8(0);}}
// 1000:c5f3 readVarLen (near): MIDI variable-length quantity at ES:SI -> DX:AX (32-bit), SI advanced.
// Each byte: DX:AX = ((DX:AX << 8 | rol8(b)) >> 1), i.e. (v << 7 | b&0x7f) in 32 bits; loops while bit 7 was set.
export function f1000_c5f3(){
 let v=0,b;
 do{b=lodsb();v=((v<<8|(b<<1&0xff|b>>7))>>>1)>>>0;}while(b&0x80);
 return v;
}
// 1000:c60a musicPlay(far ptr, flags): validates an SMF (format 0, 1 track, 96 PPQN) and starts it. Returns flags or 0.
// ptr is a packed far pointer. The MThd length is taken from its low 16 bits only (byte-swapped word at +6).
export function f1000_c60a(off,seg,flags){
 if(!(flags&1))return 0;
 const s=seg&0xffff;let o=off&0xffff;
 const lw=()=>{const v=frw(s,o);o=o+2&0xffff;return v;};
 if(lw()!==0x544d)return 0;if(lw()!==0x6468)return 0;
 o=o+2&0xffff;
 const w=lw(),cx=(w>>8|w<<8)&0xffff;
 if(frw(s,o)!==0)return 0;if(frw(s,o+2)!==0x100)return 0;if(frw(s,o+4)!==0x6000)return 0;
 o=o+cx&0xffff;
 if(lw()!==0x544d)return 0;if(lw()!==0x6b72)return 0;
 o=o+4&0xffff;
 es=s;si=o;
 wb(0x2d58,1);
 if(rw(0x2d4e)&1)f1000_c5c7();
 ww(0x2d4e,0);
 // QUIRK: the first delta is stored as +delta (c675), so the first event plays on the first tick (input-timer-sound.md).
 ww(0x2d50,f1000_c5f3());
 ww(0x2d4a,si);ww(0x2d4c,es);
 ww(0x2d4e,flags);
 ww(0x2d52,0);ww(0x2d54,0);ww(0x2d56,0);
 wb(0x2d58,0);
 return u16(flags);
}
// 1000:c6a3 musicPause: if (flags&3)==1: set bit 1, allNotesOff
export function f1000_c6a3(){if((rw(0x2d4e)&3)===1){wb(0x2d58,1);ww(0x2d4e,rw(0x2d4e)|2);f1000_c5c7();wb(0x2d58,0);}}
// 1000:c6c1 musicResume: if (flags&3)==3: clear bit 1
export function f1000_c6c1(){if((rw(0x2d4e)&3)===3){wb(0x2d58,1);ww(0x2d4e,rw(0x2d4e)&0xfffd);wb(0x2d58,0);}}
// 1000:c6dc musicMute: if (flags&5)==1: set bit 2, allNotesOff
export function f1000_c6dc(){if((rw(0x2d4e)&5)===1){wb(0x2d58,1);ww(0x2d4e,rw(0x2d4e)|4);f1000_c5c7();wb(0x2d58,0);}}
// 1000:c6fa musicUnmute: if (flags&5)==5: clear bit 2
export function f1000_c6fa(){if((rw(0x2d4e)&5)===5){wb(0x2d58,1);ww(0x2d4e,rw(0x2d4e)&0xfffb);wb(0x2d58,0);}}
// 1000:c715 musicStop: if playing: [2d4e] = 0, allNotesOff
export function f1000_c715(){if(rw(0x2d4e)&1){wb(0x2d58,1);ww(0x2d4e,0);f1000_c5c7();wb(0x2d58,0);}}

// 1000:c731 musicTick: timer slots 1/3/5/7. Accumulates MIDI ticks and plays every due event.
// The event handlers (tables DS:2d5b for 8x-Ex, DS:2d69 for F0-FF) are jump targets taking AX = status;
// they return true only when the loop must exit without the delta read (meta 2Fh, c7f2 -> c7a6).
export function f1000_c731(){
 if(rb(0x2d59)===1)return;
 wb(0x2d59,1);
 if((rw(0x2d4e)&3)===1){
  const t=rw(0x2d44)+rw(0x2d42)&0xffff,d=rw(0x2d40);
  ww(0x2d44,mod16(t,d));ww(0x2d50,rw(0x2d50)+div16(t,d));
  if(rb(0x2d58)!==1){
   si=rw(0x2d4a);es=rw(0x2d4c);
   while(rsw50()>=0){                       // c769: CMP [2d50],0 / JS
    let al=lodsb();
    if(al<0x80){al=rb(0x2d5a);si=si-1&0xffff;}
    let bx=al,stop;
    if(al<0xf8&&al<0xf0){wb(0x2d5a,al);stop=near(rw(0x2d5b+((bx&0x70)>>3)),al);}
    else{if(al<0xf8)wb(0x2d5a,0);stop=near(rw(0x2d69+((bx&0xf)<<1)),al);}
    if(stop)break;
   }
   ww(0x2d4a,si);                           // c7a6
  }
 }
 wb(0x2d59,0);
}
const rsw50=()=>rw(0x2d50)<<16>>16;
// 1000:c7b1 sysexF0 (handler): midiOut(status), then c7bc
export function f1000_c7b1(ax){f1000_d1f8(ax);return f1000_c7bc(ax);}
// 1000:c7bc sysexF7 (handler): n = readVarLen; midiOut n data bytes; c854.
// QUIRK: LOOP with CX = 0 sends 65536 bytes.
export function f1000_c7bc(ax){
 let cx=f1000_c5f3()&0xffff;
 do{f1000_d1f8(lodsb());cx=cx-1&0xffff;}while(cx);
 return f1000_c854();
}
// 1000:c7d8 meta (handler, FFh): type, length; 2Fh stop, 51h tempo, 58h time signature; skips the data, then c854.
export function f1000_c7d8(ax){
 const bl=lodsb(),len=f1000_c5f3()&0xffff;
 if(bl===0x2f){f1000_c715();return true;}   // c7f2: JMP c7a6 (SI left at the meta data)
 if(bl===0x51){
  const hi=frb(es,si),w=frw(es,si+1),lo=(w>>8|w<<8)&0xffff;
  const q=f1000_d31e(0x8700,0x393,lo,hi)&0xffff;   // 60000000 / tempo
  f1000_c597(0x60,q);
 }else if(bl===0x58){
  const nn=frb(es,si),cl=frb(es,si+1),ch=frb(es,si+2);
  // UNKNOWN: SHL BH,CL count masking differs between 8086 and 286+; the 286+ (5-bit) behaviour is used.
  const bh=1<<(cl&31)&0xff;
  const cx=bh*ch&0xffff,ax=0x60*nn&0xffff;
  const q=div16(ax,cx),r=mod16(ax,cx);
  // QUIRK: DH still holds the high byte of the DIV remainder when DL is loaded with BH and BL (c842-c847).
  f1000_c5ac(r&0xff00|nn,r&0xff00|bh,q);
 }
 si=si+len&0xffff;
 return f1000_c854();
}
// 1000:c854 nextDelta (handler and common tail): [2d50] -= delta; position counters unless flags bit 3.
export function f1000_c854(){
 const ax=f1000_c5f3()&0xffff;
 if(ax){
  ww(0x2d50,rw(0x2d50)-ax);
  if(!(rw(0x2d4e)&8)){
   let a=ax+rw(0x2d52)&0xffff;const d1=rw(0x2d46);
   ww(0x2d52,mod16(a,d1));a=div16(a,d1)+rw(0x2d54)&0xffff;
   const d2=rw(0x2d48);ww(0x2d54,mod16(a,d2));ww(0x2d56,rw(0x2d56)+div16(a,d2));
  }
 }
 return false;
}
// 1000:c88a note (handler, 8x/9x/Ax): skipped (SI += 2) while muted, else c897
export function f1000_c88a(ax){if(rw(0x2d4e)&4){si=si+2&0xffff;return f1000_c854();}return f1000_c897(ax);}
// 1000:c897 threeByte (handler): status + 2 data bytes
export function f1000_c897(ax){f1000_d1f8(ax);return f1000_c8a8(lodsb());}
// 1000:c8a8 twoByte (handler): AX + 1 data byte
export function f1000_c8a8(ax){f1000_d1f8(ax);return f1000_c8b9(lodsb());}
// 1000:c8b9 oneByte (handler): AX only
export function f1000_c8b9(ax){f1000_d1f8(ax);return f1000_c854();}

// ---- AdLib (2d8a): absent ----
// 1000:c8e5 oplDetect: APPROX: the OPL register writes (OUT 388h/389h via c8c6) are not performed; with no
// AdLib, IN 388h reads FFh and the status test at c8f7 fails, so AX = 0 (input-timer-sound.md "Port values").
export function f1000_c8e5(){return 0;}
export function f1000_c8c6(){unsupported('1000:c8c6 AdLib register write');}
export function f1000_c93e(){unsupported('1000:c93e AdLib init');}
export function f1000_c962(){unsupported('1000:c962 AdLib shutdown');}
export function f1000_c963(){unsupported('1000:c963 AdLib raw out');return 0;}
export function f1000_c966(){unsupported('1000:c966 AdLib note on');}
export function f1000_ca6d(){unsupported('1000:ca6d AdLib note off');}
export function f1000_ca95(){unsupported('1000:ca95 AdLib voices init');}
export function f1000_cabc(){unsupported('1000:cabc AdLib patch');}

// ---- MT-32 / MPU-401 (2ec8): absent ----
// 1000:cb3e mpuDetect: bounded polls of port 331h (status) and 330h (data). With no MPU, 331h reads FFh.
export function f1000_cb3e(){
 const wait=mask=>{let cx=0;do{cx=cx-1&0xffff;if(!(inp(0x331)&mask))break;}while(cx);return cx;};
 if(!wait(0x40))return 0;
 unsupported('1000:cb4b MPU-401 command write');return 0;
}
export function f1000_cb72(){unsupported('1000:cb72 MT-32 init');}
export function f1000_cbb6(){unsupported('1000:cbb6 MT-32 shutdown');}
export function f1000_cbd0(){unsupported('1000:cbd0 MT-32 raw out');return 0;}
export function f1000_cbf7(){unsupported('1000:cbf7 MT-32 raw out');return 0;}
export function f1000_cbfb(){unsupported('1000:cbfb MT-32 voice op');}
export function f1000_cbfc(){unsupported('1000:cbfc MT-32 tick');}
export function f1000_cc2d(){unsupported('1000:cc2d MT-32 IRQ');}

// ---- Tandy (3004): absent ----
// 1000:cc3a tandyDetect: F000:FFFE == FFh and F000:C000 == 21h. The port's ROM area is not a Tandy BIOS.
export function f1000_cc3a(){return frb(0xf000,0xfffe)===0xff&&frb(0xf000,0xc000)===0x21?1:0;}
export function f1000_cc58(){unsupported('1000:cc58 Tandy init');}
export function f1000_cc5c(){unsupported('1000:cc5c Tandy shutdown');}
export function f1000_cc7b(){unsupported('1000:cc7b Tandy raw out');return 0;}
export function f1000_cc7e(){unsupported('1000:cc7e Tandy note on');}
export function f1000_ccb3(){unsupported('1000:ccb3 Tandy note off');}
export function f1000_cccf(){unsupported('1000:cccf Tandy voices init');}
export function f1000_cd25(){unsupported('1000:cd25 Tandy patch');}
export function f1000_cd26(){unsupported('1000:cd26 Tandy tick');}

// ---- Device layer ----
// 1000:cd68 deviceDetect(desc): CALL [desc+4]
export function f1000_cd68(d){return near(rw(d+4));}
// 1000:cd72 deviceInstall(desc): shut down the old device, init, voice count, synth reset, timerSetSlot(8, tick, CS, shift).
// One pushed frame (8, [desc+14h], CS, byte [desc+16h]) serves init, d0ae and c4cc.
export function f1000_cd72(d){
 const old=rw(0x30d2);if(old)near(rw(old+8));
 ww(0x30d2,d);
 const shift=rb(d+0x16),tick=rw(d+0x14);
 near(rw(d+6));
 wb(d+0x17,rb(d+3));       // APPROX: assumes the init routine preserves BX (the speaker's d114 does)
 f1000_d0ae();
 F.f1000_c4cc(8,tick,gseg(0x1000),shift);
}
// 1000:cdac deviceUninstall: shutdown, [30d2] = 0, timerSetSlot(8, 0:0). The shift argument is not pushed (unread).
export function f1000_cdac(){
 const d=rw(0x30d2);if(d)near(rw(d+8));
 ww(0x30d2,0);
 F.f1000_c4cc(8,0,0,undefined);
}
// 1000:cdcc deviceRawOut(b): CALL [desc+0Ah] with AL = b. UNKNOWN: with [30d2] = 0 this calls the word at DS:000A.
export function f1000_cdcc(b){return near(rw(desc()+0xa),b&0xff);}

// Channel entry for (ch, note): split channels (flag 40h) map notes base..base+1Fh to entries 16+ and zero the note.
function chanEntry(ch,noteRef){
 let bx=(u16(ch)<<3)+0x31a0&0xffff;
 const ah=rb(bx);if(!ah)return 0;
 if(ah&0x40){
  let cx=noteRef.v;const cl=(cx&0xff)-rb(bx+4)&0xff;
  if(cl>=0x20)return 0;
  cx=(cx&0xff00|cl+0x10&0xff)<<3&0xffff;
  noteRef.v&=0xff00;
  bx=cx+0x31a0&0xffff;
 }
 return bx;
}
// 1000:cdda synthNoteOff(ch, note): finds the busy voice of this channel entry playing the note, moves it to the list head.
export function f1000_cdda(ch,note){
 const n={v:u16(note)};const bx=chanEntry(ch,n);if(!bx)return 0;
 const al=n.v&0xff;let s=0x30d4;
 for(;;){
  s=rw(s);if(rw(s)===0)return 0;
  if(rw(s+6)===bx&&rb(s+5)!==0&&rb(s+8)===al)break;
 }
 wb(s+5,0);
 let di=rw(s),b=rw(s+2);ww(b,di);ww(di+2,b);
 b=0x30d4;di=rw(b);ww(s,di);ww(s+2,b);ww(b,s);ww(di+2,s);
 near(rw(desc()+0xe),s);
 return 1;
}
// 1000:ce63 synthNoteOn(ch, note, vel): priority voice allocation over the list at 30d4.
export function f1000_ce63(ch,note,vel){
 const n={v:u16(note)};const bx=chanEntry(ch,n);if(!bx)return 0;
 const al=rb(bx+1),ah=rb(bx);let s=0x30d4;
 for(;;){
  s=rw(s);if(rw(s)===0)return 0;
  if(rb(s+5)>al)return 0;
  if(!(rb(s+4)&ah))continue;
  const di=rw(s+6);
  if(di===bx)break;
  if(rb(di+5)!==0){decb(di+5);incb(bx+5);ww(s+6,bx);break;}
 }
 wb(s+5,al);
 let di=rw(s),b=rw(s+2);ww(b,di);ww(di+2,b);
 while(rw(di)!==0){if(rb(di+5)>=al)break;b=di;di=rw(di);}
 ww(s,di);ww(s+2,b);ww(b,s);ww(di+2,s);
 const ent=bx,key=n.v&0xff;
 wb(s+8,key);wb(s+9,key+rb(ent+4));
 near(rw(desc()+0xc),s,u16(vel));
 return 1;
}
// 1000:cf19 aftertouch (no-op)
export function f1000_cf19(){}
// 1000:cf1a modulation (no-op)
export function f1000_cf1a(){}
// 1000:cf1b synthAllOff: every busy voice: [v+5] = 0, noteOff
export function f1000_cf1b(){
 let s=0x30d4;
 for(;;){s=rw(s);if(rw(s)===0)return;if(rb(s+5)!==0){wb(s+5,0);near(rw(desc()+0xe),s);}}
}
// 1000:cf43 synthProgram(ch, prog): [entry+3] = prog, [entry+6] = 3328 + 12*prog
export function f1000_cf43(ch,prog){const bx=(u16(ch)<<3)+0x31a0&0xffff;wb(bx+3,prog);ww(bx+6,u16(prog)*12+0x3328);}
// 1000:cf6b channel pressure (no-op)
export function f1000_cf6b(){}
// 1000:cf6c pitch bend (no-op)
export function f1000_cf6c(){}
// 1000:cf6d synthSysex(b): F0 starts, F7 ends; other bytes go to the state routine at [34c8].
export function f1000_cf6d(b){
 const ax=u16(b),al=ax&0xff;
 if(al===0xf0){ww(0x34c8,0xcf84);return;}
 if(al===0xf7){ww(0x34c8,0xcfdc);return;}
 near(rw(0x34c8),ax);
}
// 1000:cf84 sysexId (state): continue only for this device's id byte [desc+2]
export function f1000_cf84(ax){ww(0x34c8,(ax&0xff)===rb(desc()+2)?0xcf92:0xcfdc);}
// 1000:cf92 sysexCmd (state): cmd < 3 selects handler [34d0 + 2*cmd]
export function f1000_cf92(ax){if((ax&0xff)>=3){ww(0x34c8,0xcfdc);return;}ww(0x34ca,ax<<1&0xffff);ww(0x34c8,0xcfa0);}
// 1000:cfa0 sysexLen (state): [34cc] = length, then start collecting
export function f1000_cfa0(ax){wb(0x34cc,ax);sysexRestart();}
function sysexRestart(){wb(0x34cd,rb(0x34cc));ww(0x34ce,0x34a8);ww(0x34c8,0xcfaa);} // cfca-cfd9
// 1000:cfaa sysexData (state): collect bytes into 34a8; after [34cc] bytes run the command handler (SI = 34a8).
// QUIRK: a length of 0 collects 256 bytes (DEC byte).
export function f1000_cfaa(ax){
 const p=rw(0x34ce);wb(p,ax);ww(0x34ce,p+1);
 if(decb(0x34cd)!==0)return;
 near(rw(0x34d0+rw(0x34ca)),0x34a8);
 sysexRestart();
}
// 1000:cfdc sysexIgnore (state): POP BP / RETF
export function f1000_cfdc(){}
// 1000:cfde sysexChannelSetup (near, SI = buffer): channel entry mask, priority, voice reservation, program, flags.
// Literal translation of the voice-stealing loop, including its BX reload from the previous node (d04f).
export function f1000_cfde(src){
 let s=src;const lb=()=>{const v=rb(s);s=s+1&0xffff;return v;};
 let ax=lb();let bx=(ax<<3)+0x31a0&0xffff;
 wb(bx,lb());wb(bx+1,lb());
 let al=lb()-rb(bx+2)&0xff;
 if(al!==0){
  if(al&0x80){wb(bx+2,rb(bx+2)+al);wb(bx+5,rb(bx+5)-al);}
  else{
   let cx=al;let toScan=true;
   if(rb(bx+5)!==0){
    let z;do{incb(bx+2);z=decb(bx+5)===0;cx=cx-1&0xffff;}while(cx&&!z);
    if(cx===0)toScan=false;
   }
   if(toScan){
    const dl=rb(bx);let v=0x30d4,ins=v;
    for(;;){
     v=rw(v);const tail=rw(v)===0;cx=cx-1&0xffff;
     if(!(cx&&!tail))break;
     if(!(rb(v+4)&dl))continue;
     let di=rw(v+6);if(rb(di+5)===0)continue;
     decb(di+5);incb(bx+2);ww(v+6,bx);wb(v+5,0);
     di=rw(v);let b=rw(v+2);ww(b,di);ww(di+2,b);
     const prev=b;b=ins;
     di=rw(b);ww(v,di);ww(v+2,b);ww(b,v);ww(di+2,v);
     v=prev;ins=b;bx=rw(v+6);
    }
   }
  }
 }
 al=lb();wb(bx+3,al);ww(bx+6,al*12+0x3328&0xffff);
 al=lb();if(al&0x40)al|=0x80;wb(bx+4,al);
}
// 1000:d083 sysexPatch (near, SI = buffer): DI = 3328 + 12*byte, CALL [desc+12h]
export function f1000_d083(src){const di=rb(src)*12+0x3328&0xffff;near(rw(desc()+0x12),di,src+1&0xffff);}
// 1000:d09f sysexVoices (near, SI = buffer): [desc+17h] = byte, synthBuildVoices
export function f1000_d09f(src){wb(desc()+0x17,rb(src));f1000_d0c7();}
// 1000:d0ae synthReset: sysex state idle, clear the channel table 31a0 (0x180 bytes), then d0c7's body.
export function f1000_d0ae(){ww(0x34c8,0xcfdc);for(let i=0;i<0x180;i+=2)ww(0x31a0+i,0);f1000_d0c7();}
// 1000:d0c7 synthBuildVoices: list head 30d4 / tail 30d6, [desc+17h] voices of 12h bytes at 30da owned by the
// dummy channel entry 3320 (whose +5 byte 3325 holds the free count), then CALL [desc+10h].
export function f1000_d0c7(){
 const sh=0x30d4;let di=sh+2;ww(sh,di);ww(di+2,sh);
 let d=desc(),cx=rb(d+0x17);wb(0x3325,cx);
 for(let bx=0x30da;cx;cx--,bx+=0x12){
  ww(bx+6,0x3320);wb(bx+5,0);ww(bx,di);ww(bx+2,sh);ww(sh,bx);ww(di+2,bx);di=bx;
 }
 d=desc();ww(d+0x18,0x30da);near(rw(d+0x10));
}

// ---- PC speaker (34d6) ----
const pit2=v=>{outp(0x43,0xb6);outp(0x42,v&0xff);outp(0x42,v>>8&0xff);};
// 1000:d110 spkDetect: always present
export function f1000_d110(){return 1;}
// 1000:d114 spkInit: PIT ch2 mode B6h divisor 14h ([3506]), gate on
export function f1000_d114(){ww(0x3506,0x14);pit2(0x14);outp(0x61,inp(0x61)|3);}
// 1000:d12d spkShutdown: gate off
export function f1000_d12d(){outp(0x61,inp(0x61)&0xfc);}
// 1000:d136 spkRawOut: AX = 0 (use the built-in parser)
export function f1000_d136(){return 0;}
// 1000:d139 spkNoteOn(SI = voice): [v+0Ah] = key < 14 ? 14h : DS:3508[key-14]; written to PIT ch2 at once if voices <= 1
export function f1000_d139(v){
 const bx=rb(v+9)-0xe;const ax=bx<0?0x14:rw(0x3508+(bx<<1));
 ww(v+0xa,ax);if(rb(0x34ed)<=1)spkOut(ax);
}
// 1000:d159 spkNoteOff(SI = voice): [v+0Ah] = 14h, same voices <= 1 rule
export function f1000_d159(v){ww(v+0xa,0x14);if(rb(0x34ed)<=1)spkOut(0x14);}
function spkOut(ax){ww(0x3506,ax);pit2(ax);} // d167
// 1000:d17b spkVoicesInit: each voice [v+4] = 1, [v+0Ah] = 14h; round-robin pointer and count
export function f1000_d17b(){
 let s=rw(0x34ee);ww(0x3502,s);let cx=rb(0x34ed);wb(0x3505,cx);
 for(;cx;cx--,s+=0x12){wb(s+4,1);ww(s+0xa,0x14);}
}
// 1000:d19e spkPatch: RET
export function f1000_d19e(){}
// 1000:d19f spkTick: timer slot 8. Every 2nd call, with more than one voice, the next voice's divisor goes to PIT ch2.
export function f1000_d19f(){
 if(decb(0x3504)!==0)return;
 wb(0x3504,2);
 if(rb(0x34ed)<=1)return;
 let bx=rw(0x3502);const ax=rw(bx+0xa);
 if(rw(0x3506)!==ax){ww(0x3506,ax);pit2(ax);}
 bx=bx+0x12&0xffff;
 if(decb(0x3505)===0){wb(0x3505,rb(0x34ed));bx=rw(0x34ee);}
 ww(0x3502,bx);
}
// 1000:d1e8 spkRestoreDivisor: PIT ch2 mode B6h, divisor [3506]
export function f1000_d1e8(){pit2(rw(0x3506));}

// ---- MIDI output and built-in parser ----
// 1000:d1f8 midiOut(b): the device's raw out first; if it declines, the parser: data bytes go to the state
// routine at DS:37a0[[37bc]] (AX = byte, BX = state), status bytes select the next state.
export function f1000_d1f8(b){
 const ax=u16(b);
 if(f1000_cdcc(ax))return;
 const al=ax&0xff;
 if(al<0x80){const bx=rw(0x37bc);near(rw(0x37a0+bx),ax,bx);return;}
 if(al<0xf0){                                // d238
  ww(0x37be,ax&0xff0f);
  ww(0x37bc,(ax&0xff70)>>2);return;
 }
 if(al===0xf0){f1000_d218(ax);return;}
 if(al===0xf7){f1000_cf6d(ax);ww(0x37bc,0x12);return;}
 if(al===0xff){f1000_d0ae();ww(0x37bc,0x12);return;}
 if(al>=0xf8)return;
 ww(0x37bc,0x12);
}
// 1000:d218 parserSysex (state 16h, also F0): synthSysex(AX), state = 16h
export function f1000_d218(ax){f1000_cf6d(ax);ww(0x37bc,0x16);}
// 1000:d248 parserData1 (state): [37c0] = AX, state += 2
export function f1000_d248(ax,bx){ww(0x37c0,ax);ww(0x37bc,bx+2);}
// 1000:d250 parserNoteOff (state): synthNoteOff([37be], [37c0]). The state is kept.
export function f1000_d250(){f1000_cdda(rw(0x37be),rw(0x37c0));}
// 1000:d262 parserNoteOn (state): velocity 0 is note off
export function f1000_d262(ax){if((ax&0xff)===0)return f1000_d250();f1000_ce63(rw(0x37be),rw(0x37c0),ax);}
// 1000:d279 parserAftertouch (state): cf19 (no-op)
export function f1000_d279(ax){f1000_cf19(rw(0x37be),rw(0x37c0),ax);}
// 1000:d2a5 parserIgnore (state)
export function f1000_d2a5(){}
// 1000:d2a9 parserController (state): 1 mod wheel MSB, 21h LSB (into [37c2], cf1a no-op), >= 7Bh all off
export function f1000_d2a9(ax){
 const c=rw(0x37c0);
 if(c===1)ax=(ax>>8|ax<<8&0xff00)>>1;
 else if(c===0x21)ax=((ax^rw(0x37c2))&0x7f)^rw(0x37c2);
 else{if(c>=0x7b)f1000_cf1b();return;}
 ww(0x37c2,ax);f1000_cf1a(rw(0x37be),ax);
}
// 1000:d2e8 parserProgram (state): synthProgram([37be], AX)
export function f1000_d2e8(ax){f1000_cf43(rw(0x37be),ax);}
// 1000:d2f7 parserPressure (state): cf6b (no-op)
export function f1000_d2f7(ax){f1000_cf6b(rw(0x37be),ax);}
// 1000:d306 parserPitchBend (state): (AX byte-swapped >> 1) | [37c0] to cf6c (no-op)
export function f1000_d306(ax){f1000_cf6c(rw(0x37be),((ax>>8|ax<<8&0xff00)>>1|rw(0x37c0))&0xffff);}

// 1000:d31e udiv32(lo, hi, dlo, dhi): unsigned 32/32 shift-subtract divide. Returns 0 if either operand is 0 or
// the divisor exceeds the dividend. Returns the 32-bit quotient (DX:AX).
export function f1000_d31e(lo,hi,dlo,dhi){
 let n=(u16(hi)<<16|u16(lo))>>>0,d=(u16(dhi)<<16|u16(dlo))>>>0;
 if(!n||!d||d>n)return 0;
 while(!(n&0x80000000)){n=n<<1>>>0;d=d<<1>>>0;}
 let cx=0;do{cx++;if(d&0x80000000)break;d=d<<1>>>0;}while(true);
 let q=0;
 for(;;){
  if(!(d>n)){n=n-d>>>0;q=q+1>>>0;}
  if(--cx===0)break;
  q=q<<1>>>0;d=d>>>1;
 }
 return q;
}
// 1000:d384 ldivFar(a, b): far wrapper of the MSC long divide 1000:e80c. a and b are 32-bit longs.
export function f1000_d384(alo,ahi,blo,bhi){return ldiv(alo&0xffff|ahi<<16,blo&0xffff|bhi<<16)>>>0;}

export {f1000_c60a as musicPlay,f1000_c715 as musicStop,f1000_c731 as musicTick,f1000_d1f8 as midiOut,f1000_cd72 as deviceInstall,f1000_d19f as spkTick};

const ALL={f1000_c543,f1000_c54a,f1000_c552,f1000_c556,f1000_c55c,f1000_c562,f1000_c581,f1000_c597,f1000_c5ac,f1000_c5c7,f1000_c5f3,
 f1000_c60a,f1000_c6a3,f1000_c6c1,f1000_c6dc,f1000_c6fa,f1000_c715,f1000_c731,f1000_c7b1,f1000_c7bc,f1000_c7d8,f1000_c854,f1000_c88a,
 f1000_c897,f1000_c8a8,f1000_c8b9,f1000_c8c6,f1000_c8e5,f1000_c93e,f1000_c962,f1000_c963,f1000_c966,f1000_ca6d,f1000_ca95,f1000_cabc,
 f1000_cb3e,f1000_cb72,f1000_cbb6,f1000_cbd0,f1000_cbf7,f1000_cbfb,f1000_cbfc,f1000_cc2d,f1000_cc3a,f1000_cc58,f1000_cc5c,f1000_cc7b,
 f1000_cc7e,f1000_ccb3,f1000_cccf,f1000_cd25,f1000_cd26,f1000_cd68,f1000_cd72,f1000_cdac,f1000_cdcc,f1000_cdda,f1000_ce63,f1000_cf19,
 f1000_cf1a,f1000_cf1b,f1000_cf43,f1000_cf6b,f1000_cf6c,f1000_cf6d,f1000_cf84,f1000_cf92,f1000_cfa0,f1000_cfaa,f1000_cfdc,f1000_cfde,
 f1000_d083,f1000_d09f,f1000_d0ae,f1000_d0c7,f1000_d110,f1000_d114,f1000_d12d,f1000_d136,f1000_d139,f1000_d159,f1000_d17b,f1000_d19e,
 f1000_d19f,f1000_d1e8,f1000_d1f8,f1000_d218,f1000_d248,f1000_d250,f1000_d262,f1000_d279,f1000_d2a5,f1000_d2a9,f1000_d2e8,f1000_d2f7,
 f1000_d306,f1000_d31e,f1000_d384};
// Addresses stored in data: descriptor entries, handler tables 2d5b/2d69, parser states 37a0, sysex states [34c8]
// and handlers 34d0, timer slots (c731, descriptor +14h ticks).
for(const a of [0xc731,0xc7b1,0xc7bc,0xc7d8,0xc854,0xc88a,0xc897,0xc8a8,0xc8b9,
 0xc8e5,0xc93e,0xc962,0xc963,0xc966,0xca6d,0xca95,0xcabc,
 0xcb3e,0xcb72,0xcbb6,0xcbd0,0xcbf7,0xcbfb,0xcbfc,0xcc2d,
 0xcc3a,0xcc58,0xcc5c,0xcc7b,0xcc7e,0xccb3,0xcccf,0xcd25,0xcd26,
 0xd110,0xd114,0xd12d,0xd136,0xd139,0xd159,0xd17b,0xd19e,0xd19f,
 0xcf84,0xcf92,0xcfa0,0xcfaa,0xcfdc,0xcfde,0xd083,0xd09f,
 0xd218,0xd248,0xd250,0xd262,0xd279,0xd2a5,0xd2a9,0xd2e8,0xd2f7,0xd306])
 register(0x1000,a,ALL['f1000_'+a.toString(16)]);
provide(ALL);
