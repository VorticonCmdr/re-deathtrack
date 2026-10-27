// Structural and semantic audit of every local resource, using the same parsers as the viewer.
import {readdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chunks,images,unpack,tag} from '../src/formats.js';
import {midiNotes} from '../src/audio.js';
import {skyline,track,models,palettes,soundBank,titleScript,highScores} from '../src/viewer/decode.js';
import {effectTrace,effectPCM,wav} from '../src/viewer/effects.js';
const stats={files:0,frames:0,music:0,maps:0,skylineStrips:0,tracks:0,models:0,groups:0,faces:0,fonts:0,palettes:0,effects:0,scriptCommands:0,highScores:0,failures:0};
const read=async n=>new Uint8Array(await readFile('game/'+n));
const exe=await read('DTRACK.EXE');let shapeCount=0;const objectModels=[];
for(const name of await readdir('game')){
 if(name.startsWith('.'))continue;stats.files++;
 try{
  const b=await read(name);
  if(/^[A-Z0-9]{3}:$/.test(tag(b))&&!['TRK:','RAC:'].includes(tag(b))){
   const cs=chunks(b);stats.frames+=images(cs).length;stats.palettes+=palettes(cs).length;
   for(const c of cs){
    if(c.name==='FNT:'){const[w,h,,count]=c.data;assert.equal(4+count*h*Math.ceil(w/8),c.size);stats.fonts++;}
    if(c.name==='SND:'&&!c.children.length){const score=midiNotes(unpack(c.data));assert.ok(score.notes.length);assert.ok(score.notes.every(n=>Number.isFinite(n.time)&&n.duration>=0));stats.music++;console.log(`${name}: ${score.notes.length} notes, ${score.duration.toFixed(1)} s`);}
    if(c.name==='TTM:')stats.scriptCommands+=titleScript(unpack(c.data)).length;
   }
   const bank=soundBank(cs);
   if(bank)for(const e of bank.effects){
    // Three device timer rates share the actual translated voice interpreter.
    for(const hz of [1193182/4096,1193182/8192,1193182/512]){
     const trace=effectTrace(exe,b,bank,e.index,hz),pcm=effectPCM(trace),wave=wav(pcm);
     assert.ok(trace.duration>0&&trace.duration<15);assert.ok(pcm.some(v=>Math.abs(v)>.01));assert.ok(pcm.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));assert.equal(wave.length,44+pcm.length*2);
    }stats.effects++;
   }
  }
  if(name.endsWith('.map')){const sky=skyline(b);assert.equal(sky.panorama.width,1920);assert.equal(sky.panorama.height,25);stats.maps++;stats.skylineStrips+=sky.strips.length;}
  if(name.endsWith('.trk')){const tr=track(b);assert.ok(tr.points.length>2);objectModels.push(...tr.objects.map(o=>o.shape));stats.tracks++;}
  if(name.endsWith('.tbl')){const data=models(b);stats.models+=data.length;if(name==='shape.tbl')shapeCount=data.length;for(const m of data)for(const d of m.details){assert.ok(d.reference<m.vertices.length);stats.groups+=d.groups.length;for(const g of d.groups){assert.ok(g.sortVertex<m.vertices.length);stats.faces+=g.faces.length;}}}
  if(name.toLowerCase()==='hi_score')stats.highScores+=highScores(b).length;
 }catch(e){stats.failures++;console.error(name,e.message);}
}
try{assert.ok(objectModels.every(i=>i<shapeCount),'Roadside model indices must resolve in shape.tbl');assert.equal(stats.models,136);assert.equal(stats.groups,1195);assert.equal(stats.faces,3525);assert.equal(stats.effects,11);assert.equal(stats.scriptCommands,88);}catch(e){stats.failures++;console.error(e.message);}
console.log(stats);process.exitCode=stats.failures?1:0;
