// Width normalisation and 8086/MSC arithmetic semantics.
export const s8=x=>x<<24>>24, u8=x=>x&0xff, s16=x=>x<<16>>16, u16=x=>x&0xffff, s32=x=>x|0, u32=x=>x>>>0;
export class DivideError extends Error{}
const chk=(q,lo,hi)=>{if(q<lo||q>hi)throw new DivideError('Divide overflow');return q;};
// IDIV r/m16 with a sign-extended (CWD) dividend: quotient truncates toward zero.
export const idiv16=(a,b)=>{b=s16(b);if(!b)throw new DivideError('Divide by zero');return chk(Math.trunc(s16(a)/b),-32768,32767);};
export const imod16=(a,b)=>{b=s16(b);if(!b)throw new DivideError('Divide by zero');return s16(a)%b;};
// IDIV with a full 32-bit DX:AX dividend.
export const idiv32_16=(a,b)=>{b=s16(b);if(!b)throw new DivideError('Divide by zero');return chk(Math.trunc((a|0)/b),-32768,32767);};
export const imod32_16=(a,b)=>{b=s16(b);if(!b)throw new DivideError('Divide by zero');return s16((a|0)%b);};
export const div16=(a,b)=>{b=u16(b);if(!b)throw new DivideError('Divide by zero');return chk(Math.floor(u16(a)/b),0,65535);};
export const mod16=(a,b)=>{b=u16(b);if(!b)throw new DivideError('Divide by zero');return u16(a)%b;};
export const div32_16=(a,b)=>{b=u16(b);if(!b)throw new DivideError('Divide by zero');return chk(Math.floor((a>>>0)/b),0,65535);};
export const mod32_16=(a,b)=>{b=u16(b);if(!b)throw new DivideError('Divide by zero');return (a>>>0)%b;};
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
