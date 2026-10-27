// Profile operations are available between events. Imported strings only enter text nodes.
export function createSaveUI(store,onChange){
 const dialog=document.createElement('dialog');dialog.id='save-dialog';dialog.setAttribute('aria-label','Driver and saves');document.body.append(dialog);
 let candidate=null;
 const $=s=>dialog.querySelector(s);
 function summary(p){return `${p.driverName} · ${p.mode} · Season ${p.season.number} · ${p.season.round}/10 events · $${p.cash.toLocaleString()}`;}
 function render(){
 candidate=null;
 dialog.innerHTML=`<button class="close" aria-label="Close driver and saves">×</button><div class="eyebrow">YOUR PLACE ON THE GRID</div><h2>Driver & saves</h2><p id="profile-summary"></p><div class="save-modes"><button data-mode="career">Championship</button><button data-mode="practice">Practice</button></div><label>Driver name<input id="driver-name" maxlength="24" autocomplete="off"></label><button id="save-name">Save name</button><p id="save-message" role="status"></p><hr><h3>Keep your progress</h3><p>One active save per mode. Export copies to keep other drivers or move to another browser. Saves contain progress only; you will still need your original game folder.</p><div class="save-actions"><button id="export-profile">Export save ↓</button><label class="folder">Import save ↑<input id="import-profile" type="file" accept=".json,application/json"></label><button id="recover-profile">Review recovery copy</button></div><section id="save-preview" hidden><h3 id="preview-title"></h3><p id="preview-summary"></p><p>This replaces the active profile in this mode. The previous stored save will be kept as a recovery copy. In-progress races become interrupted events with no payout.</p><button id="apply-profile" class="primary">Replace active profile</button><button id="cancel-import">Cancel</button></section><p>Autosaves retain equipment, cash, condition and championship standings. Races restart at the event boundary, not mid-lap.</p><button id="new-profile">New driver / reset profile…</button>`;
 $('#profile-summary').textContent=summary(store.profile);$('#driver-name').value=store.profile.driverName;$('#save-message').textContent=store.message;
 dialog.querySelectorAll('[data-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(store.profile.mode===b.dataset.mode));b.onclick=()=>{store.switchMode(b.dataset.mode);onChange();render();};});
 $('.close').onclick=()=>dialog.close();
 $('#save-name').onclick=()=>{try{const ok=store.rename($('#driver-name').value);onChange();$('#profile-summary').textContent=summary(store.profile);$('#save-message').textContent=ok?'Driver name saved.':store.message;}catch{$('#save-message').textContent='Enter 1–24 characters without angle brackets or control characters.';}};
 $('#export-profile').onclick=()=>{try{const url=URL.createObjectURL(new Blob([store.exportSave()],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`deathtrack-${store.profile.mode}-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#save-message').textContent='Save exported. Keep this file somewhere safe.';}catch(e){$('#save-message').textContent=e.message;}};
 function preview(p,title){candidate=p;$('#preview-title').textContent=title;$('#preview-summary').textContent=summary(p);$('#save-preview').hidden=false;$('#apply-profile').focus();}
 $('#import-profile').onchange=async e=>{candidate=null;$('#save-preview').hidden=true;const file=e.target.files[0];try{if(!file)return;if(file.size>65536)throw Error('Save file is too large (maximum 64 KB).');const p=store.previewImport(await file.text());preview(p,'Review imported driver');}catch(err){$('#save-message').textContent=err.message;}finally{e.target.value='';}};
 $('#recover-profile').onclick=()=>{try{preview(store.recoverable(),'Review recovery copy');}catch(e){$('#save-message').textContent=e.message;}};
 $('#new-profile').onclick=()=>preview(store.newProfile(),'Start a new driver');
 $('#cancel-import').onclick=()=>{candidate=null;$('#save-preview').hidden=true;$('#new-profile').focus();};
 $('#apply-profile').onclick=()=>{if(!candidate)return;try{store.replace(candidate);onChange();render();}catch(e){$('#save-message').textContent=e.message;}};
 }
 return {open(){render();dialog.showModal();}};
}
