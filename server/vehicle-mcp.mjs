import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
const base=process.env.VEHICLE_STUDIO_URL??'http://127.0.0.1:5188';
const url=new URL(base);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol!=='http:')throw Error('VEHICLE_STUDIO_URL must be a local HTTP server');
const server=new McpServer({name:'deathtrack-vehicle-foundry',version:'1.0.0'});
const vec=z.tuple([z.number(),z.number(),z.number()]);
const id={id:z.string().describe('Project ID from vehicle_list or vehicle_create')},revision=z.number().int().min(1).describe('Current revision from vehicle_get; prevents overwriting newer edits');
const partId=z.string();
const operation=z.discriminatedUnion('type',[
 z.object({type:z.literal('rename'),name:z.string().min(1).max(80)}),
 z.object({type:z.literal('add'),kind:z.enum(['box','wedge','wheel']),name:z.string().max(80).optional(),size:vec.optional(),position:vec.optional(),color:z.string().optional()}),
 z.object({type:z.literal('mesh'),name:z.string().max(80),vertices:z.array(vec).max(2048),faces:z.array(z.array(z.number().int())).max(4096),color:z.string().optional()}),
 z.object({type:z.literal('update'),partId,name:z.string().max(80).optional(),color:z.string().optional(),visible:z.boolean().optional()}),
 z.object({type:z.literal('remove'),partId}),z.object({type:z.literal('duplicate'),partId,mirror:z.boolean().optional()}),
 z.object({type:z.literal('vertex'),partId,index:z.number().int().min(0),position:vec}),
 z.object({type:z.literal('transform'),partId,translate:vec.optional(),scale:vec.optional(),rotate:vec.optional()})]);
async function call(action,args){try{const response=await fetch(base+'/__vehicles/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok)throw Error(data.error);return {content:[{type:'text',text:JSON.stringify(data)}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message==='fetch failed'?'Vehicle Foundry is offline. Run npm run vehicle:studio in the project, then retry.':e.message}]};}}
function tool(name,description,schema,action,readonly=false){server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:readonly,destructiveHint:false,openWorldHint:false}},args=>call(action,args));}
tool('vehicle_list','List vehicle projects in the shared local editor.',{},'list',true);
tool('vehicle_create','Create an editable vehicle. Coordinates are metres: X width, Y up, +Z forward. Starter is fully editable.',{name:z.string().min(1).max(80),preset:z.enum(['blank','interceptor']).default('interceptor')},'create');
tool('vehicle_get','Read full geometry, component IDs, revision and history availability.',id,'get',true);
tool('vehicle_edit','Apply one undoable edit to the live project. Rotation is degrees about component center; scale is positive factors. Mirror duplicates across global X=0 and corrects face winding. mesh adds custom indexed polygon geometry. Hidden parts are excluded from OBJ export.',{...id,revision,operation},'edit');
tool('vehicle_undo','Undo the latest UI or MCP edit.',{...id,revision},'undo');tool('vehicle_redo','Redo the latest undone edit.',{...id,revision},'redo');
tool('vehicle_export','Return JSON or OBJ text, or an original-format TBL as base64 with its filename. Does not write arbitrary filesystem paths.',{...id,format:z.enum(['json','obj','tbl']).default('json')},'export',true);
const originalSource={filename:z.string().max(80),base64:z.string().max(1400000).optional().describe('Optional uploaded TBL bytes; omit to use the local original library')};
tool('vehicle_originals','List the available original vehicle TBL files and SHAPE.TBL.',{},'originals',true);
tool('vehicle_inspect_original','List model indices in a TBL before importing.',originalSource,'inspect-original',true);
tool('vehicle_import_original','Import one original model as a new project. All other models and container records are preserved for TBL export. Existing vertices, transforms and colors are editable; topology is fixed.',{...originalSource,modelIndex:z.number().int().min(0).default(0)},'import-original');
await server.connect(new StdioServerTransport());
