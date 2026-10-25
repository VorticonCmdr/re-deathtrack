// Program start: the parts of the MSC start-up (1000:d39c) that main depends on, then main itself.
import {salloc,putStr,ww} from '../engine/mem.js';
import {installBios} from './bios.js';
import {F} from './link.js';
import './modules.js';

// argv[0] is the full program path, as DOS passes it; main derives the game directory from it.
export const PROGRAM_PATH='C:\\DTRACK.EXE';

export function* startGame({args=[]}={}){
 installBios();
 if(F.crtStartup)F.crtStartup();
 // MSC _setargv keeps argument strings and the argv array on the stack below the initial SP.
 const strs=[PROGRAM_PATH,...args],ptrs=[];
 for(const s of strs){const p=salloc(s.length+1);putStr(p,s);ptrs.push(p);}
 const argv=salloc(2*(strs.length+1));
 ptrs.forEach((p,i)=>ww(argv+2*i,p));ww(argv+2*strs.length,0);
 return yield* F.f1000_0010(strs.length,argv);
}
