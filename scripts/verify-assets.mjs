// Fails unless every file listed in the manifest exists in game/ with the expected size and hash.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('../src/data/manifest.json',import.meta.url)));
const dir=process.argv[2]||'game';let bad=0,ok=0;
for(const [name,{size,sha256}] of Object.entries(manifest.files)){
 let b;try{b=await readFile(`${dir}/${name}`);}catch{console.error(`missing ${name}`);bad++;continue;}
 const h=createHash('sha256').update(b).digest('hex');
 if(b.length!==size||h!==sha256){console.error(`mismatch ${name}`);bad++;}else ok++;
}
console.log(`${ok} files verified, ${bad} problems`);
if(!ok||bad)process.exitCode=1;
