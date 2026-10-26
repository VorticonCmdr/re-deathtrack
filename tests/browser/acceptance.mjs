// Browser acceptance: real Chrome, real input adapters (CDP keyboard/mouse), original assets via the dev server.
// Route: boot -> title -> Enter -> sign-up (type name) -> GO FOR IT -> quiz answer -> take car -> FULL CIRCUIT RUN
// -> GO RACIN' -> race: accelerate, steer, fire. Fails on any error status, unsupported-path diagnostic,
// console error, or a missed milestone. Usage: [ACCEPT_QUERY='?video=cga'] node tests/browser/acceptance.mjs
import {createServer} from 'vite';
import puppeteer from 'puppeteer-core';
import {mkdir} from 'node:fs/promises';
const CHROME=process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out=process.env.ACCEPT_QUERY?'.local/browser-'+process.env.ACCEPT_QUERY.replace(/\W/g,''):'.local/browser';await mkdir(out,{recursive:true});
const server=await createServer({server:{port:0,host:'127.0.0.1'},logLevel:'error'});await server.listen();
const url=`http://127.0.0.1:${server.config.server.port||server.httpServer.address().port}/`;
let browser,failures=[];
const fail=m=>{failures.push(m);console.error('FAIL',m);};
try{
 browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--window-size=1100,900']});
 const page=await browser.newPage();await page.setViewport({width:1100,height:900});
 page.on('console',m=>{if(m.type()==='error')fail(`console error: ${m.text()}`);});
 page.on('pageerror',e=>fail(`page error: ${e.message}`));
 await page.goto(url+(process.env.ACCEPT_QUERY||'')+((process.env.ACCEPT_QUERY||'').includes('sound=')?'':(process.env.ACCEPT_QUERY?'&':'?')+'sound=speaker'));
 const pages=[];const tracer=setInterval(async()=>{try{const p=await page.evaluate('window.__deathtrack&&window.__deathtrack.rw(0x9018)');if(p!==pages.at(-1))pages.push(p);}catch{}},50);
 const g=(expr)=>page.evaluate(expr);
 const mem=o=>g(`window.__deathtrack.rw(${o})`);
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function waitFor(desc,pred,ms=20000){const t=Date.now();while(Date.now()-t<ms){if(await pred())return true;if(await g('window.__deathtrack?.halted()'))break;await sleep(100);}fail(`${desc} not reached (status: ${await g('window.__deathtrack?.status()')})`);return false;}
 // The menu loop is interactive once its iteration counter DS:1f2e advances on the expected page.
 async function menuReady(desc,pageOk){return waitFor(desc,async()=>{if(!(await pageOk(await mem(0x9018))))return false;const a=await mem(0x1f2e);await sleep(150);return await mem(0x1f2e)!==a&&await pageOk(await mem(0x9018));},30000);}
 async function shot(name){await page.screenshot({path:`${out}/${name}.png`});}
 const box=await (await page.$('#screen')).boundingBox();
 const at=(x,y)=>[box.x+x/320*box.width,box.y+y/200*box.height];
 async function click(x,y){await page.mouse.move(...at(x,y),{steps:4});await sleep(200);await page.mouse.down();await sleep(150);await page.mouse.up();}
 async function key(k,ms=120){await page.keyboard.down(k);await sleep(ms);await page.keyboard.up(k);await sleep(120);}
 await waitFor('game running',async()=>await g('!!window.__deathtrack')&&await g('window.__deathtrack.clock()')>5*1193182);
 await shot('01-title');await key('Enter');
 // Audio starts on the first user gesture (AudioWorklet rendering the emulated PC speaker).
 if(!(await waitFor('audio context running after the first key press',async()=>await g('window.__deathtrack.audioRunning()'),5000)))fail('no audio');
 if(await menuReady('sign-up page (21)',p=>p===21)){await page.keyboard.down('Shift');for(const k of ['KeyA','KeyC','KeyE'])await key(k);await page.keyboard.up('Shift');
  await sleep(300);await shot('02-signup');await click(160,174);
 }
 if(await menuReady('copy-protection quiz page (52)',p=>p===52)){await shot('03-quiz');await click(160,142);}
 if(await menuReady('car dealer page (11)',p=>p===11)){await shot('04-dealer');await click(160,181);}
 if(await menuReady('hub page (5)',p=>p===5)){await shot('05-hub');await click(160,60);}
 if(await menuReady('circuit page (12)',p=>p===12)){await shot('06-circuit');await click(160,150);}
 if(await waitFor('race running (frame counter advancing)',async()=>await mem(0x924e)>30,40000)){
  // Player speed DS:8926 (1/30 track point per frame); acceleration is gated until race frame 117 (docs/re/race.md).
  const s0=(await mem(0x8926))<<16>>16;await page.keyboard.down('ArrowUp');await sleep(5000);
  const speed=(await mem(0x8926))<<16>>16;if(!(speed>s0&&speed>20))fail(`player speed ${s0} -> ${speed} after 5 s of acceleration`);
  await key('ArrowLeft',400);await key('Space',150);await sleep(800);await page.keyboard.up('ArrowUp');
  const lvl=await g('window.__deathtrack.audioLevel()');if(!(lvl>0.01))fail(`speaker output silent during the race (peak ${lvl})`);
  await shot('07-race');console.log(`race frame ${await mem(0x924e)}, speed ${speed}, audio peak ${lvl.toFixed(3)}`);
 }
 clearInterval(tracer);console.log('page ids seen:',pages.join(' '));
 const diag=await g('window.__deathtrack.diagnostics()');if(diag.length)fail(`unsupported-path diagnostics: ${JSON.stringify(diag)}`);
 if(await g('window.__deathtrack.halted()'))fail(`game halted: ${await g('window.__deathtrack.status()')}`);
}catch(e){fail(e.stack);}
finally{await browser?.close();await server.close();}
console.log(failures.length?`${failures.length} failure(s)`:'browser acceptance passed');process.exitCode=failures.length?1:0;
