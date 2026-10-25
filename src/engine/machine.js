// Builds the initial machine state from the user's own DTRACK.EXE and asset files.
import {B,fwb,fww,LOAD_SEG,PSP_SEG,DGROUP,resetStack,wb} from './mem.js';
import {unexepack,loadImage} from './exepack.js';
import {initArena,FileSystem} from './dos.js';
import {resetHost,state} from './host.js';
import {resetEga} from './ega.js';
import {sha256} from './sha256.js';

export const REFERENCE_EXE_SHA256='5b23cafb2542195a7473b532e46a25023cd7bd59351445f6a7cb732807ff2928';
export class SetupError extends Error{}

// assets: Map of upper-case file name -> Uint8Array. storage: {read(name),write(name,data),keys()}.
export function createMachine({assets,storage=null,strict=true,args=[]}){
 const exe=assets.get('DTRACK.EXE');
 if(!exe)throw new SetupError('DTRACK.EXE is missing from the game folder');
 const hash=sha256(exe);
 if(hash!==REFERENCE_EXE_SHA256)throw new SetupError(`DTRACK.EXE does not match the supported build (sha256 ${hash})`);
 resetHost();state.strict=strict;B.fill(0);resetEga();resetStack();
 const unpacked=unexepack(exe);
 loadImage(B,unpacked,LOAD_SEG);
 initPsp(args);initBiosData();initArena();
 return {fs:new FileSystem(assets,storage),exe:unpacked};
}

function initPsp(args){
 fwb(PSP_SEG,0,0xcd);fwb(PSP_SEG,1,0x20);
 // MSC startup resizes the program to DGROUP+64K; PSP:2 holds the top of that block (observed MCB layout).
 fww(PSP_SEG,2,DGROUP+0x1000);
 const tail=args.length?' '+args.join(' '):'';
 fwb(PSP_SEG,0x80,tail.length);for(let i=0;i<tail.length;i++)fwb(PSP_SEG,0x81+i,tail.charCodeAt(i));fwb(PSP_SEG,0x81+tail.length,13);
}
function initBiosData(){
 fww(0x40,0x10,0x0026|0x20);       // equipment word: 80x25 colour
 fww(0x40,0x1a,0x1e);fww(0x40,0x1c,0x1e); // keyboard buffer head/tail
 fww(0x40,0x80,0x1e);fww(0x40,0x82,0x3e); // keyboard buffer start/end
 fwb(0x40,0x49,3);fww(0x40,0x4a,80);fwb(0x40,0x84,24);fww(0x40,0x63,0x3d4);
 fwb(0x40,0x87,0x60);fwb(0x40,0x88,0x09); // EGA info: 256K, colour display
}
export {DGROUP};
