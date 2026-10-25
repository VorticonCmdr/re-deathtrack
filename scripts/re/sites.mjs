// Lists the functions that reference given DGROUP offsets: node scripts/re/sites.mjs 385d 896c ... (reads .local/re/export)
import fs from 'fs';
const fns=fs.readFileSync('.local/re/export/functions.tsv','utf8').trim().split('\n').map(l=>l.split('\t')).map(([a,n,s])=>{const [sg,o]=a.split(':');return {sg,o:parseInt(o,16),a,s:+s}});
const lines=fs.readFileSync('.local/re/export/disasm.asm','utf8').split('\n');
let cur='';const hits={};
const vars=process.argv.slice(2);
for(const l of lines){
 const m=l.match(/^;==== (\S+) /);if(m){cur=m[1];continue;}
 for(const v of vars){const re=new RegExp('\\[(?:0x)?'+v+'\\b|0x'+v+'\\b');if(re.test(l)&&!l.startsWith(';')){(hits[v]??=new Set()).add(cur);}}
}
for(const v of vars)console.log(v,[...(hits[v]||[])].join(' '));
