// Writes the committed scenario manifest (hashes, recipe, rules) from a local capture's manifest.
// Usage: node scripts/scenario-manifest.mjs <captureDir> <scenarioName>
import {readFile,writeFile} from 'node:fs/promises';
const [dir='.local/captures/demo-race-start',name='demo-race-start']=process.argv.slice(2);
const m=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));
const out={scenario:name,version:2,
 executable:{file:'DTRACK.EXE',sha256:'5b23cafb2542195a7473b532e46a25023cd7bd59351445f6a7cb732807ff2928'},
 assets:'src/data/manifest.json (all 92 files must verify)',
 emulator:{name:'dosbox-automation',version:'0.84.0-vc1 (f6d9b)',config:'bridge default (machine VGA, MPU-401 present, default cycles)',loadSegment:'0x01f5'},
 captureTool:'scripts/dosbox/capture-race.mjs (git revision of that file at capture time is the revision that wrote this manifest)',
 recipe:['copy game/ to .local/dosrun (scratch copy, never the originals)','mount .local/dosrun as C: (drive_mount)','type: C: <Enter>, dtrack demo <Enter>',`node scripts/dosbox/capture-race.mjs ${dir} ${m.checkpoints.length} --from-start`],
 breakpoints:{loopHead:'01f5:04ed (Ghidra 1000:04ed)',staleRead:'01f5:9778 (Ghidra 1000:9778, environment input stale9542)'},
 inputs:{keyboard:'none (demo autopilot)',timer:'not replayed (the race reads no time)',environment:'stale9542 per checkpoint when present (interrupt-dependent stack word, docs/re/environment.md)'},
 injections:['start state = checkpoint 0 (conditional evidence)','sound device descriptors set to PC speaker (sound state excluded, never read by gameplay)','047c frame BP and stack pointer from the checkpoint registers'],
 comparison:{memory:'0..A0000 minus src/engine/checkpoint.js raceReplayExclusions(sp)',vram:'all 4 planes, exact',tolerance:'none'},
 expected:{checkpoints:m.checkpoints.length,comparedFrames:m.checkpoints.length-1,firstFrame:m.checkpoints[0].frame},
 checkpoints:m.checkpoints.map(c=>({file:c.file,sha256:c.sha256,frame:c.frame,...(c.stale9542!==undefined?{stale9542:c.stale9542}:{})})),
 storage:`${dir} (local only, proprietary content)`,
 verify:'npm run verify (tests/scenario-demo-race.test.mjs)'};
await writeFile(`docs/scenarios/${name}.json`,JSON.stringify(out,null,1)+'\n');
console.log(`docs/scenarios/${name}.json: ${out.checkpoints.length} checkpoints`);
