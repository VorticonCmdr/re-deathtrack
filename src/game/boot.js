// Program start: the translated MSC start-up (1000:d39c) builds argv from the PSP and environment, then runs main.
import {installBios} from './bios.js';
import {installWorkMeter} from './pacing.js';
import {setSound} from './devices.js';
import {F} from './link.js';
import './modules.js';

// options.sound: 'speaker' (default) | 'adlib' | 'mt32': which music hardware the ports answer for (devices.js).
export function* startGame({sound='speaker'}={}){
 setSound(sound);installBios();installWorkMeter();
 return yield* F.f1000_d39c();
}
