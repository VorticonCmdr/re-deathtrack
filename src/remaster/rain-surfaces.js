// Static, world-space surface index. Query only triangles in one 16 m cell,
// never raycast the whole scene per drop. Highest surface wins at crossings.
export function createRainSurfaces(meshes,ground){
 const cells=new Map(),size=16;
 for(const mesh of meshes){
  const vertices=mesh.getVerticesData('position'),indices=mesh.getIndices();if(!vertices||!indices)continue;
  // These static batches already contain world-space vertices.
  for(let i=0;i<indices.length;i+=3){
   const p=indices.slice(i,i+3).map(j=>({x:vertices[j*3],y:vertices[j*3+1],z:vertices[j*3+2]})),[a,b,c]=p;
   const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(den)<.00001)continue;
   const tri={a,b,c,den};
   for(let x=Math.floor(Math.min(...p.map(v=>v.x))/size);x<=Math.floor(Math.max(...p.map(v=>v.x))/size);x++)for(let z=Math.floor(Math.min(...p.map(v=>v.z))/size);z<=Math.floor(Math.max(...p.map(v=>v.z))/size);z++){
    const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(tri);
   }
  }
 }
 return (x,z)=>{let height=ground;for(const {a,b,c,den} of cells.get(Math.floor(x/size)+','+Math.floor(z/size))??[]){
  const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;
  if(u>=-.00001&&v>=-.00001&&u+v<=1.00001)height=Math.max(height,u*a.y+v*b.y+(1-u-v)*c.y);
 }return height;};
}
