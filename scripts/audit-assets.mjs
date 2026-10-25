import {readdir,readFile} from 'node:fs/promises';
import {chunks,images,unpack,tag} from '../src/formats.js';
import {midiNotes} from '../src/audio.js';
let files=0,frames=0,music=0,maps=0,fonts=0,failures=0;
for(const name of await readdir('game')){
 if(name.startsWith('.'))continue;files++;
 const b=new Uint8Array(await readFile('game/'+name));
 try{
  if(/^[A-Z0-9]{3}:$/.test(tag(b))&&tag(b)!=='TRK:'){
   const cs=chunks(b);frames+=images(cs).length;
   for(const c of cs){if(c.name==='FNT:'){const[w,h,,count]=c.data;if(4+count*h*Math.ceil(w/8)!==c.size)throw Error('Invalid font dimensions');fonts++;}
    if(c.name==='SND:'&&!c.children.length){const d=unpack(c.data);const score=midiNotes(d);if(!score.notes.length)throw Error('No MIDI notes');music++;console.log(`${name}: ${score.notes.length} notes, ${score.duration.toFixed(1)} s`);}
    if(c.name==='TTM:')unpack(c.data);
   }
  }
  if(name.endsWith('.map')){unpack(b);maps++;}
 }catch(e){failures++;console.error(name,e.message);}
}
console.log({files,frames,music,maps,fonts,failures});process.exitCode=failures?1:0;
