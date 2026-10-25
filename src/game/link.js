// Late-bound table of translated functions by Ghidra address name (e.g. F.f1ff8_4a48).
// Modules publish with provide(); a call to a function nobody provided fails with its address.
const table=Object.create(null);
export const F=new Proxy(table,{get(t,k){const f=t[k];if(f)return f;if(typeof k!=='string'||!/^f[0-9a-f]{4}_[0-9a-f]{4}$/.test(k))return undefined;throw new Error(`Untranslated function ${k}`);}});
export function provide(fns){for(const [k,v] of Object.entries(fns)){if(!/^f[0-9a-f]{4}_[0-9a-f]{4}$/.test(k))continue;if(table[k]&&table[k]!==v)throw new Error(`Duplicate translation of ${k}`);table[k]=v;}}
export const provided=()=>Object.keys(table);
// Tests only: replace translations with stubs (and restore them afterwards).
export function override(fns){const saved={};for(const [k,v] of Object.entries(fns)){saved[k]=table[k];table[k]=v;}return ()=>{for(const [k,v] of Object.entries(saved)){if(v)table[k]=v;else delete table[k];}};}
