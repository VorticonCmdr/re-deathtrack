// Loads the local original game folder for tests. Missing files are a setup failure, never a skip.
import {readdir,readFile} from 'node:fs/promises';
export async function loadAssets(dir=new URL('../game/',import.meta.url)){
 let names;try{names=await readdir(dir);}catch{throw Error('SETUP FAILURE: game/ folder with the original Deathtrack files is required');}
 const m=new Map();for(const n of names)if(!n.startsWith('.'))m.set(n.toUpperCase(),new Uint8Array(await readFile(new URL(n,dir))));
 if(!m.has('DTRACK.EXE'))throw Error('SETUP FAILURE: game/DTRACK.EXE missing');
 return m;
}
