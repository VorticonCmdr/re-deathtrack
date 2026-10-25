// Program start: the translated MSC start-up (1000:d39c) builds argv from the PSP and environment, then runs main.
import {installBios} from './bios.js';
import {installWorkMeter} from './pacing.js';
import {F} from './link.js';
import './modules.js';

export function* startGame(){
 installBios();installWorkMeter();
 return yield* F.f1000_d39c();
}
