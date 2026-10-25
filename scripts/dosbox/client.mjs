// Minimal client for the dosbox-automation REST API (the MCP bridge talks to the same server).
const BASE=process.env.DOSBOX_API||'http://127.0.0.1:8386/api/v1';
async function call(method,path,body,raw=false){
 const r=await fetch(BASE+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${await r.text()}`);
 return raw?new Uint8Array(await r.arrayBuffer()):r.json();
}
export const api={
 status:()=>call('GET','/status'),
 cpu:()=>call('GET','/cpu/state'),
 pause:()=>call('POST','/debug/pause',{}),
 cont:()=>call('POST','/debug/continue',{}),
 debugStatus:()=>call('GET','/debug/status'),
 wait:(sinceStop,timeout=15000)=>call('GET',`/debug/wait?since_stop_id=${sinceStop}&timeout_ms=${timeout}`),
 addBreak:b=>call('POST','/debug/breakpoints',b),
 clearBreaks:()=>call('DELETE','/debug/breakpoints'),
 breaks:()=>call('GET','/debug/breakpoints'),
 // Linear read, raw bytes. Large reads are split to stay under the route's limits.
 async read(offset,len){const out=new Uint8Array(len);for(let p=0;p<len;p+=65536){const n=Math.min(65536,len-p);out.set(await call('GET',`/memory/${offset+p}/${n}`,null,true),p);}return out;},
 portIn:(port)=>call('GET',`/io/port?port=${port}`).then(r=>r.value),
 portOut:(port,value)=>call('PUT','/io/port',{port,value}),
 batch:(ops)=>call('POST','/batch',{ops}),
};
// Reads the four EGA/VGA planes through the graphics controller read-map register, restoring it afterwards.
export async function readPlanes(){
 const savedIdx=await api.portIn(0x3ce);
 await api.portOut(0x3ce,5);const mode=await api.portIn(0x3cf);
 await api.portOut(0x3ce,4);const map=await api.portIn(0x3cf);
 await api.portOut(0x3ce,5);await api.portOut(0x3cf,mode&~0x08); // read mode 0
 const planes=[];
 for(let p=0;p<4;p++){await api.portOut(0x3ce,4);await api.portOut(0x3cf,p);planes.push(await api.read(0xa0000,0x10000));}
 await api.portOut(0x3ce,4);await api.portOut(0x3cf,map);await api.portOut(0x3ce,5);await api.portOut(0x3cf,mode);await api.portOut(0x3ce,savedIdx);
 return {planes,gcMode:mode,gcReadMap:map};
}

// Reads the EGA-relevant register state (VGA ports are readable): GC 0-8, sequencer map mask, CRTC start, attribute palette.
export async function readVgaRegs(){
 const gIdx=await api.portIn(0x3ce),sIdx=await api.portIn(0x3c4),cIdx=await api.portIn(0x3d4);
 const gc=[];for(let i=0;i<9;i++){await api.portOut(0x3ce,i);gc.push(await api.portIn(0x3cf));}
 await api.portOut(0x3c4,2);const mapMask=await api.portIn(0x3c5);
 await api.portOut(0x3d4,0x0c);const sh=await api.portIn(0x3d5);await api.portOut(0x3d4,0x0d);const sl=await api.portIn(0x3d5);
 // Attribute controller: reading 3DA resets the flip-flop; index with bit 5 set keeps the display on.
 const attrIdx=await api.portIn(0x3c0);const palette=[];
 for(let i=0;i<16;i++){await api.portIn(0x3da);await api.portOut(0x3c0,i|0x20);palette.push(await api.portIn(0x3c1));}
 await api.portIn(0x3da);await api.portOut(0x3c0,attrIdx);
 await api.portOut(0x3ce,gIdx);await api.portOut(0x3c4,sIdx);await api.portOut(0x3d4,cIdx);
 return {gc,mapMask,start:sh<<8|sl,palette};
}
