import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('.local/vehicle-review',{recursive:true});
const client=new Client({name:'foundry-review',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:['server/vehicle-mcp.mjs'],cwd:process.cwd()}));
async function call(name,args){const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);}
const tools=await client.listTools();assert.equal(tools.tools.length,10);
let p=await call('vehicle_create',{name:'MCP / Marauder',preset:'interceptor'});const id=p.id;
p=await call('vehicle_edit',{id,revision:p.revision,operation:{type:'add',kind:'box',name:'Left armored sill',size:[.16,.24,2.5],position:[-1.04,.63,0],color:'#d89c68'}});const partId=p.document.parts.at(-1).id;let old=p;
p=await call('vehicle_edit',{id,revision:p.revision,operation:{type:'duplicate',partId,mirror:true}});assert.equal(p.document.parts.at(-1).vertices[0][0],-old.document.parts.at(-1).vertices[0][0]);
const stale=await client.callTool({name:'vehicle_edit',arguments:{id,revision:old.revision,operation:{type:'rename',name:'STALE'}}});assert(stale.isError);
p=await call('vehicle_undo',{id,revision:p.revision});assert.equal(p.document.parts.length,15);p=await call('vehicle_redo',{id,revision:p.revision});assert.equal(p.document.parts.length,16);
const cockpit=p.document.parts.find(p=>p.name==='Cockpit');const target=[...cockpit.vertices[4]];target[1]+=.15;
p=await call('vehicle_edit',{id,revision:p.revision,operation:{type:'vertex',partId:cockpit.id,index:4,position:target}});assert.deepEqual(p.document.parts.find(p=>p.id===cockpit.id).vertices[4],target);
const rejected=await client.callTool({name:'vehicle_edit',arguments:{id,revision:p.revision,operation:{type:'mesh',name:'Invalid',vertices:[[0,0,0],[1,0,0],[0,1,0]],faces:[[0,1,99]]}}});assert(rejected.isError);assert.equal((await call('vehicle_get',{id})).revision,p.revision);
const exported=await call('vehicle_export',{id,format:'obj'});assert(exported.text.includes('o Left_armored_sill'));assert(exported.text.includes('\nf '));
writeFileSync('.local/vehicle-review/mcp-project.json',JSON.stringify(p,null,2));writeFileSync('.local/vehicle-review/marauder.obj',exported.text);console.log(JSON.stringify({id,revision:p.revision,tools:tools.tools.map(t=>t.name),parts:p.document.parts.length,checks:'create, add, mirror, vertex, undo, redo, stale revision, invalid geometry, OBJ export passed'}));await client.close();
