import {smoothPortrait,blendPortrait} from './portrait-filter.js';
import {driverStatistics,readMoneyWinners} from './statistics.js';
import {unexepack} from '../engine/exepack.js';
import {track,models,highScores,palettes} from '../viewer/decode.js';
import {chunks,images} from '../formats.js';
import {CITIES,DRIVER_NAMES} from './championship.js';
import {freshProfile} from './progression.js';
import {CARS,PARTS,vehicleSpec} from './garage.js';
const PORTRAITS=['SLY','MEGA','ANGEL','LURKER','MENACE','CRIMSON','MANIAC','WRECKER','MELISSA'];
export const ARCHIVE_ASSETS=['HI_SCORE','PALS.BLK',...PORTRAITS.map(n=>n+'.BMP'),...CITIES.map(c=>c.id.toUpperCase()+'.BMP')];
export function archiveText(bytes){
 const {image}=unexepack(bytes),v=new DataView(image.buffer,image.byteOffset,image.byteLength),decoder=new TextDecoder('windows-1252');
 const lines=(table,base,start,count)=>Array.from({length:count},(_,i)=>{const pointer=0x26fa0+table+(start+i)*2;if(pointer+2>image.length)throw Error('Text table missing');const p=0x23ae0+base+v.getInt16(pointer,true),end=image.indexOf(0,p);if(p<0||end<p||end-p>256)throw Error('Unsupported original text table');return decoder.decode(image.slice(p,end)).trimEnd();});
 const attributes=PORTRAITS.map((_,i)=>[['Home',0x181c],['Favorite food',0x17e8],['Favorite weapon',0x1884],['Best track',0x1850]].map(([label,table])=>{const p=0x26fa0+v.getUint16(0x26fa0+table+(i+1)*2,true),end=image.indexOf(0,p);if(p<0x26fa0||end<p||end-p>256)throw Error('Unsupported rival attribute table');return {label,value:decoder.decode(image.slice(p,end)).trim()};}));
 return {attributes,bios:PORTRAITS.map((_,i)=>lines(0x21cc,4,i*11,11)),tracks:CITIES.map((_,i)=>lines(0x2562,0x2a73,i*12,12)),pits:CITIES.map((_,i)=>v.getUint16(0x26fa0+0x1d04+i*2,true))};
}
// EGA portraits use the first PALS.BLK palette; per-driver selectors are CGA/Tandy-only.
export function archivePalette(bytes){if(!bytes)throw Error('PALS.BLK is missing. Reload the complete game folder for original colors.');const palette=palettes(chunks(bytes))[0]?.colors;if(!palette||palette.length!==16)throw Error('Original archive palette unavailable.');return palette;}
export function createArchive(getProfile){
 const dialog=document.createElement('dialog');dialog.id='archive-dialog';dialog.setAttribute('aria-label','Deathtrack archive');document.body.append(dialog);
 let assets,text,section='rivals',selected=0,angle=.65;
 let portraitCache=new WeakMap();
 const $=s=>dialog.querySelector(s);
 function picture(canvas,bytes){if(!bytes)throw Error('Original illustration not supplied. Reload the complete game folder to include it.');const palette=archivePalette(assets.get('PALS.BLK')),img=images(chunks(bytes))[0];if(!img)throw Error('Illustration unavailable');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d'),out=ctx.createImageData(img.width,img.height);img.pixels.forEach((p,i)=>{const hex=palette[p];out.data.set([parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),255],i*4);});ctx.putImageData(out,0,0);}
 function model(canvas){const m=models(assets.get(`MYCAR${selected}.TBL`))[0],project=p=>({x:p.x*Math.cos(angle)+p.y*Math.sin(angle),y:-p.z*.9-(p.y*Math.cos(angle)-p.x*Math.sin(angle))*.32,depth:(p.y*Math.cos(angle)-p.x*Math.sin(angle))*.9-p.z*.32});const faces=m.details[0].groups.flatMap(g=>g.faces).filter(f=>f.indices.length>=3).map(f=>f.indices.map(i=>project(m.vertices[i]))),all=faces.flat(),minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y)),scale=Math.min(520/Math.max(1,maxX-minX),230/Math.max(1,maxY-minY));canvas.width=640;canvas.height=320;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,640,320);faces.sort((a,b)=>b.reduce((n,p)=>n+p.depth,0)/b.length-a.reduce((n,p)=>n+p.depth,0)/a.length).forEach((f,i)=>{ctx.beginPath();f.forEach((p,j)=>{const x=320+(p.x-(minX+maxX)/2)*scale,y=160+(p.y-(minY+maxY)/2)*scale;j?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.fillStyle=`hsl(75 40% ${35+i%6*7}%)`;ctx.fill();ctx.strokeStyle='#17252d66';ctx.stroke();});}
 function route(canvas){const points=track(assets.get(CITIES[selected].id.toUpperCase()+'.TRK')).points.slice(0,-2),minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y)),scale=Math.min(520/(maxX-minX),250/(maxY-minY));canvas.width=640;canvas.height=320;const ctx=canvas.getContext('2d'),xy=p=>[320+(p.x-(minX+maxX)/2)*scale,160+(p.y-(minY+maxY)/2)*scale];ctx.strokeStyle='#dfff7c';ctx.lineWidth=4;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...xy(p)):ctx.moveTo(...xy(p)));ctx.closePath();ctx.stroke();const pit=points[text.pits[selected]];if(pit){const [x,y]=xy(pit);ctx.fillStyle='#7ee4d6';ctx.fillRect(x-5,y-5,10,10);ctx.font='14px sans-serif';ctx.fillText('PIT',x+10,y+5);}const heights=points.map(p=>p.z*.05),length=points.reduce((n,p,i)=>{const b=points[(i+1)%points.length];return n+Math.hypot(b.x-p.x,b.y-p.y)*.05;},0);return `${(length/1000).toFixed(2)} km · ${Math.round(Math.max(...heights)-Math.min(...heights))} m elevation range · modern world scale`;}
 function renderRecords(){
 const list=$('.archive-list'),detail=$('.archive-detail');list.hidden=true;$('.archive-layout').classList.add('archive-records');
 const add=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value??'';if(cls)e.className=cls;detail.append(e);return e;};
 const money=n=>'$'+n.toLocaleString('en-US');
 function table(headers,rows){const t=add('table',null,'archive-table');const head=document.createElement('thead'),tr=document.createElement('tr');for(const h of headers){const th=document.createElement('th');th.scope='col';th.textContent=h;tr.append(th);}head.append(tr);t.append(head);const body=document.createElement('tbody');for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}body.append(tr);}t.append(body);}
 if(section==='stats'){
 const p=getProfile(),s=driverStatistics(p);add('div',s.mode.toUpperCase()+' / CURRENT DRIVER','eyebrow');add('h3',s.name);
 if(s.mode==='practice'){add('p','Practice does not award career earnings or maintain championship statistics. Switch to Championship in Driver & saves to view your career.');add('h4','Practice balance');add('p',money(s.cash));if(p.lastResult)add('p',`Last practice event: ${p.lastResult.outcome} · position ${p.lastResult.position}`);return;}
 const grid=add('div',null,'stat-grid');for(const [label,value] of [['Career earnings',money(s.earnings)],['Current balance',money(s.cash)],['Career events',s.events],['Season points',s.points],['Season wins',s.wins],['Season rank',s.round?s.rank+' / 10':'—']]){const card=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');small.textContent=label;strong.textContent=value;card.append(small,strong);grid.append(card);}
 add('h4',`Season ${s.season} · ${s.round} / 10 events`);add('p',`${s.finishes} finishes · ${s.dnfs} DNFs · ${money(s.seasonIncome)} in prizes and contracts this season.`);
 if(s.active)add('p','An event is in progress. It is not included until settled.','archive-note');
 if(s.history.length)table(['City','Outcome','Place','Prize','Contract'],s.history.map(r=>[CITIES[r.city].name,r.outcome,r.position,money(r.prize),money(r.bounty)]));else add('p','Complete your first championship event to start the season log.');
 add('p','Career earnings and event totals span seasons. Wins, points, finishes and the event log cover the current season only. Older saves do not retain lifetime wins, lap records or combat totals.','archive-note');
 }else{
 add('h3','Top money winners');add('h4','Remaster · this browser');const local=readMoneyWinners();add('p',local.message,'archive-note');if(local.rows.length)table(['Rank','Driver','Career earnings'],local.rows.map((r,i)=>[i+1,r.name,money(r.earnings)]));
 add('p','One best earnings record per career identity. Practice funds are excluded. Resetting creates a new driver; importing a named career retains its identity. Records stay in this browser and are not part of exported saves.','archive-note');
 add('h4','Original game · HI_SCORE');const bytes=assets?.get('HI_SCORE');if(!bytes){add('p','Supply HI_SCORE in your original game folder to view its ten money-winner records. Your remaster records are still available.');return;}
 try{const rows=highScores(bytes).sort((a,b)=>b.winnings-a.winnings||a.slot-b.slot);table(['Rank','Driver','Winnings'],rows.map((r,i)=>[i+1,r.name||'—',money(r.winnings)]));add('p','Ranked by recorded money from your original file. The original records cash at entry; remaster records above track total career earnings. Browsing and remaster races never modify HI_SCORE.','archive-note');}catch{add('p','HI_SCORE could not be read: expected ten 19-byte records. Original file left unchanged.');}
 }
 }
 function render(){
 dialog.scrollTop=0;dialog.innerHTML='<div class="archive-heading"><div><div class="eyebrow">THE ORIGINAL CIRCUIT / FIELD GUIDE</div><h2>The archive</h2></div><button class="close" aria-label="Close archive">×</button></div><nav class="archive-tabs" aria-label="Archive categories"></nav><div class="archive-layout"><nav class="archive-list" aria-label="Archive entries"></nav><article class="archive-detail" aria-live="polite"></article></div>';
 $('.close').onclick=()=>dialog.close();
 for(const [id,label] of [['rivals','Rival bios'],['tracks','Track dossiers'],['cars','Car showroom'],['stats','Driver statistics'],['money','Top money winners']]){const b=document.createElement('button');b.textContent=label;b.setAttribute('aria-pressed',String(section===id));b.onclick=()=>{section=id;selected=0;angle=.65;render();$('.archive-tabs button[aria-pressed="true"]').focus();};$('.archive-tabs').append(b);}
 if(section==='stats'||section==='money'){renderRecords();return;}
 const names=section==='rivals'?DRIVER_NAMES.slice(1):section==='tracks'?CITIES.map(c=>c.name):CARS;
 names.forEach((name,i)=>{const b=document.createElement('button');b.textContent=`${String(i+1).padStart(2,'0')} / ${name}`;b.setAttribute('aria-pressed',String(selected===i));b.onclick=()=>{selected=i;angle=.65;render();$('.archive-list button[aria-pressed="true"]').focus();};$('.archive-list').append(b);});
 const detail=$('.archive-detail');const add=(tag,value,cls)=>{const e=document.createElement(tag);if(value)e.textContent=value;if(cls)e.className=cls;detail.append(e);return e;};
 add('div',section==='rivals'?'THE COMPETITION':section==='tracks'?CITIES[selected].region:'ORIGINAL MODEL / MODERN HANDLING','eyebrow');add('h3',section==='rivals'&&text?text.bios[selected][0]:names[selected]);
 if(!assets||!text){add('p','Load your original game folder to read the archive.');return;}
 try{
 if(section==='rivals'){
  const figure=add('figure',null,'archive-portrait-panel'),canvas=document.createElement('canvas');canvas.className='archive-portrait';figure.append(canvas);
  try{
   const bytes=assets.get(PORTRAITS[selected]+'.BMP');let cached=bytes&&portraitCache.get(bytes);if(!cached){picture(canvas,bytes);const ctx=canvas.getContext('2d'),original=ctx.getImageData(0,0,canvas.width,canvas.height).data;cached={width:canvas.width,height:canvas.height,pixels:blendPortrait(original,smoothPortrait(original,canvas.width,canvas.height),.7)};portraitCache.set(bytes,cached);}
   canvas.width=cached.width;canvas.height=cached.height;canvas.style.imageRendering='auto';canvas.setAttribute('aria-label',names[selected]+' smoothed portrait');const ctx=canvas.getContext('2d'),img=ctx.createImageData(cached.width,cached.height);img.data.set(cached.pixels);ctx.putImageData(img,0,0);
  }catch(e){figure.remove();add('p',e.message,'archive-note');}
  add('h4','Driver profile');const facts=add('dl',null,'archive-facts');for(const {label,value} of text.attributes[selected]){const row=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;row.append(term,description);facts.append(row);}
  add('h4','Original biography');add('p',text.bios[selected].slice(1).join('\n').trim(),'archive-bio');
 }else if(section==='tracks'){
  const canvas=add('canvas',null,'archive-route');canvas.setAttribute('aria-label',names[selected]+' circuit layout and pit');const stats=route(canvas);add('p',stats,'archive-note');add('h4','Original track dossier');add('p',text.tracks[selected].map(l=>l.trim()).filter(Boolean).join(' '));
  const art=add('canvas',null,'archive-city');art.setAttribute('aria-label',names[selected]+' original city illustration');try{picture(art,assets.get(CITIES[selected].id.toUpperCase()+'.BMP'));}catch(e){art.remove();add('p',e.message,'archive-note');}
 }else{
  const canvas=add('canvas',null,'archive-car');canvas.setAttribute('aria-label',CARS[selected]+' rotatable original car model');model(canvas);
  const label=add('label','Rotate car'),slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='360';slider.value=String(Math.round(angle*180/Math.PI));slider.setAttribute('aria-label','Car rotation');label.append(slider);slider.oninput=()=>{angle=Number(slider.value)*Math.PI/180;model(canvas);};
  const build=freshProfile().builds[selected],spec=vehicleSpec(build);add('h4','Factory equipment');add('p',PARTS.map((p,i)=>`${p} ${['I','II','III'][build.parts[i]]}`).join(' · '));add('p',`Gun ${build.gun+1} · ${build.ammo} rounds · ${build.rocketAmmo} rockets · ${build.missileAmmo} missiles · ${build.mineAmmo} mines · ${build.caltropAmmo} caltrops · Laser ${build.laser+1} · Particle beam ${build.beam+1} · Ram spikes ${build.ram+1} · Wheel spikes ${build.wheel+1}`);add('h4','Modern starting performance');add('p',`${Math.round(spec.maxSpeed*3.6)} km/h engine limit · ${spec.acceleration} m/s² drive force · ${spec.braking} m/s² braking · ${spec.armor} HP armor`);add('p','Factory specifications, not your current upgrades or damage. Choose and equip your car in the garage.','archive-note');
 }
 }catch(e){add('p','This entry could not be decoded: '+e.message,'archive-note');}
 }
 return {setAssets(map){portraitCache=new WeakMap();assets=map;try{text=archiveText(map.get('DTRACK.EXE'));}catch{text=null;}},open(){render();dialog.showModal();}};
}
