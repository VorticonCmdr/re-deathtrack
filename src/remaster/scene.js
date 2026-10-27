import {createRainSurfaces} from './rain-surfaces.js';
import {createNightLighting} from './night-lighting.js';
import {createAtmosphere} from './atmosphere.js';
import '@babylonjs/core/Shaders/layer.vertex';
import '@babylonjs/core/Shaders/layer.fragment';
import {carTextures,asphaltTexture,cloudTexture} from './surface-textures.js';
import {createCombatEffects} from './combat-effects.js';
import {cityScenery,CITY_STYLE} from './city-style.js';
import {RenderTargetTexture} from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import {Layer} from '@babylonjs/core/Layers/layer';
// Eagerly register the shaders used by the first reflection/shadow/post-process passes.
import '@babylonjs/core/Shaders/bloomMerge.fragment';
import '@babylonjs/core/Shaders/extractHighlights.fragment';
import '@babylonjs/core/Shaders/fxaa.fragment';
import '@babylonjs/core/Shaders/fxaa.vertex';
import '@babylonjs/core/Shaders/glowMapGeneration.fragment';
import '@babylonjs/core/Shaders/glowMapGeneration.vertex';
import '@babylonjs/core/Shaders/glowMapMerge.fragment';
import '@babylonjs/core/Shaders/glowMapMerge.vertex';
import '@babylonjs/core/Shaders/kernelBlur.fragment';
import '@babylonjs/core/Shaders/kernelBlur.vertex';
import '@babylonjs/core/Shaders/pass.fragment';
import '@babylonjs/core/Shaders/shadowMap.fragment';
import '@babylonjs/core/Shaders/shadowMap.vertex';
import '@babylonjs/core/Shaders/default.vertex';
import '@babylonjs/core/Shaders/default.fragment';
import '@babylonjs/core/Shaders/pbr.vertex';
import '@babylonjs/core/Shaders/pbr.fragment';
// Register before PBR's BRDF decode can request this shader during texture loading.
import '@babylonjs/core/Shaders/postprocess.vertex';
import '@babylonjs/core/Shaders/imageProcessing.fragment';
import '@babylonjs/core/Shaders/rgbdDecode.fragment';
import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {Color3,Color4} from '@babylonjs/core/Maths/math.color';
import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {ReflectionProbe} from '@babylonjs/core/Probes/reflectionProbe';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {GlowLayer} from '@babylonjs/core/Layers/glowLayer';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import {DefaultRenderingPipeline} from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import {CITIES} from './championship.js';
import {track,models} from '../viewer/decode.js';
import {prepareRoad,clearsRoad,CROSSING_REPAIRS} from './road.js';
const S=.05,C=Color3.FromHexString,V=(x,y,z)=>new Vector3(x,y,z);
const colors=['#cce77a','#f16c49','#e7c856','#579dce','#bc81bd','#e5ddc1','#4dc3bb','#d74664','#8c9ee5','#eaa773'];
export function createRaceScene(canvas,assets,config={}){
 const city=config.city??CITIES[6],style=CITY_STYLE[city.id],gritty=city.id==='seattle';
 const engine=new Engine(canvas,true,{preserveDrawingBuffer:false,stencil:true});engine.setHardwareScalingLevel(Math.max(1,devicePixelRatio/1.5));
 const scene=new Scene(engine);scene.clearColor=new Color4(.19,.27,.32,1);scene.fogMode=Scene.FOGMODE_EXP2;scene.fogDensity=.0015;scene.fogColor=C(city.sky);
 const camera=new FreeCamera('race camera',V(0,10,0),scene);camera.minZ=.1;camera.maxZ=1800;camera.fov=.95;camera.inputs.clear();
 const hemi=new HemisphericLight('sky light',V(0,1,0),scene);hemi.intensity=gritty?.85:.7;hemi.diffuse=C('#b9d9e4');hemi.groundColor=C('#333e48');
 const sun=new DirectionalLight('late afternoon',V(-.55,-.85,.35),scene);sun.diffuse=C(style.sun);sun.intensity=gritty?.65:1.3;sun.position=V(100,180,-100);
 const shadow=new ShadowGenerator(1024,sun);shadow.usePercentageCloserFiltering=true;shadow.bias=.002;shadow.normalBias=.04;shadow.filteringQuality=ShadowGenerator.QUALITY_MEDIUM;sun.autoUpdateExtends=false;sun.shadowMinZ=1;sun.shadowMaxZ=400;sun.orthoLeft=-75;sun.orthoRight=75;sun.orthoTop=75;sun.orthoBottom=-75;
 const pipeline=new DefaultRenderingPipeline('race finish',true,scene,[camera]);pipeline.fxaaEnabled=true;pipeline.bloomEnabled=true;pipeline.bloomThreshold=.85;pipeline.bloomWeight=gritty?.08:.17;pipeline.bloomKernel=32;pipeline.imageProcessingEnabled=true;pipeline.imageProcessing.exposure=1.05;pipeline.imageProcessing.contrast=gritty?1.2:1.15;pipeline.imageProcessing.toneMappingEnabled=true;
 const glow=new GlowLayer('lights',scene,{blurKernelSize:24});glow.intensity=gritty?.18:.35;
 function mat(name,color,emission=0){const m=new StandardMaterial(name,scene);m.diffuseColor=C(color);m.specularColor=C('#75808a').scale(.35);if(emission)m.emissiveColor=C(color).scale(emission);return m;}
 const asphalt=mat('asphalt','#303f49'),shoulder=mat('concrete','#69777c'),stripe=mat('lane paint','#aab7ad'),rail=mat('guardrail','#314852'),cyan=mat('cyan reflectors','#7ee4d6',.3),amber=mat('amber reflectors','#ffc783',.6),dark=mat('rubber','#10191f'),glass=mat('smoked glass','#243d4b');glass.specularColor=C('#d2e8ef');glass.specularPower=96;
 // Deterministic procedural textures: modern materials are authored here, not bundled game assets.
 const roadTexture=new DynamicTexture('road grain',{width:256,height:256},scene,false),rc=roadTexture.getContext();let seed=831;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};rc.fillStyle='#657078';rc.fillRect(0,0,256,256);for(let i=0;i<15000;i++){const k=Math.floor(80+rnd()*65);rc.fillStyle=`rgba(${k},${k},${k},.22)`;rc.fillRect(rnd()*256,rnd()*256,1,1);}roadTexture.update();roadTexture.uScale=3;roadTexture.vScale=350;asphalt.diffuseTexture=gritty?asphaltTexture(scene):roadTexture;if(gritty){asphalt.diffuseColor=C('#535b5d');asphalt.specularColor=C('#344043');shoulder.diffuseColor=C('#636d6d');stripe.diffuseColor=C('#a0a596');}
 const sky=MeshBuilder.CreateSphere('Pacific sky',{diameter:2800,segments:24},scene);sky.infiniteDistance=true;sky.isPickable=false;glow.addExcludedMesh(sky);
 const data=track(assets.get(city.id.toUpperCase()+'.TRK')),pts=prepareRoad(data.points.slice(0,-2).map(p=>({x:p.x*S,y:p.z*S,z:p.y*S})),city.id).map(p=>V(p.x,p.y,p.z));
 const tangent=i=>pts[(i+1)%pts.length].subtract(pts[(i+pts.length-1)%pts.length]).normalize();
 function offset(i,w,h=0){const t=tangent(i),horizontal=Math.hypot(t.x,t.z);return pts[i].add(V(-t.z/horizontal*w,h,t.x/horizontal*w));}
 function ribbon(name,a,b,m,h){const paths=[[],[]];for(let i=0;i<=pts.length;i++){paths[0].push(offset(i%pts.length,a,h));paths[1].push(offset(i%pts.length,b,h));}const mesh=MeshBuilder.CreateRibbon(name,{pathArray:paths,sideOrientation:Mesh.DOUBLESIDE},scene);mesh.material=m;mesh.receiveShadows=true;if(gritty&&name==='original road footprint'){const uv=[];let distance=0;const distances=[0];for(let i=1;i<=pts.length;i++){distance+=Vector3.Distance(pts[i%pts.length],pts[i-1]);distances.push(distance);}const count=mesh.getTotalVertices(),row=pts.length+1;for(let v=0;v<count;v++)uv.push(Math.floor((v%(row*2))/row),distances[v%row]/24);mesh.setVerticesData('uv',uv);}return mesh;}
 ribbon('road shoulder',-7.5,7.5,shoulder,-.055);ribbon('original road footprint',-5.8,5.8,asphalt,0);ribbon('left edge',-5.65,-5.53,stripe,.025);ribbon('right edge',5.53,5.65,stripe,.025);
 // Visible rails match the driving corridor (6.5 m centre clearance + car width).
 ribbon('left safety rail',-7.6,-7.35,rail,.5);ribbon('right safety rail',7.35,7.6,rail,.5);
 function box(name,w,h,d,p,m,parent){const b=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);b.position.copyFrom(p);b.material=m;if(parent)b.parent=parent;return b;}
 for(let i=0;i<pts.length;i+=8){const t=tangent(i),yaw=Math.atan2(t.x,t.z);if(i%16===0){const paths=[[],[]];for(let k=-1;k<=2;k++){const j=(i+k+pts.length)%pts.length;paths[0].push(offset(j,-.055,.035));paths[1].push(offset(j,.055,.035));}const dash=MeshBuilder.CreateRibbon('surface-following center dash',{pathArray:paths,sideOrientation:Mesh.DOUBLESIDE},scene);dash.material=stripe;}
  for(const side of [-1,1]){const b=box('edge reflector',.12,.16,1.2,offset(i,side*7.1,.12),side<0?cyan:amber);b.rotation.y=yaw;b.rotation.x=-Math.asin(t.y);}
 }
 // Pit markings use the same sampled road elevation; negative offset is the driver's right.
 const pitIndex=config.pitIndex??1138,pitPaint=mat('pit service turquoise','#65d7bd',.15),pitPaths=[[],[]];
 for(let i=pitIndex+1;i<pitIndex+60;i++){pitPaths[0].push(offset(i,-6.5,.045));pitPaths[1].push(offset(i,-3.4,.045));}
 const pitSurface=MeshBuilder.CreateRibbon(city.name+' pit service lane',{pathArray:pitPaths,sideOrientation:Mesh.DOUBLESIDE},scene);pitSurface.material=pitPaint;
 const signTexture=new DynamicTexture('pit sign lettering',{width:512,height:128},scene,false);signTexture.drawText('PIT  →  STOP',24,85,'bold 54px sans-serif','#dcf68a','#142b30',true);const signMaterial=mat('pit sign','#ffffff');signMaterial.diffuseTexture=signTexture;signMaterial.emissiveTexture=signTexture;signMaterial.emissiveColor=C('#ffffff').scale(.3);signMaterial.backFaceCulling=false;
 for(const i of [pitIndex,pitIndex+40]){const t=tangent(i),anchor=offset(i,-12,3);if(!clearsRoad(pts,anchor.x,anchor.z,2.6))continue;const board=box('pit service sign',5,1.25,.12,anchor,signMaterial);board.rotation.y=Math.atan2(t.x,t.z);box('pit sign post',.12,3,.12,offset(i,-12,1.5),rail);}
 const crossing=CROSSING_REPAIRS[city.id];
 if(crossing){
  const paths=[[],[]];for(let i=crossing.upper-14;i<=crossing.upper+14;i++){paths[0].push(offset(i,-7.6,-.35));paths[1].push(offset(i,7.6,-.35));}
  const deck=MeshBuilder.CreateRibbon('overpass underside',{pathArray:paths,sideOrientation:Mesh.DOUBLESIDE},scene);deck.material=rail;
  const base=Math.min(...pts.map(p=>p.y))-1.1;
  for(const i of [crossing.upper-17,crossing.upper+17])for(const side of [-1,1]){const p=offset(i,side*10);if(!clearsRoad(pts,p.x,p.z,.8))continue;const h=p.y-base-.4;if(h>0)box('overpass support',1.1,h,1.1,V(p.x,base+h/2,p.z),shoulder);}
 }
 const lampSites=[],lampLens=mat('street lamp lens','#ded5b8',0);
 // Repeating track furniture, entirely outside the original road footprint.
 for(let i=0;i<pts.length;i+=36){const t=tangent(i),yaw=Math.atan2(t.x,t.z);for(const side of [-1,1]){const anchor=offset(i,side*9);if(!clearsRoad(pts,anchor.x,anchor.z,.2))continue;const root=new TransformNode('lamp anchor',scene);root.position=anchor;root.rotation.y=yaw+Math.PI;box('lamp pole',.12,6,.12,V(0,3,0),rail,root);box('lamp arm',2,.12,.16,V(-side*.9,6,0),rail,root);box('lamp lens',1.6,.05,.2,V(-side*.9,5.92,0),lampLens,root);const lens=offset(i,side*8.1,5.92),aim=offset(i,side*3,0);lampSites.push({position:lens,direction:aim.subtract(lens).normalize()});for(const m of root.getChildMeshes()){m.setParent(null);}root.dispose();}}
 // City backdrop stays clear of the original drivable corridor.
 const buildings=style.palette.map((color,i)=>mat(city.name+' facade '+i,color));
 const windows=new DynamicTexture('windows',{width:128,height:256},scene,false),wc=windows.getContext();wc.fillStyle='#a7aeb0';wc.fillRect(0,0,128,256);for(let y=5;y<256;y+=12)for(let x=4;x<128;x+=12){wc.fillStyle=rnd()>.58?'#e3d7ae':'#667785';wc.fillRect(x,y,5,7);}windows.update();for(const m of buildings){m.diffuseTexture=windows;m.emissiveColor=C(style.palette[buildings.indexOf(m)]).scale(.04);}
 const minX=Math.min(...pts.map(p=>p.x)),maxX=Math.max(...pts.map(p=>p.x)),minZ=Math.min(...pts.map(p=>p.z)),maxZ=Math.max(...pts.map(p=>p.z));
 const groundY=Math.min(...pts.map(p=>p.y))-1.1;
 const ground=MeshBuilder.CreateGround('harbor apron',{width:4000,height:4000},scene);ground.position=V((minX+maxX)/2,groundY,(minZ+maxZ)/2);ground.material=mat('harbor ground',city.ground);ground.receiveShadows=true;ground.material.specularColor=Color3.Black();
 if(city.water){const water=MeshBuilder.CreateGround('puget sound',{width:3500,height:1500},scene);water.position=V((minX+maxX)/2,groundY+.1,minZ-850);water.material=mat('water','#487d89');water.material.specularColor=C('#d3b890');water.material.specularPower=64;}
 const scenery=cityScenery(pts,city),foliage=mat('city foliage',style.plant==='cactus'?'#527765':style.plant==='pine'?'#315c52':'#5e8052'),bark=mat('tree trunks','#79634d');
 for(const b of scenery.buildings){const tower=box(city.name+' skyline',b.w,b.h,b.d,V(b.x,groundY+b.h/2,b.z),buildings[b.variant]);tower.freezeWorldMatrix();
  if(b.h>35){box('stepped rooftop',b.w*.7,4,b.d*.7,V(b.x,groundY+b.h+2,b.z),buildings[b.variant]);box('roof plant',b.w*.3,2,b.d*.3,V(b.x,groundY+b.h+5,b.z),rail);}
  else if(city.id==='boston'){box('brick cornice',b.w+.5,.6,b.d+.5,V(b.x,groundY+b.h,b.z),shoulder);}
 }
 function cylinder(name,x,y,z,h,top,bottom,material,segments=8){const m=MeshBuilder.CreateCylinder(name,{height:h,diameterTop:top,diameterBottom:bottom,tessellation:segments},scene);m.position=V(x,y,z);m.material=material;return m;}
 for(const p of scenery.plants){const y=groundY;
  cylinder('roadside trunk',p.x,y+p.h/2,p.z,p.h,.25,.5,style.plant==='cactus'?foliage:bark);
  if(style.plant==='pine'){for(let j=0;j<3;j++)cylinder('evergreen crown',p.x,y+p.h*.6+j*1.2,p.z,3,0,4.5-j,foliage);}
  else if(style.plant==='palm'){for(let j=0;j<6;j++){const angle=j*Math.PI/3,m=box('palm frond',.7,.14,3.5,V(p.x+Math.sin(angle)*1.4,y+p.h,p.z+Math.cos(angle)*1.4),foliage);m.rotation.y=angle;m.rotation.x=.22;}}
  else if(style.plant==='cactus'){for(const side of [-1,1]){box('cactus arm',1.2,.35,.35,V(p.x+side*.5,y+p.h*.55,p.z),foliage);cylinder('cactus finger',p.x+side*1.1,y+p.h*.65,p.z,p.h*.25,.35,.45,foliage);}}
  else{const crown=MeshBuilder.CreateSphere('broadleaf crown',{diameter:4.8,segments:4},scene);crown.position=V(p.x,y+p.h-.5,p.z);crown.material=foliage;}
 }
 // Landmark silhouettes are outside the entire road bounds, including overpasses.
 const {x:lx,z:lz}=scenery.landmark,base=groundY;
 const monument=mat('city landmark',style.palette[2]),accent=mat('city landmark accent',style.landmark==='bridge'?'#c36748':'#b1c6c8');
 if(style.landmark==='arch'||style.landmark==='wheel'){
  const path=[];for(let i=0;i<=48;i++){const angle=i/48*(style.landmark==='arch'?Math.PI:Math.PI*2);path.push(V(lx+Math.cos(angle)*32,base+(style.landmark==='arch'?0:38)+Math.sin(angle)*32,lz));}
  const hoop=MeshBuilder.CreateTube('city '+style.landmark,{path,radius:style.landmark==='arch'?1.8:.7,tessellation:8},scene);hoop.material=accent;
  if(style.landmark==='wheel'){for(let i=0;i<12;i++){const a=i*Math.PI/6;box('wheel gondola',3,3,3,V(lx+Math.cos(a)*32,base+38+Math.sin(a)*32,lz),buildings[i%3]);}box('wheel support',3,38,3,V(lx,base+19,lz),accent);}
 }else if(style.landmark==='bridge'){
  for(const x of [-50,50]){box('bridge tower',5,65,8,V(lx+x,base+32.5,lz),accent);for(const off of [-2,2]){const path=[];for(let i=0;i<=32;i++){const t=i/32;path.push(V(lx-75+t*150,base+22+40*Math.abs(Math.cos(t*Math.PI*2)),lz+off));}const cable=MeshBuilder.CreateTube('bridge cable',{path,radius:.35,tessellation:6},scene);cable.material=accent;}}
  box('distant bridge deck',155,2,12,V(lx,base+22,lz),shoulder);
 }else if(style.landmark==='mesa'||style.landmark==='hills'){
  for(let i=0;i<3;i++)cylinder('desert silhouette',lx+(i-1)*45,base+18+i*5,lz+i*12,36+i*10,style.landmark==='mesa'?40:0,70,monument,6);
 }else if(style.landmark==='needle'){
  cylinder('Space Needle shaft',lx,base+34,lz,68,1.2,4,accent,12);cylinder('Space Needle deck',lx,base+66,lz,4,14,20,accent,24);cylinder('Space Needle crown',lx,base+70,lz,4,0,14,cyan,24);cylinder('Space Needle mast',lx,base+76,lz,10,.3,1,accent);
 }else if(style.landmark==='industry'){
  for(let i=0;i<3;i++){cylinder('industrial silo',lx+i*22-22,base+15,lz,30,12,12,monument,16);cylinder('industrial chimney',lx+i*22-22,base+42,lz+17,40,2,3,accent);}
 }else{
  const height=style.landmark==='clock'?45:100;box('landmark tower',22,height,22,V(lx,base+height/2,lz),monument);
  box('landmark crown',14,12,14,V(lx,base+height+6,lz),accent);
  for(const x of style.landmark==='twin'?[-6,6]:[0])cylinder('landmark spire',lx+x,base+height+24,lz,30,.25,1.2,accent);
  if(style.landmark==='clock'){const face=new DynamicTexture('clock face',128,scene,false);face.drawText('XII',34,35,'bold 22px serif','#28383d','#e6dcc2',true);const ctx=face.getContext();ctx.strokeStyle='#28383d';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(64,38);ctx.lineTo(64,64);ctx.lineTo(85,78);ctx.stroke();face.update();const dial=mat('clock dial','#ffffff');dial.diffuseTexture=face;for(const side of [-1,1])box('clock face',12,12,.1,V(lx,base+height-8,lz+side*11.1),dial);}
 }
 // Decode source polygon silhouettes; the highest-detail group retains the original shape identity.
 const source=models(assets.get('SHAPE.TBL'));
 const playerModels=[0,1,2].map(i=>models(assets.get(`MYCAR${i}.TBL`))[0]);
 source.push(...playerModels);
 // Merge static batches by material to keep browser draw calls bounded.
 function batchStatic(){for(const m of scene.materials){const list=scene.meshes.filter(x=>x.material===m&&x.getTotalVertices()>0&&!x.parent);const groups=new Map();for(const mesh of list){const key=mesh.getVerticesDataKinds().sort().join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(mesh);}for(const group of groups.values())if(group.length>1){const merged=Mesh.MergeMeshes(group,true,true,undefined,false,false);if(merged){merged.name='static '+m.name;merged.receiveShadows=true;merged.freezeWorldMatrix();}}}}
 function model(name,id,material,parent){const src=source[id];if(!src)return null;const positions=[],indices=[],uvs=[];const used=src.details[0].groups.flatMap(g=>g.faces.flatMap(f=>f.indices.map(i=>src.vertices[i]))),lo={x:Math.min(...used.map(p=>p.x)),y:Math.min(...used.map(p=>p.y)),z:Math.min(...used.map(p=>p.z))},hi={x:Math.max(...used.map(p=>p.x)),y:Math.max(...used.map(p=>p.y)),z:Math.max(...used.map(p=>p.z))};const unit=(p,k)=>(p[k]-lo[k])/Math.max(1,hi[k]-lo[k]);for(const g of src.details[0].groups)for(const f of g.faces){if(f.indices.length<3)continue;const start=positions.length/3,a=src.vertices[f.indices[0]],b=src.vertices[f.indices[1]],c=src.vertices[f.indices[2]],nx=(b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y),ny=(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z),nz=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),panel=Math.abs(nz)>=Math.max(Math.abs(nx),Math.abs(ny))?0:Math.abs(nx)>Math.abs(ny)?1:2;for(const vi of f.indices){const p=src.vertices[vi];positions.push(p.x*S,p.z*S,p.y*S);uvs.push((panel+(panel===1?unit(p,'y'):unit(p,'x')))/3,panel===0?unit(p,'y'):unit(p,'z'));}for(let k=1;k<f.indices.length-1;k++)indices.push(start,start+k,start+k+1);}
 const mesh=new Mesh(name,scene),vd=new VertexData();vd.positions=positions;vd.indices=indices;vd.uvs=uvs;vd.normals=[];VertexData.ComputeNormals(positions,indices,vd.normals);vd.applyToMesh(mesh);mesh.material=material;mesh.material.backFaceCulling=false;mesh.parent=parent;return mesh;}
 // Original scenery coordinates can intersect another branch at the Seattle loop.
 // Check the entire model footprint; move it outward, or omit it if no safe site exists.
 for(const [i,o]of data.objects.entries()){
  const src=source[o.shape];if(!src)continue;
  const minX=Math.min(...src.vertices.map(v=>v.x))*S,maxX=Math.max(...src.vertices.map(v=>v.x))*S;
  const minZ=Math.min(...src.vertices.map(v=>v.y))*S,maxZ=Math.max(...src.vertices.map(v=>v.y))*S;
  const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2,radius=Math.hypot(maxX-minX,maxZ-minZ)/2;
  const index=Math.min(o.index,pts.length-1),origin=V(o.x*S,o.z*S,o.y*S),out=origin.subtract(pts[index]);out.y=0;
  if(out.lengthSquared()<.001){const t=tangent(index);out.set(-t.z,0,t.x);}out.normalize();
  let placement=null;
  for(let distance=0;distance<=100;distance+=2){const p=origin.add(out.scale(distance));if(clearsRoad(pts,p.x+cx,p.z+cz,radius)){placement=p;break;}}
  if(!placement)continue;
  const m=model('original roadside '+i,o.shape,shoulder);if(m){m.position=placement;m.receiveShadows=true;}
 }
 batchStatic();
 const environmentCasters=gritty?scene.meshes.filter(m=>m.name.startsWith('static '+city.name+' facade')||m.name==='static guardrail'):[];
 const reflections=new ReflectionProbe('harbor reflections',128,scene);reflections.position=pts[65].add(V(0,3,0));reflections.renderList=scene.meshes.slice();reflections.refreshRate=0;
 const atmosphere=createAtmosphere({scene,sky,sun,hemi,asphalt,reflections,city,surface:createRainSurfaces(scene.meshes.filter(m=>m.name==='original road footprint'||m.name==='road shoulder'||m.name==='static concrete'||m.name.startsWith('static '+city.name+' facade')),groundY)});
 const contactTexture=cloudTexture(scene,'contact shadow');const contactMaterial=mat('contact shadow','#080e10');contactMaterial.diffuseTexture=contactTexture;contactMaterial.useAlphaFromDiffuseTexture=true;contactMaterial.alpha=.65;contactMaterial.specularColor=Color3.Black();
 const cars=colors.map((color,i)=>{const root=new TransformNode('driver '+i,scene),paint=new PBRMaterial('livery '+i,scene);paint.albedoColor=C(color);const maps=carTextures(scene,i);paint.albedoTexture=maps.paint;paint.metallicTexture=maps.surface;paint.useRoughnessFromMetallicTextureAlpha=false;paint.useRoughnessFromMetallicTextureGreen=true;paint.useMetallnessFromMetallicTextureBlue=true;paint.metallic=.7;paint.roughness=1;paint.twoSidedLighting=true;paint.forceNormalForward=true;paint.emissiveColor=Color3.Black();paint.clearCoat.isEnabled=true;paint.clearCoat.intensity=.25;paint.clearCoat.roughness=.5;paint.reflectionTexture=reflections.cubeTexture;paint.environmentIntensity=.8;
 const body=model('original car '+i,i===0?124+(config.car??0):34+(i-1)*10,paint,root);shadow.addShadowCaster(body);body.receiveShadows=true;
 const contact=MeshBuilder.CreateGround('car contact',{width:3.8,height:6},scene);contact.parent=root;contact.position.y=.025;contact.material=contactMaterial;contact.isPickable=false;
 const cabin=box('glass canopy',1.25,.35,1.1,V(0,.85,-.1),glass,root);cabin.rotation.x=.1;
 const brakeMaterial=mat('brake light '+i,'#e05b45',.25),brakeLamps=[];
 box('rear diffuser',1.65,.14,.28,V(0,.18,-1.45),dark,root);for(const x of [-.72,.72])box('exhaust tip',.18,.18,.35,V(x,.2,-1.55),rail,root);
 const wheels=[];for(const x of [-.93,.93])for(const z of [-.95,1]){const wheel=MeshBuilder.CreateCylinder('tire',{height:.27,diameter:.65,tessellation:12},scene);wheel.rotation.z=Math.PI/2;wheel.position=V(x,.3,z);wheel.parent=root;wheel.material=dark;wheels.push(wheel);const hub=MeshBuilder.CreateCylinder('alloy wheel',{height:.29,diameter:.37,tessellation:8},scene);hub.parent=wheel;hub.material=rail;}
 const headMaterial=mat('headlight lens '+i,'#d7eaff',.3);
 for(const x of [-.6,.6]){box('headlamp',.42,.09,.08,V(x,.4,1.55),headMaterial,root);brakeLamps.push(box('brake lamp',.45,.08,.08,V(x,.48,-1.4),brakeMaterial,root));}
 const flash=box('muzzle flash',.32,.28,.7,V(0,.65,2.85),amber,root);flash.setEnabled(false);
 for(const x of [-.35,.35])box('machine gun barrel',.13,.13,.7,V(x,.65,2.25),dark,root);
 const spikes=[];for(const x of [-.65,.65]){const m=MeshBuilder.CreateCylinder('ram spike',{height:.8,diameterTop:0,diameterBottom:.3,tessellation:6},scene);m.parent=root;m.position=V(x,.45,1.9);m.rotation.x=Math.PI/2;m.material=rail;spikes.push(m);}for(const x of [-1.2,1.2])for(const z of [-.95,1]){const m=MeshBuilder.CreateCylinder('wheel spike',{height:.45,diameterTop:0,diameterBottom:.22,tessellation:6},scene);m.parent=root;m.position=V(x,.3,z);m.rotation.z=x<0?Math.PI/2:-Math.PI/2;m.material=rail;spikes.push(m);}
 box('rear wing',2.05,.08,.35,V(0,1.1,-1.1),dark,root);return {root,body,paint,wheels,flash,spikes,brakeMaterial,headMaterial,contact,lastSpeed:0,shape:34+(i-1)*10};});
 shadow.getShadowMap().renderList.push(...environmentCasters);
 const combatEffects=createCombatEffects(scene);
 const tracers=Array.from({length:48},()=>{const m=box('machine gun tracer',.07,.07,2.8,V(0,0,0),amber);m.setEnabled(false);return m;});
 const laserLight=mat('laser cyan','#65e4ef',1),particleLight=mat('particle violet','#d5a3ff',1);
 const energyRays=Array.from({length:24},()=>{const m=box('energy beam',.1,.1,1,V(0,0,0),laserLight);m.setEnabled(false);return m;});
 const rocketPaint=mat('rocket orange','#ff885d',.6),missilePaint=mat('missile gold','#f2d56b',.6);
 const ordnance=Array.from({length:32},()=>{const root=new TransformNode('ordnance',scene);const body=box('projectile',.28,.28,1.5,V(0,0,0),rocketPaint,root);box('exhaust',.16,.16,2.3,V(0,0,-1.6),amber,root);box('horizontal fins',.75,.06,.45,V(0,0,-.4),rail,root);box('vertical fins',.06,.75,.45,V(0,0,-.4),rail,root);root.setEnabled(false);return {root,body};});
 const hazardMeshes=Array.from({length:64},()=>{const root=new TransformNode('rear hazard',scene);const mine=MeshBuilder.CreateCylinder('mine',{height:.22,diameter:.9,tessellation:12},scene);mine.parent=root;mine.material=rocketPaint;box('arming light',.22,.08,.22,V(0,.15,0),amber,mine);const caltrop=new TransformNode('caltrop',scene);caltrop.parent=root;for(const angle of [0,Math.PI/3,-Math.PI/3]){const m=box('steel prong',.09,.65,.09,V(0,.2,0),rail,caltrop);m.rotation.z=angle;}root.setEnabled(false);return {root,mine,caltrop};});
 const bursts=Array.from({length:32},()=>{const m=MeshBuilder.CreateSphere('impact burst',{diameter:.3,segments:4},scene);m.material=amber;m.setEnabled(false);return m;});
 const smokePaint=mat('damage smoke','#59636a');smokePaint.alpha=.42;
 const damageSmoke=cars.map((car,id)=>Array.from({length:3},(_,i)=>{const m=MeshBuilder.CreateSphere('engine smoke '+id+' '+i,{diameter:1,segments:4},scene);m.material=smokePaint;m.setEnabled(false);return m;}));
 let smokeTime=0;
 // Start gantry and an authored sign give the opening straight a clear focal point.
 const gate=110,p=pts[gate],t=tangent(gate),yaw=Math.atan2(t.x,t.z),gantry=new TransformNode('start gantry',scene);gantry.position=p;gantry.rotation.y=yaw;
 for(const x of [-8,8])box('gantry upright',.5,7,.5,V(x,3.5,0),rail,gantry);box('gantry beam',16,1.8,.6,V(0,6.2,0),rail,gantry);
 const sign=new DynamicTexture('race sign',{width:1024,height:128},scene,false),sc=sign.getContext();sc.fillStyle='#182b34';sc.fillRect(0,0,1024,128);sc.fillStyle='#d8ed9b';sc.font='bold 53px sans-serif';sc.textAlign='center';sc.fillText('DEATHTRACK / '+city.name.toUpperCase(),512,82);sign.update();const sm=mat('sign','#ffffff',.15);sm.diffuseTexture=sign;sm.emissiveTexture=sign;const plane=MeshBuilder.CreatePlane('gantry lettering',{width:14.5,height:1.65,sideOrientation:Mesh.DOUBLESIDE},scene);plane.parent=gantry;plane.position=V(0,6.2,-.32);plane.material=sm;
 let latest=null,mode='chase',quality='high',lastTime=0,cameraReady=false;
 const cameraTarget=V(0,0,0);
 const rearCamera=new FreeCamera('rear-view camera',V(0,0,0),scene);rearCamera.inputs.clear();rearCamera.minZ=.15;rearCamera.maxZ=350;rearCamera.fov=.85;
 const rearTexture=new RenderTargetTexture('rear-view',{width:512,height:160},scene,false);rearTexture.activeCamera=rearCamera;rearTexture.renderList=null;rearTexture.ignoreCameraViewport=true;
 const rearLayer=new Layer('rear-view overlay',null,scene,false);rearLayer.texture=rearTexture;rearLayer.isEnabled=false;
 // Never draw the mirror into its own render target. Its camera starts behind the player body.
 rearLayer.renderTargetTextures=[];
 let mirrorEnabled=true;
 let reducedMotion=false;
 function mirrorLayout(){const rect=document.querySelector('#rear-view')?.getBoundingClientRect();if(!rect)return;const sx=rect.width/innerWidth,sy=rect.height/innerHeight,ox=(rect.left+rect.width/2)/innerWidth*2-1,oy=1-(rect.top+rect.height/2)/innerHeight*2;rearLayer.scale.set(sx,sy);rearLayer.offset.set(ox,oy);rearTexture.uScale=-1/sx;rearTexture.uOffset=(1+ox+sx)/(2*sx);rearTexture.vScale=1/sy;rearTexture.vOffset=-(1+oy-sy)/(2*sy);}

 function push(s){latest=s;if(!s){combatEffects.clear();atmosphere.clear();}if(!s){for(const p of [...ordnance,...hazardMeshes])p.root.setEnabled(false);for(const m of [...tracers,...bursts,...energyRays])m.setEnabled(false);for(const car of cars)car.flash.setEnabled(false);for(const cloud of damageSmoke.flat())cloud.setEnabled(false);}}
 function draw(now){const dt=Math.min(.05,(now-lastTime)/1000||.016);lastTime=now;
  const car=cars[0],c=latest?.cars[0];combatEffects.update(latest,quality,reducedMotion);
  if(c){
   if(latest.running)smokeTime+=dt;
   for(let i=0;i<cars.length;i++){const r=cars[i],pose=latest.cars[i],weapon=latest.combat?.states[i];r.root.setEnabled(i===0||!pose.finished);
    r.spikes.forEach((m,j)=>m.scaling.y=1+(j<2?(weapon?.ram??0):(weapon?.wheel??0))*.25);r.flash.setEnabled(!!weapon&&weapon.flash>0&&!pose.finished);r.paint.albedoColor=C(colors[i]).scale(weapon?.disabled ? .25 : weapon?.shield ? .65 : .55+.45*(weapon?.condition[5]??1));
    damageSmoke[i].forEach((m,j)=>{const damaged=weapon&&(weapon.disabled||weapon.condition[0]<.35||weapon.condition[5]<.3);m.setEnabled(reducedMotion&&!!damaged&&!pose.finished);if(damaged){const age=reducedMotion?.35+j*.25:(smokeTime*.5+j/3)%1;m.position.set(pose.x+Math.sin(pose.yaw)*1.2+age*.4,pose.y+1+age*3,pose.z+Math.cos(pose.yaw)*1.2);m.scaling.setAll(.5+age*1.6);}});
    r.contact.setEnabled(!pose.airborne);
    const braking=latest.running&&r.lastSpeed-pose.speed>dt*1.5;r.brakeMaterial.emissiveColor=C('#ff4b32').scale(braking?2:.25);r.lastSpeed=pose.speed;
    r.root.position.set(pose.x,pose.y,pose.z);r.root.rotation.set(pose.pitch,pose.yaw,pose.roll);
    for(const w of r.wheels){w.rotation.x-=(latest.running?dt:0)*pose.speed/.325;if(w.position.z>0)w.rotation.y=pose.steer*.28;}
   }
   tracers.forEach((m,i)=>{const s=latest.combat?.shots[i];m.setEnabled(!!s);if(s){m.position.set(s.x,s.y,s.z);m.rotation.y=Math.atan2(s.vx,s.vz);m.rotation.x=-Math.atan2(s.vy,Math.hypot(s.vx,s.vz));}});
   energyRays.forEach((m,i)=>{const beam=latest.combat?.beams[i];m.setEnabled(!!beam);if(beam){const {start:a,end:b}=beam,dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;m.position.set((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);m.rotation.set(-Math.atan2(dy,Math.hypot(dx,dz)),Math.atan2(dx,dz),0);m.scaling.set(beam.kind===2?2.5:1,beam.kind===2?2.5:1,Math.hypot(dx,dy,dz));m.material=beam.kind===2?particleLight:laserLight;}});
   ordnance.forEach(({root,body},i)=>{const p=latest.combat?.projectiles[i];root.setEnabled(!!p);if(p){root.position.set(p.x,p.y,p.z);root.rotation.set(-Math.atan2(p.vy,Math.hypot(p.vx,p.vz)),Math.atan2(p.vx,p.vz),0);body.material=p.kind===4?missilePaint:rocketPaint;}});
   hazardMeshes.forEach(({root,mine,caltrop},i)=>{const h=latest.combat?.hazards[i];root.setEnabled(!!h);if(h){root.position.set(h.x,h.y,h.z);mine.setEnabled(h.kind===5);caltrop.setEnabled(h.kind===6);root.scaling.setAll(h.age<.6?.7:1);}});
   bursts.forEach((m,i)=>{const e=latest.combat?.effects[i];m.setEnabled(reducedMotion&&!!e);if(e){m.position.set(e.x,e.y,e.z);const size=e.big?1.2:.4;m.scaling.setAll(Math.max(.1,size));}});
   const p=car.root.position,t=V(Math.sin(c.yaw),0,Math.cos(c.yaw));
   const distance=10+Math.min(c.speed/25,2);
   const eye=mode==='cockpit'?p.add(t.scale(.45)).add(V(0,1.15,0)):p.subtract(t.scale(distance)).add(V(0,4.5,0));
   const target=p.add(t.scale(mode==='cockpit'?50:9+c.speed*.12)).add(V(0,mode==='cockpit'?1.15:1.1,0));
   if(!cameraReady){camera.position.copyFrom(eye);cameraTarget.copyFrom(target);cameraReady=true;}
   else{Vector3.LerpToRef(camera.position,eye,1-Math.exp(-(mode==='cockpit'?25:7)*dt),camera.position);Vector3.LerpToRef(cameraTarget,target,1-Math.exp(-10*dt),cameraTarget);}
   camera.setTarget(cameraTarget);camera.rotation.z=reducedMotion?0:Math.sin(now*.045)*(latest.impact||0)*.012;camera.fov+=(.88+(reducedMotion?0:Math.min(c.speed/60,1)*.13)-camera.fov)*(1-Math.exp(-3*dt));
   car.root.setEnabled(mode!=='cockpit');sun.position.copyFrom(p.subtract(sun.direction.scale(160)));
  }else{const p=pts[110],t=tangent(110);camera.position.copyFrom(p.subtract(t.scale(15)).add(V(-2,5,12)));camera.setTarget(p.add(t.scale(28)));car.root.position.copyFrom(p);car.root.rotation.y=Math.atan2(t.x,t.z);for(let i=1;i<cars.length;i++)cars[i].root.setEnabled(false);}
  const showRear=!!c&&mirrorEnabled&&document.querySelector('#rear-view')?.getBoundingClientRect().width>0;
  rearLayer.isEnabled=showRear;scene.customRenderTargets=showRear?[rearTexture]:[];
  if(showRear){mirrorLayout();const t=V(Math.sin(c.yaw),0,Math.cos(c.yaw));rearCamera.position=V(c.x,c.y+1.6,c.z).subtract(t.scale(3));rearCamera.setTarget(rearCamera.position.subtract(t.scale(60)).add(V(0,Math.sin(c.pitch)*60,0)));}
  atmosphere.update(dt,camera.position,!!latest?.running,quality,reducedMotion,latest?.cars?.[0]);
  nightLighting.update(latest?.running?dt:0,latest?.cars,camera.position,atmosphere.darkness,quality);
  scene.activeCamera=camera;engine.beginFrame();scene.render();engine.endFrame();
 }
 const nightLighting=createNightLighting(scene,lampSites,cars,lampLens,scene.meshes.filter(m=>['original road footprint','road shoulder','static concrete','static guardrail','overpass underside'].includes(m.name)));
 const resize=()=>engine.resize();addEventListener('resize',resize);
 return {setLocalShadows:nightLighting.setShadows,get localShadows(){return nightLighting.shadows;},get nightLights(){return nightLighting.active;},setAtmosphere:atmosphere.set,get atmosphereStatus(){return atmosphere.status;},get weatherParticles(){return atmosphere.particles;},get target(){const id=latest?.combat?.states[0].target,c=id>=0?latest.cars[id]:null;if(!c)return null;const v=Vector3.Project(V(c.x,c.y+1,c.z),Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()));if(v.z<0||v.z>1)return null;return {x:v.x/engine.getRenderWidth()*100,y:v.y/engine.getRenderHeight()*100};},setCar(id){const c=cars[0];shadow.removeShadowCaster(c.body);c.body.dispose();c.body=model('original player car',124+id,c.paint,c.root);c.body.receiveShadows=true;shadow.addShadowCaster(c.body);},get aim(){if(!latest)return null;const c=latest.cars[0],p=V(c.x+Math.sin(c.yaw)*Math.cos(c.pitch)*45,c.y+.65-Math.sin(c.pitch)*45,c.z+Math.cos(c.yaw)*Math.cos(c.pitch)*45);const v=Vector3.Project(p,Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()));return {x:v.x/engine.getRenderWidth()*100,y:v.y/engine.getRenderHeight()*100};},setReducedMotion(value){reducedMotion=!!value;},setMirror(value){mirrorEnabled=value;},draw,push,points:pts,data,resetCamera:()=>{cameraReady=false;},setCamera:m=>{mode=m;cameraReady=false;},setQuality:q=>{quality=q;shadow.getShadowMap().resize(q==='high'?1024:512);rearTexture.resize(q==='high'?{width:512,height:160}:{width:384,height:120});rearTexture.refreshRate=q==='high'?1:2;shadow.getShadowMap().renderList=quality==='high'?[...cars.map(c=>c.body),...environmentCasters]:cars.map(c=>c.body);pipeline.bloomEnabled=q==='high';glow.isEnabled=q==='high';engine.setHardwareScalingLevel(q==='high'?Math.max(1,devicePixelRatio/1.5):Math.max(1.5,devicePixelRatio));},dispose(){removeEventListener('resize',resize);scene.dispose();engine.dispose();},get effectParticles(){return combatEffects.activeParticles;},get fps(){return Math.round(engine.getFps());}};
}
