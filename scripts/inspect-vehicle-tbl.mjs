import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {importTBL,exportTBL,inspectTBL} from '../src/vehicle-editor/original.js';
import {validate,applyOperation} from '../src/vehicle-editor/model.js';
import {models} from '../src/viewer/decode.js';
let count=0;
for(const filename of (await readdir('game')).filter(f=>/\.tbl$/i.test(f))){
 const bytes=await readFile('game/'+filename);
 for(const {index} of inspectTBL(bytes)){
  const doc=validate(importTBL(bytes,filename,index));assert.deepEqual(Buffer.from(exportTBL(doc)),bytes,`${filename}/${index}: lossless`);
  for(const operation of [{translate:[.05,0,0]},{rotate:[0,90,0]},{scale:[1.1,1,1]}]){
   const edited=applyOperation(doc,{type:'transform',partId:doc.parts[0].id,...operation}),result=exportTBL(edited);
   assert.equal(result.length,bytes.length);const before=models(bytes),after=models(result);assert.equal(after.length,before.length);
   for(let i=0;i<before.length;i++)if(i!==index)assert.deepEqual(after[i],before[i],`Untouched model ${i}`);
   const imported=importTBL(result,filename,index);assert.deepEqual(imported.parts[0].vertices,edited.parts[0].vertices.map(v=>v.map(x=>Math.round(x/.05)*.05||0)));assert.deepEqual(Buffer.from(exportTBL(imported)),Buffer.from(result));
  }
  assert.throws(()=>applyOperation(doc,{type:'remove',partId:doc.parts[0].id}),/topology/);count++;
 }
}
const bytes=await readFile('game/mycar0.tbl'),doc=importTBL(bytes,'mycar0.tbl'),p=doc.parts[0],position=[...p.vertices[0]];position[0]+=.05;
const edited=applyOperation(doc,{type:'vertex',partId:p.id,index:0,position}),result=exportTBL(edited);
assert.equal(models(result)[0].vertices[0].x,models(bytes)[0].vertices[0].x+1);
assert.throws(()=>importTBL(new Uint8Array([0,1,2])));
assert.throws(()=>exportTBL({...doc,parts:[]}));
console.log(`PASS: ${count} models: exact round trips, translation/rotation/scale, untouched models, edited-file reimport; vertex edit and invalid inputs.`);
