// A small MCP client for local agent workflows; all edits still go through MCP.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const client=new Client({name:'vehicle-foundry-cli',version:'1.0.0'});
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../server/vehicle-mcp.mjs',import.meta.url))]}));
 const name=process.argv[2];const result=name?await client.callTool({name,arguments:JSON.parse(process.argv[3]??'{}')}):await client.listTools();
 console.log(JSON.stringify(result,null,2));if(result.isError)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}finally{await client.close();}
