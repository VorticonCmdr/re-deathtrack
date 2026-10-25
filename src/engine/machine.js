// Builds the initial machine state from the user's own DTRACK.EXE and asset files.
import {B,fwb,fww,LOAD_SEG,PSP_SEG,DGROUP,resetStack,wb} from './mem.js';
import {unexepack,loadImage} from './exepack.js';
import {initArena,FileSystem} from './dos.js';
import {resetHost,state,getVector} from './host.js';
import {divide} from './int.js';
import {gaddr} from './mem.js';
import {resetEga} from './ega.js';
import {sha256} from './sha256.js';

export const REFERENCE_EXE_SHA256='5b23cafb2542195a7473b532e46a25023cd7bd59351445f6a7cb732807ff2928';
export class SetupError extends Error{}
// The current machine; translated code reaches files through bios.js, which reads this.
export const machine={fs:null,exe:null,args:[]};

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
 // Divide faults follow whichever INT 0 handler is installed: the game's 1ff8:3b1c halves and retries.
 divide.halving=()=>getVector(0)===gaddr(0x1ff8,0x3b1c);divide.faults=0;
 machine.fs=new FileSystem(assets,storage);machine.exe=unpacked;machine.args=args;
 return machine;
}

// Environment block as DOSBox builds it (observed at segment 01DA, MCB 01D9 of 10 paragraphs).
export const ENV_SEG=0x01da;
const ENV=['COMSPEC=Z:\\COMMAND.COM','BLASTER=A220 I7 D1 H5 T6','PATH=Z:\\;y:\\dos'];
function initEnv(){
 fwb(ENV_SEG-1,0,0x4d);fww(ENV_SEG-1,1,PSP_SEG);fww(ENV_SEG-1,3,10);
 let o=0;const put=s=>{for(const c of s)fwb(ENV_SEG,o++,c.charCodeAt(0));fwb(ENV_SEG,o++,0);};
 for(const e of ENV)put(e);fwb(ENV_SEG,o++,0);fww(ENV_SEG,o,1);o+=2;put('C:\\DTRACK.EXE');
 // Program MCB: the PSP's block, resized by the MSC start-up to end at DGROUP+64K.
 fwb(PSP_SEG-1,0,0x4d);fww(PSP_SEG-1,1,PSP_SEG);fww(PSP_SEG-1,3,DGROUP+0x1000-PSP_SEG);
}
function initPsp(args){
 initEnv();
 fwb(PSP_SEG,0,0xcd);fwb(PSP_SEG,1,0x20);fww(PSP_SEG,0x2c,ENV_SEG);
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
