// Persists files the game writes (hi_score, saves) in localStorage, keyed by DOS file name.
export function browserStorage(prefix='deathtrack:'){
 const get=k=>{try{return localStorage.getItem(prefix+k);}catch{return null;}};
 return {
  read(name){const v=get(name);if(v==null)return null;const s=atob(v),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b;},
  write(name,data){try{localStorage.setItem(prefix+name,btoa(String.fromCharCode(...data)));}catch(e){console.warn('Save failed',e);}},
  keys(){const r=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith(prefix))r.push(k.slice(prefix.length));}}catch{}return r;},
 };
}
export function memoryStorage(){const m=new Map();return {read:n=>m.get(n)||null,write:(n,d)=>m.set(n,d.slice()),keys:()=>[...m.keys()],map:m};}
