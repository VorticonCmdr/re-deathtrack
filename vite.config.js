import {defineConfig} from 'vite';
import {readdir,stat,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('game');
export default defineConfig({base:'./',build:{rollupOptions:{input:{index:'index.html',viewer:'viewer.html'}}},plugins:[{
 name:'local-game-assets',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  try {const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/__assets'){const names=await readdir(root).catch(()=>[]);const files=await Promise.all(names.filter(n=>!n.startsWith('.')).map(async name=>({name,size:(await stat(path.join(root,name))).size})));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(files));return;}
   if(url.pathname.startsWith('/__asset/')){const name=decodeURIComponent(url.pathname.slice(9));if(name!==path.basename(name)||name.startsWith('.')){res.statusCode=400;res.end();return;}res.setHeader('Content-Type','application/octet-stream');res.end(await readFile(path.join(root,name)));return;}
   next();
  }catch{res.statusCode=404;res.end('Asset unavailable');}
 });}
}]});
