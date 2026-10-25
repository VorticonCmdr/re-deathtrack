// Standard MIDI file parsing. MT-32 SysEx is preserved on export, ignored by audition.
export function midiNotes(b){
 const view=new DataView(b.buffer,b.byteOffset,b.byteLength);const be32=p=>view.getUint32(p);const be16=p=>view.getUint16(p);
 if(String.fromCharCode(...b.slice(0,4))!=='MThd')throw Error('Not a MIDI file');
 const division=be16(12);if(division&0x8000)throw Error('SMPTE timing unsupported');
 const events=[];let p=8+be32(4);
 while(p<b.length){const end=p+8+be32(p+4);p+=8;let tick=0,status=0;
  const byte=()=>{if(p>=end)throw Error('Truncated MIDI event');return b[p++];};
  const vlq=()=>{let n=0,v;for(let i=0;i<4;i++){v=byte();n=n*128+(v&127);if(!(v&128))return n;}throw Error('Invalid MIDI delta');};
  while(p<end){tick+=vlq();let s=byte();if(s<128){p--;s=status;}else if(s<240)status=s;
   if(s===255){const type=byte(),len=vlq();if(type===81&&len===3)events.push({tick,tempo:b[p]*65536+b[p+1]*256+b[p+2]});p+=len;}
   else if(s===240||s===247){const len=vlq();p+=len;}
   else if(s>=128&&s<240){const a=byte(),kind=s>>4,c=s&15,v=(kind===12||kind===13)?0:byte();if(kind===8||kind===9)events.push({tick,c,note:a,on:kind===9&&v>0,velocity:v});}
   else throw Error(`Unsupported MIDI status ${s}`);
  }if(p!==end)throw Error('MIDI event exceeds track');
 }
 events.sort((a,b)=>a.tick-b.tick);let tick=0,time=0,tempo=500000;const active=new Map(),notes=[];
 for(const e of events){time+=(e.tick-tick)*tempo/1e6/division;tick=e.tick;if(e.tempo){tempo=e.tempo;continue;}const key=e.c*128+e.note;
 if(active.has(key)){const n=active.get(key);n.duration=time-n.time;notes.push(n);active.delete(key);}if(e.on)active.set(key,{time,note:e.note,channel:e.c,velocity:e.velocity,duration:0});}
 for(const n of active.values()){n.duration=Math.max(.1,time-n.time);notes.push(n);}return {notes,duration:time};
}
let context;
export async function stopAudio(){if(context){const old=context;context=null;await old.close();}}
export async function playMidi(b,volume=.12){await stopAudio();const score=midiNotes(b);const ctx=new AudioContext();context=ctx;await ctx.resume();const gain=ctx.createGain();gain.gain.value=volume;gain.connect(ctx.destination);const origin=ctx.currentTime+.08;
 for(const n of score.notes){if(n.duration<=0)continue;const osc=ctx.createOscillator(),env=ctx.createGain();osc.type=n.channel===9?'triangle':'square';osc.frequency.value=440*2**((n.note-69)/12);osc.connect(env);env.connect(gain);const start=origin+n.time,end=start+n.duration;env.gain.setValueAtTime(0,start);env.gain.linearRampToValueAtTime(n.velocity/127*.15,start+.005);env.gain.setValueAtTime(n.velocity/127*.15,Math.max(start+.005,end-.015));env.gain.linearRampToValueAtTime(0,end+.01);osc.start(start);osc.stop(end+.02);}return score;
}
