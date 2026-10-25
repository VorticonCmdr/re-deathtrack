// Browser acceptance for the sound options in real Chrome: ?sound=adlib renders the OPL2 through an AudioWorklet
// (non-silent output, register writes seen); ?sound=mt32 sends MIDI bytes and reports a missing MIDI output instead of failing.
// Usage: node tests/browser/sound.mjs
import {createServer} from 'vite';
import puppeteer from 'puppeteer-core';
const CHROME=process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server=await createServer({server:{port:0,host:'127.0.0.1'},logLevel:'error'});await server.listen();
const base=`http://127.0.0.1:${server.config.server.port||server.httpServer.address().port}/`;
const failures=[];const fail=m=>{failures.push(m);console.error('FAIL',m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
try{
 browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 for(const sound of ['adlib','mt32']){
  const page=await browser.newPage();
  page.on('console',m=>{if(m.type()==='error')fail(`${sound}: console error: ${m.text()}`);});
  page.on('pageerror',e=>fail(`${sound}: page error: ${e.message}`));
  await page.goto(`${base}?sound=${sound}`);
  const g=e=>page.evaluate(e);
  for(let i=0;i<100&&!(await g('!!window.__deathtrack'));i++)await sleep(100);
  await page.mouse.click(100,100);                       // user gesture: starts audio (and the MIDI connection for mt32)
  let peak=0;
  for(let i=0;i<120;i++){await sleep(100);peak=Math.max(peak,await g('window.__deathtrack.audioLevel()'));if(await g('window.__deathtrack.halted()'))break;}
  const s=await g('window.__deathtrack.sound()'),st=await g('window.__deathtrack.status()');
  console.log(sound,JSON.stringify(s),`peak ${peak.toFixed(3)}`,`status "${st}"`);
  if(s.device!==sound)fail(`${sound}: device ${s.device}`);
  if(await g('window.__deathtrack.halted()'))fail(`${sound}: game halted: ${st}`);
  if(sound==='adlib'){if(!(s.oplWrites>50))fail('adlib: no OPL register writes');if(!(peak>0.01))fail(`adlib: silent output (peak ${peak})`);}
  else{if(!(s.midiBytes>100))fail('mt32: no MIDI bytes sent');if(!/MIDI/.test(st))fail(`mt32: no MIDI status shown ("${st}")`);}
  await page.close();
 }
}catch(e){fail(e.stack);}
finally{await browser?.close();await server.close();}
console.log(failures.length?`${failures.length} failure(s)`:'sound browser acceptance passed');process.exitCode=failures.length?1:0;
