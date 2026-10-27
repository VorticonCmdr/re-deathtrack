import {clearsRoad} from './road.js';
// Art direction, not replicas of real-world streets or landmark dimensions.
export const CITY_STYLE={
 orlando:{roof:'#244b62',horizon:'#f2d2a2',sun:'#ffe6bb',palette:['#e3c8a2','#a4c6bd','#d7b695'],height:35,count:95,plant:'palm',landmark:'wheel'},
 bay_area:{roof:'#284558',horizon:'#dfbd91',sun:'#ffdfb1',palette:['#8caaa8','#b8ae91','#768b92'],height:65,count:130,plant:'pine',landmark:'bridge'},
 phoenix:{roof:'#483b60',horizon:'#edb07d',sun:'#ffd1a0',palette:['#bb8b65','#d5b28b','#927863'],height:25,count:75,plant:'cactus',landmark:'mesa'},
 nyc:{roof:'#202d4b',horizon:'#b9c3cf',sun:'#dae5ff',palette:['#506171','#6e7783','#96928b'],height:130,count:210,plant:'tree',landmark:'spire'},
 st_louis:{roof:'#384757',horizon:'#e3bd99',sun:'#ffe1b6',palette:['#ad8069','#947e72','#7b9095'],height:50,count:115,plant:'tree',landmark:'arch'},
 la:{roof:'#473e62',horizon:'#efbd9b',sun:'#ffcfaa',palette:['#c1aaa0','#aaafbc','#dfc6a3'],height:55,count:120,plant:'palm',landmark:'hills'},
 seattle:{roof:'#20364d',horizon:'#afc3c3',sun:'#d8e6ee',palette:['#456171','#637d80','#778c8e'],height:80,count:135,plant:'pine',landmark:'needle'},
 houston:{roof:'#29485c',horizon:'#dfc2a5',sun:'#ffe2b7',palette:['#719ba7','#a8b6ad','#69777b'],height:90,count:130,plant:'tree',landmark:'industry'},
 boston:{roof:'#333e58',horizon:'#dcc5b0',sun:'#ffe1bf',palette:['#965e51','#b28167','#757d80'],height:38,count:135,plant:'tree',landmark:'clock'},
 chicago:{roof:'#273c59',horizon:'#b6cfda',sun:'#e2ecff',palette:['#586b81','#8097a2','#88919a'],height:115,count:180,plant:'tree',landmark:'twin'},
};
export function cityScenery(points,city){
 const style=CITY_STYLE[city.id];let seed=Array.from(city.id).reduce((s,c)=>s*31+c.charCodeAt(0),7)>>>0;
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minZ=Math.min(...points.map(p=>p.z)),maxZ=Math.max(...points.map(p=>p.z));
 const buildings=[],plants=[];
 for(let i=0;i<style.count;i++){const x=minX-150+random()*(maxX-minX+300),z=minZ-150+random()*(maxZ-minZ+300),w=9+random()*16,d=9+random()*16,h=8+random()**2*style.height,radius=Math.hypot(w,d)/2;
  if(clearsRoad(points,x,z,radius,5))buildings.push({x,z,w,d,h,radius,variant:i%3});
 }
 for(let i=0;i<points.length;i+=28){const p=points[i],a=points[(i+1)%points.length],dx=a.x-p.x,dz=a.z-p.z,len=Math.hypot(dx,dz);if(!len)continue;
  const side=i%56?1:-1,offset=14+random()*9,x=p.x-dz/len*offset*side,z=p.z+dx/len*offset*side,radius=style.plant==='palm'?3.5:2.8;
  if(clearsRoad(points,x,z,radius,2)&&!buildings.some(b=>Math.hypot(b.x-x,b.z-z)<b.radius+radius+2))plants.push({x,z,y:p.y,h:5+random()*4,radius});
 }
 const landmark={x:minX-140,z:(minZ+maxZ)/2,radius:105};
 return {style,buildings,plants,landmark};
}
