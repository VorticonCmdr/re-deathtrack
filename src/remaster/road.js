// Modern-only surface conditioning. Source data and the faithful port stay unchanged.
export function smoothRoad(points) {
  const n = points.length;
  const result = points.map((p, i) => {
    let height = 0, weight = 0;
    // Remove integer elevation quantization without flattening hills. Wrap the seam.
    for (let k = -8; k <= 8; k++) {
      const w = Math.exp(-.5 * (k / 3) ** 2);
      height += points[(i + k + n) % n].y * w; weight += w;
    }
    return {x:p.x, y:height/weight, z:p.z};
  });
  // Bay Area contains a repeated XY sample. Smoothing must not turn that
  // zero-length span into a vertical face; keep source indices for pit tables.
  const same=(a,b)=>a.x===b.x&&a.z===b.z;
  for(let i=0;i<n;i++){
    if(same(result[i],result[(i+n-1)%n]))continue;
    const group=[i];let j=(i+1)%n;
    while(j!==i&&same(result[i],result[j])){group.push(j);j=(j+1)%n;}
    if(group.length>1){const height=group.reduce((sum,k)=>sum+result[k].y,0)/group.length;for(const k of group)result[k].y=height;}
  }
  return result;
}

// Conservative circular footprint versus every centreline segment, not sparse points.
// Includes shoulders/rails and a little breathing room. Used only for decoration.
export function clearsRoad(points, x, z, radius, margin = .75) {
  const clearance = 7.6 + radius + margin;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const dx = b.x-a.x, dz = b.z-a.z, length2 = dx*dx+dz*dz;
    const t = length2 ? Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/length2)) : 0;
    if ((x-a.x-t*dx)**2+(z-a.z-t*dz)**2 < clearance**2) return false;
  }
  return true;
}

// These source overpasses have insufficient clearance for modern cars/cameras.
// Keep XY and sample indices intact; only lift the upper branch in the remaster.
export const CROSSING_REPAIRS={nyc:{upper:287,lower:1005},boston:{upper:1153,lower:666}};
export function prepareRoad(points,cityId){
 const road=smoothRoad(points),repair=CROSSING_REPAIRS[cityId];if(!repair)return road;
 const distance=[0];for(let i=0;i<road.length;i++){const a=road[i],b=road[(i+1)%road.length];distance.push(distance.at(-1)+Math.hypot(b.x-a.x,b.z-a.z));}
 const length=distance.at(-1),center=distance[repair.upper],gap=i=>{const d=Math.abs(distance[i]-center);return Math.min(d,length-d);};
 const lowerCenter=distance[repair.lower],lower=road.filter((_,i)=>{const d=Math.abs(distance[i]-lowerCenter);return Math.min(d,length-d)<22;});
 const upper=road.filter((_,i)=>gap(i)<22),lift=Math.max(0,7+Math.max(...lower.map(p=>p.y))-Math.min(...upper.map(p=>p.y)));
 for(let i=0;i<road.length;i++){const d=gap(i);if(d>=142)continue;const t=Math.max(0,Math.min(1,(d-22)/120)),smooth=t*t*t*(t*(t*6-15)+10);road[i].y+=lift*(1-smooth);}
 return road;
}
