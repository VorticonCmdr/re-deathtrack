// Width normalisation and 8086/MSC arithmetic semantics.
export const s8=x=>x<<24>>24, u8=x=>x&0xff, s16=x=>x<<16>>16, u16=x=>x&0xffff, s32=x=>x|0, u32=x=>x>>>0;
export class DivideError extends Error{}
// The original game hangs here (e.g. divide by zero under its own INT 0 handler).
export class HangError extends Error{}
// INT 0 behaviour: DOS default (fatal) unless INT 0 points at the game's handler 1ff8:3b1c, installed by
// 1ff8:3af2 during hardware init: on a fault it arithmetic-shifts the dividend right by one (SAR DX:AX for
// word divides, SAR AX for byte divides) and re-executes the divide (static, disassembly 1ff8:3b1c-3b55).
// The machine decides the mode from the live INT 0 vector (src/engine/machine.js).
export const divide={halving:()=>false,faults:0};
// Generic retry loop. a: dividend (signed 32-bit for word divides, signed 16-bit for byte divides).
function run(a,b,fits,q,halve){
 for(;;){
  if(b!==0){const r=q(a,b);if(fits(r))return [r,a];}
  if(!divide.halving())throw new DivideError(b===0?'Divide by zero':'Divide overflow');
  divide.faults++;
  const n=halve(a);if(n===a)throw new HangError(`Divide fault loops forever (dividend ${a}, divisor ${b})`);
  a=n;
 }
}
const sar32=a=>(a|0)>>1, sarAX=a=>s16(a)>>1;
const tq=(a,b)=>Math.trunc(a/b);
// IDIV r/m16 (DX:AX / r16). Callers with a CWD-extended 16-bit dividend pass it sign-extended.
export const idiv32_16=(a,b)=>run(a|0,s16(b),q=>q>=-32768&&q<=32767,tq,sar32)[0];
export const imod32_16=(a,b)=>{const [,d]=run(a|0,s16(b),q=>q>=-32768&&q<=32767,tq,sar32);return s16(d%s16(b));};
export const idiv16=(a,b)=>idiv32_16(s16(a),b), imod16=(a,b)=>imod32_16(s16(a),b);
// DIV r/m16 (unsigned DX:AX / r16); the handler still halves with SAR (sign-propagating).
const uq=(a,b)=>Math.floor((a>>>0)/b);
export const div32_16=(a,b)=>run(a|0,u16(b),q=>q<=65535,uq,sar32)[0];
export const mod32_16=(a,b)=>{const [,d]=run(a|0,u16(b),q=>q<=65535,uq,sar32);return (d>>>0)%u16(b);};
export const div16=(a,b)=>div32_16(u16(a),b), mod16=(a,b)=>mod32_16(u16(a),b);
// Byte divides: AX / r8 -> AL quotient, AH remainder.
export const idiv8=(a,b)=>run(s16(a),s8(b),q=>q>=-128&&q<=127,tq,sarAX)[0];
export const imod8=(a,b)=>{const [,d]=run(s16(a),s8(b),q=>q>=-128&&q<=127,tq,sarAX);return s8(d%s8(b));};
export const div8=(a,b)=>run(s16(a),u8(b),q=>q>=0&&q<=255,(x,y)=>Math.floor(u16(x)/y),sarAX)[0];
export const mod8=(a,b)=>{const [,d]=run(s16(a),u8(b),q=>q>=0&&q<=255,(x,y)=>Math.floor(u16(x)/y),sarAX);return u16(d)%u8(b);};
// 16x16 multiplies: IMUL/MUL produce a 32-bit DX:AX product.
export const imul16=(a,b)=>s16(a)*s16(b)|0;
export const mul16=(a,b)=>u16(a)*u16(b)>>>0;
// MSC long helpers (__aNlmul, __aNldiv, __aNlrem, __aNuldiv, __aNulrem, shifts).
export const lmul=(a,b)=>Math.imul(a,b);
export const ldiv=(a,b)=>{if(!(b|0))throw new DivideError('Long divide by zero');return Math.trunc((a|0)/(b|0))|0;};
export const lmod=(a,b)=>{if(!(b|0))throw new DivideError('Long divide by zero');return (a|0)%(b|0)|0;};
export const uldiv=(a,b)=>{if(!(b>>>0))throw new DivideError('Long divide by zero');return Math.floor((a>>>0)/(b>>>0))>>>0;};
export const ulmod=(a,b)=>{if(!(b>>>0))throw new DivideError('Long divide by zero');return (a>>>0)%(b>>>0)>>>0;};
export const lshl=(a,n)=>n>=32?0:a<<n|0, lsar=(a,n)=>a>>Math.min(n,31), lshr=(a,n)=>n>=32?0:a>>>n;
export const sar16=(x,n)=>s16(x)>>Math.min(n,15), shr16=(x,n)=>n>=16?0:u16(x)>>>n, shl16=(x,n)=>n>=16?0:u16(x<<n);
