import {importTBL,inspectTBL,exportTBL} from '../src/vehicle-editor/original.js';
import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newVehicle,validate,applyOperation,toOBJ,uid} from '../src/vehicle-editor/model.js';
const game=fileURLToPath(new URL('../game/',import.meta.url));
const originals=async()=> (await readdir(game)).filter(f=>/^(mycar[0-2]|angel|crimson|lurker|maniac|mega|melissa|menace|sly|wrecker|shape)\.tbl$/i.test(f));
async function source(input){if(input.base64){if(typeof input.base64!=='string'||input.base64.length>1400000||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw Error('Invalid TBL data');return Buffer.from(input.base64,'base64');}const filename=(await originals()).find(f=>f.toLowerCase()===String(input.filename).toLowerCase());if(!filename)throw Error('Choose an original TBL from the library.');return readFile(path.join(game,filename));}
const root=fileURLToPath(new URL('../.local/vehicles/',import.meta.url));let queue=Promise.resolve();
const file=id=>{if(!/^[a-z0-9-]{1,80}$/i.test(id))throw Error('Invalid project ID');return path.join(root,id+'.json');};
async function load(id){return JSON.parse(await readFile(file(id),'utf8'));}
async function save(p){await mkdir(root,{recursive:true});const tmp=file(p.id)+'.tmp';await writeFile(tmp,JSON.stringify(p));await rename(tmp,file(p.id));return p;}
const view=p=>({id:p.id,revision:p.revision,document:p.document,canUndo:p.undo.length>0,canRedo:p.redo.length>0});
export function execute(action,input={}){const task=queue.then(async()=>{
 await mkdir(root,{recursive:true});
 if(action==='originals')return originals();
 if(action==='inspect-original')return inspectTBL(await source(input));
 if(action==='import-original'){const document=validate(importTBL(await source(input),String(input.filename??'vehicle.tbl').replace(/[^a-z0-9_.-]/gi,'_').slice(0,64),input.modelIndex??0));return view(await save({id:uid(),revision:1,document,undo:[],redo:[]}));}
 if(action==='list'){const files=(await readdir(root)).filter(f=>f.endsWith('.json'));return Promise.all(files.map(async f=>{const p=await load(f.slice(0,-5));return {id:p.id,name:p.document.name,revision:p.revision};}));}
 if(action==='create'){if(input.preset&&!['blank','interceptor'].includes(input.preset))throw Error('Unknown preset');const p={id:uid(),revision:1,document:validate(input.document??newVehicle(input.name??'Untitled vehicle',input.preset)),undo:[],redo:[]};if(p.document.original)exportTBL(p.document);return view(await save(p));}
 const p=await load(input.id);if(action==='get')return view(p);if(action==='export'&&input.format==='tbl')return {format:'tbl',filename:p.document.original?.filename,base64:Buffer.from(exportTBL(p.document)).toString('base64')};if(action==='export')return {text:input.format==='obj'?toOBJ(p.document):JSON.stringify(p.document,null,2),format:input.format??'json'};
 if(input.revision!==p.revision)throw Error('Revision conflict. Reload the project before editing; your change was not applied.');
 if(action==='edit'||action==='replace'){const next=action==='replace'?validate(input.document):applyOperation(p.document,input.operation);if(next.original)exportTBL(next);p.undo.push(p.document);p.undo=p.undo.slice(-40);p.document=next;p.redo=[];}
 else if(action==='undo'||action==='redo'){const from=action==='undo'?p.undo:p.redo,to=action==='undo'?p.redo:p.undo;if(!from.length)throw Error('No history available.');to.push(p.document);p.document=from.pop();}
 else throw Error('Unknown action');p.revision++;return view(await save(p));
 });queue=task.catch(()=>{});return task;}
export function vehicleApi(req,res,next){
 if(!req.url?.startsWith('/__vehicles/'))return next();
 const respond=(status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
 const origin=req.headers.origin;try{if(origin&&!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname))return respond(403,{error:'Local workspace only'});}catch{return respond(403,{error:'Invalid origin'});}
 if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))return respond(405,{error:'JSON POST required'});
 let body='',size=0;req.on('data',chunk=>{size+=chunk.length;if(size>3e6){respond(413,{error:'Project is too large'});req.destroy();}else body+=chunk;});req.on('end',async()=>{try{const action=req.url.slice('/__vehicles/'.length).split('?')[0],result=await execute(action,JSON.parse(body||'{}'));respond(200,result);}catch(e){respond(e.message.includes('Revision conflict')?409:400,{error:e.message});}});
}
