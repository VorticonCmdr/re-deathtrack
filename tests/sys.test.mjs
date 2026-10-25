// Segment 1ff8 (sys) checks: stream codec against src/formats.js on every compressed stream in game/, chunk seeking,
// the keyboard ISR, the bitmap loader record for title.bmp, and the graphics library (polygon/line/clip, text/rect/
// ellipse/pixels). The MSC stdio, heap and string thunks are stubbed here over the machine's file system.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {chunks,unpack,u16 as le16} from '../src/formats.js';
import {createMachine,machine} from '../src/engine/machine.js';
import {rb,rw,wb,ww,wd,frb,frw,fww,putStr,strAt,DGROUP,gaddr,pseg} from '../src/engine/mem.js';
import {register,state,interrupt,IDLE} from '../src/engine/host.js';
import {installBios} from '../src/game/bios.js';
import {provide} from '../src/game/link.js';
import * as S from '../src/game/sys.js';

const R=new URL('../',import.meta.url).href;
const assets=await loadAssets();

// ---- test-local runtime stubs (MSC stdio over machine.fs, a bump near heap, strings) ----
const IOB=0x5446,files=new Map();let heap=0xc000;
const fsx=()=>machine.fs;
provide({
 f1000_c1a2(name,mode){ // fopen("rb")
  const h=fsx().open(strAt(name),0);if(h<0)return 0;
  for(let i=5;i<36;i++){const fp=IOB+8*i;if(!files.has(fp)){files.set(fp,h);wb(fp+6,1);wb(fp+7,h);return fp;}}
  return 0;},
 f1000_c1d6(fp,lo,hi,wh){const p=fsx().seek(files.get(fp),(hi<<16|lo)|0,wh);return p<0?0xffff:0;},
 f1000_c206(fp){return fsx().seek(files.get(fp),0,1)>>>0;},
 f1000_c214(buf,size,n,fp){const t=(size*n)&0xffff,got=fsx().read(files.get(fp),DGROUP,buf,t);return size?Math.floor(got/size):0;},
 f1000_c31a(fp){const b=salloc1();const got=fsx().read(files.get(fp),DGROUP,b,1);return got?rb(b):0xffff;},
 f1000_c256(fp){fsx().seek(files.get(fp),0,0);},
 f1000_c264(fp){fsx().close(files.get(fp));files.delete(fp);wb(fp+6,0);return 0;},
 f1000_c272(n){if(heap+n>0xff00)return 0;const p=heap;heap=(heap+n+1)&~1;return p;},
 f1000_c280(){},
 f1000_c308(n,sz){const t=n*sz;if(t>0xffff)return 0;const p=heap;if(heap+t>0xff00)return 0;heap=(heap+t+1)&~1;for(let i=0;i<t;i++)wb(p+i,0);return p;},
 f1000_c2ce(d,s){let i=0;for(;;i++){const c=rb(s+i);wb(d+i,c);if(!c)break;}return d;},
 f1000_c2f6(s,c){let r=0;for(let i=0;;i++){const v=rb(s+i);if(v===c)r=s+i;if(!v)break;}return r;},
 f1000_c298(d,s){let n=0;while(rb(d+n))n++;let i=0;for(;;i++){const c=rb(s+i);wb(d+n+i,c);if(!c)break;}return d;},
 f1000_044a(){throw Error('fatal exit 1000:044a');},
});
const salloc1=()=>0xbf00;
// No shipped file uses method 1 (RLE), so a synthetic RLE envelope is added: literals and runs of every length class,
// plus the 0x00 no-op. (0x80 is left out here: the original reads and discards a value byte after it, formats.js
// does not; a separate check covers it.)
function rleFile(){
 const body=[];let x=7;const rnd=()=>(x=x*1103515245+12345>>>0)>>>24;
 for(let i=0;i<120;i++){
  const k=rnd()%4;
  if(k===0){const n=rnd()&0x7f;body.push(n);for(let j=0;j<n;j++)body.push(rnd());}
  else if(k===1){body.push(0x80|(1+rnd()%127),rnd());}
  else if(k===2)body.push(0x00);
  else{body.push(0xff,rnd());}
 }
 const tmp=new Uint8Array([1,0,0,0,0,...body]);const size=unpackRle(tmp);
 tmp[1]=size&0xff;tmp[2]=size>>8&0xff;tmp[3]=size>>16&0xff;tmp[4]=0;return tmp;
}
function unpackRle(b){let o=0;for(let p=5;p<b.length;){const n=b[p++];if(n&0x80){p++;o+=n&0x7f;}else{p+=n;o+=n;}}return o;}
const RLE=rleFile();
// 0x80: zero-length run that still consumes its value byte (1ff8:0605 reads it before outFill).
const RLE80=new Uint8Array([1,4,0,0,0, 0x80,0x55, 0x82,0x11, 0x02,0x22,0x33]);
const files2=new Map([...assets,['RLETEST.MAP',RLE],['RLE80.DAT',RLE80]]);
function boot(){createMachine({assets:files2});files.clear();heap=0xc000;}
const str=(o,s)=>{putStr(o,s);return o;};
const NAME=0xbe00,PATH=0xbe40,MODE=0xbe60;

// ---- stream codec vs formats.js ----
function collect(){
 const out=[];
 for(const [name,data] of files2){
  if(name==='DTRACK.EXE'||name.endsWith('.EXE')||name.endsWith('.TRK')||name==='RLE80.DAT')continue;
  if(name.endsWith('.MAP')){out.push({name,whole:true,method:data[0],expect:unpack(data)});continue;}
  let tree;try{tree=chunks(data);}catch{continue;}
  if(!tree.length||!/^[A-Z ]{3}:$/.test(tree[0].name))continue;
  const counts={};
  const walk=(nodes,path)=>{for(const c of nodes){const p=path+c.name;
   if(c.children.length)walk(c.children,p);
   else{counts[p]=(counts[p]||0)+1;const m=c.data[0];if(m>2)continue;
    // compressed leaves: BIN: (BMP/SCR), SND: (.mus), TTM:, SND:IBM:
    if(!/(BIN:|^SND:|TTM:|IBM:)$/.test(p))continue;
    let expect;try{expect=unpack(c.data);}catch{continue;}
    out.push({name,path:p,n:counts[p],method:m,expect});}}};
  walk(tree,'');
 }
 return out;
}
function decode(st,step){
 let fp,len,h;const mark=heap; // the stub heap never frees: release this decode's allocations afterwards
 str(NAME,st.name);str(MODE,'r');
 if(st.whole){fp=S.f1ff8_4a48(NAME);len=files2.get(st.name).length;}
 else{fp=S.f1ff8_4a48(NAME);str(PATH,st.path);
  assert.notEqual(S.f1ff8_4ade(fp,PATH,st.n),0xffffffff,`seek ${st.name} ${st.path} #${st.n}`);
  len=S.f1ff8_4d72(fp);}
 if(st.whole)S.f1ff8_491e(S.f1ff8_48ea(fp)); // rewind to the envelope
 h=S.f1ff8_0d47(0,fp,MODE,len&0xffff,len>>>16);assert.notEqual(h,0xffff,`open ${st.name} ${st.path||""}`);
 assert.equal(S.f1ff8_1310(h),st.expect.length);
 const blk=S.f1ff8_3a88(st.expect.length+0x8000&0xffff,(st.expect.length+0x8000)>>>16,0);assert.ok(blk);
 let seg=pseg(blk),off=0,total=0;
 for(;;){const n=S.f1ff8_11f0(h,off,seg,step);total+=n;off+=n;if(off>0x7fff){seg+=off>>4;off&=15;}if(n<step)break;}
 const got=new Uint8Array(total);let s2=pseg(blk);for(let i=0;i<total;i++)got[i]=frb(s2+(i>>4),i&15);
 S.f1ff8_100d(h);S.f1ff8_4da4(fp);S.f1ff8_3ae2(0,pseg(blk));
 heap=mark;
 return got;
}
test('stream codec decodes every raw and LZW stream in game/ and a synthetic RLE stream like formats.js (several read sizes)',()=>{
 const all=collect();
 assert.ok(all.filter(s=>s.method===0).length>0,'no raw streams found');
 assert.ok(all.filter(s=>s.method===1).length>0,'no RLE streams found');
 assert.ok(all.filter(s=>s.method===2).length>=58,'expected at least 58 LZW streams');
 boot();
 let k=0;
 for(const st of all){
  const steps=k++<12?[0x7fff,7,1,128]:[0x7fff,1000];
  for(const step of steps){
   const got=decode(st,step);
   assert.equal(got.length,st.expect.length,`${st.name} ${st.path||''} step ${step} length`);
   assert.ok(Buffer.compare(Buffer.from(got),Buffer.from(st.expect))===0,`${st.name} ${st.path||''} step ${step} bytes`);
  }
 }
 assert.equal(state.diagnostics.length,0);
});

test('RLE control 0x80 consumes its value byte (differs from formats.js)',()=>{
 boot();
 const got=decode({name:'RLE80.DAT',whole:true,expect:new Uint8Array(4)},0x7fff);
 assert.deepEqual([...got],[0x11,0x11,0x22,0x33]);
});

// ---- chunk seeking ----
test('chunkSeek on bitmaps.blk: n-th match, n=0 unread/next, n=-1, invalid paths restore the slot',()=>{
 boot();
 const tree=chunks(assets.get('BITMAPS.BLK')),bins=tree.map(c=>c.offset+8+c.children[1].offset+8);
 const fp=S.f1ff8_4a48(str(NAME,'bitmaps.blk'));assert.ok(fp);
 assert.equal(S.f1ff8_4de0(fp),1);
 str(PATH,'BMP:BIN:');
 for(let i=1;i<=5;i++){assert.equal(S.f1ff8_4ade(fp,PATH,i),bins[i-1]);assert.equal(S.f1ff8_4d72(fp),tree[i-1].children[1].size);}
 assert.equal(S.f1ff8_4ade(fp,PATH,2),bins[1]);                // backwards: reset and search
 assert.equal(S.f1ff8_4ade(fp,PATH,0),bins[1]);                // unread: same chunk
 const b=0xbd00;assert.equal(S.f1ff8_4ade(fp,PATH,0),bins[1]);
 provideRead(fp,b);
 assert.equal(S.f1ff8_4ade(fp,PATH,0),bins[2]);                // consumed: next match
 assert.equal(S.f1ff8_4ade(fp,PATH,-1),bins[2]);
 assert.equal(S.f1ff8_4ade(fp,PATH,6),0xffffffff);             // past the end: -1, slot restored
 assert.equal(S.f1ff8_4ade(fp,PATH,-1),bins[2]);
 assert.equal(S.f1ff8_4ade(fp,str(PATH,'BMP:BI'),1),0xffffffff); // length not a multiple of 4
 // sequential INF reads with n=0 walk the BMP chunks in file order
 str(PATH,'BMP:INF:');
 for(let i=0;i<5;i++){const p=S.f1ff8_4ade(fp,PATH,i?0:1); /* a new path with n=0 would continue from the current position */assert.equal(p,tree[i].offset+16);provideRead(fp,b);}
 assert.equal(S.f1ff8_4da4(fp),1);assert.equal(S.f1ff8_4de0(fp),0);assert.equal(S.f1ff8_4da4(fp),0);
});
function provideRead(fp,b){S.f1ff8_4d72(fp);assert.equal(machine.fs.read(files.get(fp),DGROUP,b,1),1);}
test('chunkSeek on pals.blk: SND, PAL, PAL, BMP order and nested tags',()=>{
 boot();
 const tree=chunks(assets.get('PALS.BLK'));
 const fp=S.f1ff8_4a48(str(NAME,'PALS.BLK'));
 assert.equal(S.f1ff8_4ade(fp,str(PATH,'PAL:EGA:'),2),tree[2].offset+16);assert.equal(S.f1ff8_4d72(fp),128);
 assert.equal(S.f1ff8_4ade(fp,str(PATH,'SND:IBM:'),1),tree[0].offset+8+tree[0].children[1].offset+8);
 assert.equal(S.f1ff8_4ade(fp,str(PATH,'BMP:'),1),tree[3].offset+8);
 assert.equal(S.f1ff8_4ade(fp,str(PATH,'PAL:CGA:'),3),0xffffffff);
 S.f1ff8_4da4(fp);
 assert.equal(S.f1ff8_4a48(str(NAME,'NOFILE.BLK')),0);
});

// ---- keyboard ISR ----
function key(code,down=true){state.port60=down?code:code|0x80;interrupt(9);}
const run=g=>{let r;while(!(r=g.next()).done)assert.equal(r.value,IDLE);return r.value;};
const ring=()=>{const out=[];let h=frw(0x40,0x1a);const t=frw(0x40,0x1c);while(h!==t){out.push(frw(0x40,h));h+=2;if(h===0x3e)h=0x1e;}return out;};
test('INT 9 handler: held table, BIOS ring, dropped key, shift/caps/ctrl ASCII, stick direction',()=>{
 boot();installBios();
 assert.equal(S.f1ff8_40c7(1),1);
 assert.equal(frw(0,9*4),0x41ca);assert.equal(frw(0,0x1c*4),0x43a9);
 const lower=rb(0x4c02+0x1e),upper=rb(0x4c5b+0x1e);
 assert.equal(lower,0x61);assert.equal(upper,0x41);
 key(0x1e);
 assert.equal(run(S.f1ff8_44a0(0x1e)),1);
 assert.deepEqual(ring(),[0x1e61]);
 // QUIRK: with exactly one key pending the next one is dropped.
 key(0x30);assert.deepEqual(ring(),[0x1e61]);
 assert.equal(run(S.f1ff8_4457()),0x1e61);assert.equal(run(S.f1ff8_4457()),0);
 key(0x1e,false);assert.equal(run(S.f1ff8_44a0(0x1e)),0);
 // two keys queue once the ring is empty: first goes in, second is dropped; after reading, the next is accepted
 key(0x30);key(0x30,false);key(0x2e);key(0x2e,false);
 assert.deepEqual(ring(),[0x3062]);run(S.f1ff8_4457());
 // Shift held (scancode 2Ah sets 0040:0017 bit 1; no ring entry)
 key(0x2a);assert.equal(frb(0x40,0x17)&2,2);assert.deepEqual(ring(),[]);
 key(0x1e);assert.deepEqual(ring(),[0x1e00|upper]);run(S.f1ff8_4457());key(0x1e,false);
 key(0x2a,false);assert.equal(frb(0x40,0x17)&2,0);
 // CapsLock state: letters upper case
 fww(0x40,0x17,frb(0x40,0x17)|0x40);key(0x1e);assert.deepEqual(ring(),[0x1e41]);run(S.f1ff8_4457());key(0x1e,false);
 // Ctrl (bit 2): letter -> (a|0x80)-0x20
 fww(0x40,0x17,4);key(0x1e);assert.deepEqual(ring(),[0x1e00|((lower|0x80)-0x20)]);run(S.f1ff8_4457());key(0x1e,false);
 // scancodes >= 59h are ignored; releases do not enter the ring
 key(0x5a);assert.deepEqual(ring(),[]);
 // arrow key direction (table bits 3-7): pressing sets DS:4bb8, releasing clears it
 let sc=-1;for(let s=1;s<0x59;s++)if(rb(0x4cb4+s)&0xf0){sc=s;break;}
 assert.ok(sc>0);const st=rb(0x4cb4+sc);
 key(sc);assert.equal(rb(0x4bb8+(st>>3&1)),st>>4);
 assert.equal(run(S.f1ff8_4486(st>>3&1)),rb(0x4d23+(st>>4)));
 key(sc,false);assert.equal(rb(0x4bb8+(st>>3&1)),0);
 assert.equal(S.f1ff8_418c(),1);assert.notEqual(frw(0,9*4),0x41ca);
});

// ---- bitmap loader ----
test('loadBitmap(title.bmp) builds the handle, records (via the EGA driver slots 13/14), registry entry and DOS block',async()=>{
 const E=await import(R+'src/game/egadrv.js');const ega=await import(R+'src/engine/ega.js');
 boot();ega.setMode(0x0d);
 S.f1ff8_21bc(0x4d9c);
 // capture the packed pixels as slot 14 receives them, then run the real driver routine
 let conv=null;
 register(0x29f6,0x1f8d,(...a)=>{const n=a[3]|a[4]<<16,d=new Uint8Array(n);for(let i=0;i<n;i++)d[i]=frb(a[2]+(i>>4),a[1]+(i&15));conv={a,data:d};return E.f29f6_1f8d(...a);});
 const h=S.f1ff8_0006(str(NAME,'TITLE.BMP'));
 assert.ok(h);
 const bin=unpack(chunks(assets.get('TITLE.BMP'))[0].children[1].data);
 assert.equal(conv.a[0],h);assert.equal(conv.a[1],0);assert.equal(conv.a[3]|conv.a[4]<<16,bin.length);
 assert.deepEqual([...conv.data],[...bin]);
 const rec=rw(h);assert.equal(rw(h+2),0);
 const q=152*35/4;
 assert.deepEqual([rw(rec),rw(rec+2),rw(rec+4),rw(rec+6),rw(rec+8)],[conv.a[2],0,4*q,304,35]);
 assert.equal(rw(0x5af4+2*39),1);assert.equal(rw(0x5b44+2*39),h);
 const total=152*35+Math.floor(152*35/4);
 assert.equal(frw(conv.a[2]-1,3),Math.ceil(total/16));       // MCB paragraph count
 for(let i=0;i<4;i++)assert.equal(rw(0x8a98+0x44*i),0);       // file closed
 assert.equal(S.f1ff8_0590(h),1);
 S.f1ff8_0476(h);assert.equal(S.f1ff8_0590(h),0);assert.equal(frw(conv.a[2]-1,1),0); // block freed
});

// ---- adapter selection and INT 1Ch smoke checks ----
test('gfxSelectAdapter(0, 0x0f) selects EGA: table copy, init, page pointers, 0000:04F0',async()=>{
 await import(R+'src/game/egadrv.js'); // the real slot 0 (29f6:13b5) runs
 boot();
 assert.equal(S.f1ff8_20ff(0,0x0f),2);assert.equal(rb(0x385d),2);assert.equal(rw(0x3854),0xa000);
 for(let i=0;i<0x46;i++)assert.equal(rw(0x4924+2*i),rw(0x4d9c+2*i));
 assert.equal(rw(0x3856),rw(0x3854));assert.equal(rw(0x3858),rw(0x3852));assert.equal(frw(0,0x4f0),DGROUP);
});
test('INT 1Ch virtual stick integrates a held direction',()=>{
 boot();installBios();S.f1ff8_40c7(1);ww(0x4d19,5);
 for(let d=1;d<=8;d++){wb(0x4bb8,d);ww(0x4d0d,0);ww(0x4d11,0);interrupt(0x1c);
  assert.ok(rw(0x4d0d)||rw(0x4d11),`direction ${d} moved no axis`);}
 wb(0x4bb8,9);interrupt(0x1c);assert.equal(rw(0x4d0d),0);assert.equal(rw(0x4d11),0);
});

// ---- graphics library (merged from the polygon/line/clip and text/rect/ellipse checks) ----
// ---- graphics: polygon, line, clip (src/game/sys/poly.js) ----
{
// sys polygon/line/clip tests (fork G1). Merge into tests/sys.test.mjs.
const {loadAssets}=await import(R+'tests/assets.mjs');
const {createMachine}=await import(R+'src/engine/machine.js');
const {rw,rsw,ww,wb,wd,frsw,gaddr,DGROUP}=await import(R+'src/engine/mem.js');
const {register}=await import(R+'src/engine/host.js');
const P=await import(R+'src/game/sys/poly.js');

const assets=await loadAssets();
let calls=[];
function setup({clip=1,fill=1,line=0,fillc=0,box=[0,319,0,199]}={}){
 createMachine({assets});calls=[];
 register(0x29f6,0x19b1,(bx,cx,dx,si,es)=>{calls.push({slot:2,bx,cx,dx,si,es});});
 register(0x29f6,0x141a,si=>{calls.push({slot:27,si});});
 wd(0x4924+4*2,gaddr(0x29f6,0x19b1));wd(0x4924+4*27,gaddr(0x29f6,0x141a));
 ww(0x3843,box[0]);ww(0x3845,box[1]);ww(0x3847,box[2]);ww(0x3849,box[3]);
 wb(0x384b,clip);wb(0x384c,fill);wb(0x384e,line);wb(0x384d,fillc);
}
const setPoly=pts=>{ww(0x39dc,pts.length);pts.forEach(([x,y],i)=>{ww(0x38ec+2*i,x);ww(0x3914+2*i,y);});};
const getPoly=()=>{const n=rsw(0x39dc),r=[];for(let i=0;i<n;i++)r.push([rsw(0x38ec+2*i),rsw(0x3914+2*i)]);return r;};

test('clipPolygon leaves an inside polygon unchanged',()=>{
 setup();setPoly([[10,10],[50,10],[30,40]]);P.f1ff8_4df6();
 assert.deepEqual(getPoly(),[[10,10],[50,10],[30,40]]);
});
test('clipPolygon: one vertex left of xmin, intersections based on the in/out rule',()=>{
 setup({box:[0,319,0,199]});
 setPoly([[-10,0],[10,0],[10,20]]);P.f1ff8_4df6();
 // pass x, edges P->C: (10,20)->(-10,0): cp=0,cc=1 -> base C(-10,0): y=0+(20-0)*(0+10)/(10+10)=10 -> (0,10)
 // (-10,0)->(10,0): cp=1,cc=0 -> base P: y=0 -> (0,0), then C (10,0); (10,0)->(10,20): emit (10,20)
 assert.deepEqual(getPoly(),[[0,10],[0,0],[10,0],[10,20]]);
});
test('clipPolygon: IDIV truncates toward zero from the base point',()=>{
 setup({box:[0,319,0,199]});
 setPoly([[-3,0],[4,7],[4,0]]);P.f1ff8_4df6();
 // edge (4,0)->(-3,0) horizontal: base C: y=0+(0-0)*..=0 -> (0,0)
 // edge (-3,0)->(4,7): cp=1 base P: y=0+(7-0)*(0+3)/(4+3)=21/7=3 -> (0,3), then (4,7); then (4,0)
 assert.deepEqual(getPoly(),[[0,0],[0,3],[4,7],[4,0]]);
 setPoly([[-3,0],[4,8],[4,0]]);P.f1ff8_4df6();
 // (-3,0)->(4,8): 8*3/7 = 3.43 -> 3
 assert.deepEqual(getPoly(),[[0,0],[0,3],[4,8],[4,0]]);
 setPoly([[4,0],[4,8],[-3,8]]);P.f1ff8_4df6();
 // (4,8)->(-3,8) then (-3,8)->(4,0): cp=1 base P(-3,8): y=8+(0-8)*3/7=8-3=5 (trunc of -3.43 = -3)
 assert.deepEqual(getPoly(),[[0,5],[4,0],[4,8],[0,8]]); // first edge is last->first
});
test('clipPolygon: fully outside leaves 0 vertices and skips pass y',()=>{
 setup();setPoly([[-30,10],[-20,10],[-25,40]]);P.f1ff8_4df6();
 assert.equal(rsw(0x39dc),0);
});
test('drawLine without clipping orders points by unsigned x',()=>{
 setup({clip:0});P.f1ff8_2454(100,5,20,50);
 assert.deepEqual(calls,[{slot:2,bx:20,cx:50,dx:100,si:5,es:rw(0x3858)}]);
});
test('drawLine clip stages: ymin signed, xmax unsigned',()=>{
 setup();P.f1ff8_2454(10,-10,30,10);
 // ymin: first out: x1 = 10 + (30-10)*(0+10)/(10+10) = 20, y1=0
 assert.deepEqual(calls[0],{slot:2,bx:20,cx:0,dx:30,si:10,es:rw(0x3858)});
 calls=[];P.f1ff8_2454(300,100,340,120);
 // xmax: second out (unsigned 340>319): swap then clip: x=340,y=120 base: y = 120+(100-120)*(319-340)/(300-340) = 120-10.5 -> 120+(-20*-21)/-40 = 120-10 = 110
 assert.deepEqual(calls[0],{slot:2,bx:300,cx:100,dx:319,si:110,es:rw(0x3858)});
 calls=[];P.f1ff8_2454(-5,10,-1,20);assert.equal(calls.length,0); // both left of xmin
 calls=[];P.f1ff8_2454(10,10,20,-1);
 // y2=-1 is < ymin signed -> swap, clip at ymin
 // swapped: first=(20,-1) clipped: x=20+(10-20)*(0+1)/(10+1)=20+(-10/11=0)=20 -> (20,0); final order by x: (10,10)-(20,0)
 assert.deepEqual(calls[0],{slot:2,bx:10,cx:10,dx:20,si:0,es:rw(0x3858)});
});
test('drawPolygon filled square produces span rows and calls slot 27',()=>{
 setup({fill:1,line:0,fillc:0});
 const xs=0x100,ys=0x120;[[10,10],[13,10],[13,13],[10,13]].forEach(([x,y],i)=>{ww(xs+2*i,x);ww(ys+2*i,y);});
 const r=P.f1ff8_256d(4,xs,ys);
 const hdr=0x39f0+4*9;assert.equal(r,hdr);
 assert.equal(rw(hdr),10);assert.equal(rw(hdr+2),4);
 for(let y=10;y<=13;y++)assert.deepEqual([rsw(0x39f0+4*y),rsw(0x39f2+4*y)],[10,13],`row ${y}`);
 assert.deepEqual(calls,[{slot:27,si:hdr}]);
});
test('drawPolygon filled triangle span edges (steep + shallow)',()=>{
 setup({fill:1,line:0,fillc:0});
 const xs=0x100,ys=0x120;[[0,0],[8,4],[0,4]].forEach(([x,y],i)=>{ww(xs+2*i,x);ww(ys+2*i,y);});
 P.f1ff8_256d(3,xs,ys);
 const rows=[];for(let y=0;y<=4;y++)rows.push([rsw(0x39f0+4*y),rsw(0x39f2+4*y)]);
 // left edge vertical x=0; right edge (0,0)->(8,4): shallow, right word, starts at right point (8,4) going up:
 // I=(9)/(5)=1, F=(4<<16)/5=52428; x_k = 8 - k - floor(((k+1)*F-1)/65536)
 const F=Math.floor((4*65536)/5),xr=k=>8-k-Math.floor(((k+1)*F-1)/65536);
 assert.deepEqual(rows,[[0,xr(4)],[0,xr(3)],[0,xr(2)],[0,xr(1)],[0,8]]);
 assert.equal(calls.length,1);
});
test('drawPolygon outline closes the polygon with drawLine',()=>{
 setup({fill:0,clip:0});
 const xs=0x100,ys=0x120;[[0,0],[8,0],[0,4]].forEach(([x,y],i)=>{ww(xs+2*i,x);ww(ys+2*i,y);});
 assert.equal(P.f1ff8_256d(3,xs,ys),0);
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.slot===2));
});

}
// ---- graphics: text, rect, ellipse, pixels, dissolve (src/game/sys/draw.js) ----
{
// sys/draw.js checks: drawText clipping, drawRect slot sequence and dither phase, ellipse row tables,
// dissolveRect (1ff8:44b4) is tested with src/game/egadrv.js, which owns it.
const {loadAssets}=await import(R+'tests/assets.mjs');
const {createMachine}=await import(R+'src/engine/machine.js');
const {rb,rw,wb,ww,wd,gaddr,putStr}=await import(R+'src/engine/mem.js');
const {register,state}=await import(R+'src/engine/host.js');
const ega=await import(R+'src/engine/ega.js');
const D=await import(R+'src/game/sys/draw.js');
// drawLine (poly.js) reaches slot 2; its register objects are the drawn lines.
const lines=[];

const assets=await loadAssets();
const calls=[];
const SLOTS={2:0x19b1,1:0x16ec,10:0x1ece,11:0x1ddc,21:0x2344,22:0x238d};
function setup(){
 createMachine({assets});calls.length=0;if(lines)lines.length=0;
 for(const [n,off] of Object.entries(SLOTS)){
  register(0x29f6,off,(...a)=>{
   // register slots get positional registers (src/game/egadrv.js); record them as one object in a[0]
   if(+n===2){lines.push(a.slice(0,4));return 0;}
   if(+n===1)a=[{ax:a[0],dx:a[1],bp:a[2],es:a[3]}];
   else if(+n===10||+n===11)a=[{ax:a[0],bx:a[1],cx:a[2],dx:a[3],di:a[4],es:a[5]}];
   calls.push({slot:+n,a});return 0;});
  wd(0x4924+4*n,gaddr(0x29f6,off));
 }
 for(let y=0;y<200;y++)ww(0x3d3e+2*y,40*y);
 ww(0x3843,0);ww(0x3845,319);ww(0x3847,0);ww(0x3849,199);
 wb(0x385d,2);ww(0x3858,0xa200);ww(0x4d8c,0);
}

test('drawText: x clipping skips/stops glyphs; a string whose bottom row is ymax is not drawn',()=>{
 setup();wb(0x3874,8);wb(0x3888,8);wb(0x384b,1);ww(0x3843,10);ww(0x3845,27);
 putStr(0xb000,'ABCD');
 D.f1ff8_23ba(0xb000,4,191);
 // A at x=4 < xmin skipped; B at 12, C at 20 (20+7=27 <= xmax), D at 28 stops the string.
 assert.deepEqual(calls.map(c=>[c.a[0].ax,c.a[0].dx,c.a[0].bp,c.a[0].es]),[[0x42,12,191,0xa200],[0x43,20,191,0xa200]]);
 calls.length=0;D.f1ff8_23ba(0xb000,12,192);assert.equal(calls.length,0); // 192+8=200 > 199
 calls.length=0;D.f1ff8_23ba(0xb000,12,-1);assert.equal(calls.length,0);
 wb(0x384b,0);calls.length=0;D.f1ff8_23ba(0xb000,4,192);assert.equal(calls.length,4);
});

test('drawRect: outline lines, top/bottom solid spans, dithered fill with even rows on the 4424 word',()=>{
 setup();wb(0x384b,1);wb(0x384c,1);wb(0x384e,1);wb(0x384d,2);
 ww(0x41a4+2,0x0505);ww(0x41a4+4,0x1234);ww(0x4424+4,0x4321);
 D.f1ff8_3810(10,20,5,4);
 assert.deepEqual(lines,[[10,20,10,23],[14,20,14,23]]);
 const s=calls.map(c=>[c.slot,c.a[0].bx,c.a[0].cx,c.a[0].di/40,c.a[0].ax,c.a[0].dx]);
 assert.deepEqual(s,[[10,11,3,20,0x0505,0],[10,11,3,23,0x0505,0],[11,11,3,21,0x1234,0x4321],[11,11,3,22,0x1234,0x4321]]); // slot 10 ignores DX (passed as 0)
 assert.equal(rw(0x386a),1); // phase set once from row 21 (slot 11 itself toggles it)
 assert.equal(rd32(0x3870),gaddr(0x29f6,0x1ddc));
 // Clipped left and top: no left line, no top span.
 setup();wb(0x384b,1);wb(0x384c,0);wb(0x384e,1);ww(0x3843,12);ww(0x3847,21);
 D.f1ff8_3810(10,20,5,4);
 assert.deepEqual(lines,[[14,21,14,23]]);
 assert.deepEqual(calls.map(c=>[c.slot,c.a[0].bx,c.a[0].cx,c.a[0].di/40]),[[10,12,2,23]]);
 // w=1 unclipped: the original corrupts its stack.
 setup();wb(0x384c,1);wb(0x384e,1);wb(0x384d,2);
 assert.throws(()=>D.f1ff8_3810(10,20,1,4),/stack corruption/);
});
const rd32=o=>(rw(o)|rw(o+2)<<16)>>>0;

test('drawEllipse r=4: row tables and spans from the midpoint walk',()=>{
 setup();wb(0x384b,0);wb(0x384c,1);wb(0x384e,1);wb(0x384d,1);
 ww(0x41a4+2,0x0101);ww(0x4424+2,0x0101);
 D.f1ff8_3194(4,100,50);
 const tab=o=>[0,1,2,3,4].map(k=>rb(o+k));
 assert.deepEqual(tab(0x49ec),[3,1,1,0,0]);
 assert.deepEqual(tab(0x4a53),[4,3,1,2,1]);
 assert.deepEqual(tab(0x4aba),[0,2,6,6,8]);
 // L = 100-5 = 95. Row k: outline [in,in+out), fill, outline.
 const rows=calls.map(c=>[c.a[0].di/40,c.a[0].bx,c.a[0].cx]);
 const row=(r,k)=>{const i=[3,1,1,0,0][k],o=[4,3,1,2,1][k],f=[0,2,6,6,8][k];
  return f?[[r,95+i,o],[r,95+i+o,f],[r,95+i+o+f,o]]:[[r,95+i,o]];};
 const want=[...row(46,0),...row(47,1),...row(48,2),...row(49,3),...row(50,4),...row(51,3),...row(52,2),...row(53,1),...row(54,0)];
 assert.deepEqual(rows,want);
 assert.ok(calls.every(c=>c.slot===10));
});

test('drawEllipse: r>=52 draws nothing (signed byte compare against W>=128)',()=>{
 setup();wb(0x384b,0);wb(0x384c,1);
 D.f1ff8_3194(60,160,100);assert.equal(calls.length,0);
 setup();D.f1ff8_3194(51,160,100);assert.ok(calls.length>0);
 setup();wb(0x384d,7);D.f1ff8_3194(1,5,6);assert.deepEqual(calls.map(c=>[c.slot,...c.a]),[[22,5,6,7]]);
});

test('clipped pixels return FFFFh outside the box',()=>{
 setup();wb(0x384b,1);ww(0x3843,5);
 assert.equal(D.f1ff8_3cf9(4,0),0xffff);assert.equal(D.f1ff8_3d2b(5,200,1),0xffff);assert.equal(calls.length,0);
 D.f1ff8_3cf9(5,0);D.f1ff8_3d2b(319,199,3);assert.deepEqual(calls.map(c=>[c.slot,...c.a]),[[21,5,0],[22,319,199,3]]);
});


}
