// Renders the displayed EGA page of a capture checkpoint to PNG using the port's EGA model.
// Usage: node scripts/tools/capture-png.mjs <checkpoint.bin> <out.png> [page-offset]
import {readFile,writeFile} from 'node:fs/promises';
import {planes,pageIndices,rgb200} from '../../src/engine/ega.js';
import {png} from './png.mjs';
const [file,out,pageArg]=process.argv.slice(2);
const b=new Uint8Array(await readFile(file));
for(let p=0;p<4;p++)planes[p].set(b.subarray(0xa0000+p*0x10000,0xa0000+(p+1)*0x10000));
const DS=0x28ef0,shown=b[DS+0x3854]|b[DS+0x3855]<<8;
const start=pageArg?parseInt(pageArg,16):(shown-0xa000)*16;
const manifest=JSON.parse(await readFile(new URL('manifest.json',new URL(file,'file://'+process.cwd()+'/'))).catch(()=>'{}'));
const cp=manifest.checkpoints?.find(c=>file.endsWith(c.file));
const pal=(cp?.vga?.palette||[0,1,2,3,4,5,20,7,56,57,58,59,60,61,62,63]).map(rgb200),idx=pageIndices(start),rgb=new Uint8Array(320*200*3);
idx.forEach((c,i)=>{rgb[i*3]=pal[c]>>16;rgb[i*3+1]=pal[c]>>8&255;rgb[i*3+2]=pal[c]&255;});
await writeFile(out,png(320,200,rgb));console.log(`page ${start.toString(16)} -> ${out}`);
