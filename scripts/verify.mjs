// Strict verification entry point: asset identity, engine/unit tests, and scenario checks.
// Fails on any failing, skipped or missing check, and when no tests ran.
import {spawnSync} from 'node:child_process';
const steps=[
 ['asset identity',['node','scripts/verify-assets.mjs']],
 ['tests',['node','--test','--test-reporter=tap','tests/']],
];
let failed=false;
for(const [name,cmd] of steps){
 const r=spawnSync(cmd[0],cmd.slice(1),{encoding:'utf8'});
 const out=(r.stdout||'')+(r.stderr||'');
 let ok=r.status===0;
 if(name==='tests'){
  const pass=+(out.match(/^# pass (\d+)/m)?.[1]??0),skip=+(out.match(/^# skipped (\d+)/m)?.[1]??0),todo=+(out.match(/^# todo (\d+)/m)?.[1]??0);
  if(!pass){ok=false;console.error('No tests executed');}
  if(skip||todo){ok=false;console.error(`${skip} skipped / ${todo} todo tests are not allowed`);}
  console.log(`${name}: ${pass} passed`);
 }
 if(!ok){failed=true;console.error(`FAIL ${name}\n${out.split('\n').filter(l=>/not ok|Error|FAIL|missing|mismatch/.test(l)).slice(0,40).join('\n')}`);}
 else console.log(`ok ${name}`);
}
process.exitCode=failed?1:0;
