// Modern arcade simulation. World units are treated as metres; no DOS state is used.
export const STEP = 1 / 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function createDriving(points, start = 110, spec = {}) {
  spec={maxSpeed:62,acceleration:13,braking:23,grip:9,stability:1,...spec};
  const segments = points.map((a, i) => {
    const b = points[(i + 1) % points.length], dx = b.x - a.x, dz = b.z - a.z;
    return {a, b, dx, dz, length: Math.hypot(dx, dz)};
  });
  const baseSpec={...spec};
  function setCondition(c){spec.maxSpeed=baseSpec.maxSpeed*(.4+.6*c[0]);spec.acceleration=baseSpec.acceleration*(.4+.6*c[2]);spec.braking=baseSpec.braking*(.25+.75*c[1]);spec.grip=baseSpec.grip*(.35+.65*c[3]);spec.stability=baseSpec.stability*(.7+.3*c[4]);}
  let length = 0;
  for (const s of segments) { s.distance = length; length += s.length; }
  function project(x, z, hint) {
    let best = null;
    // Local continuity prevents jumping between nearby sections of the circuit.
    const count = hint == null ? segments.length : 65;
    for (let k = 0; k < count; k++) {
      const i = hint == null ? k : (hint + k - 32 + segments.length) % segments.length;
      const s = segments[i];
      if (s.length < .001) continue;
      const t = clamp(((x - s.a.x) * s.dx + (z - s.a.z) * s.dz) / s.length ** 2, 0, 1);
      const px = mix(s.a.x, s.b.x, t), pz = mix(s.a.z, s.b.z, t), d = (x - px) ** 2 + (z - pz) ** 2;
      if (!best || d < best.d) best = {i, t, x: px, z: pz, y: mix(s.a.y, s.b.y, t), d,
        tx: s.dx / s.length, tz: s.dz / s.length, distance: s.distance + t * s.length,
        slope: (s.b.y - s.a.y) / s.length};
    }
    return best;
  }
  let current, previous, road, elapsed, lapStart, bestLap = null, lastLap = null, laps, travel;
  function reset(index = start, lateral = 0) {
    const s = segments[index];
    current = {x:s.a.x, y:s.a.y+.03, z:s.a.z, yaw:Math.atan2(s.dx,s.dz), vx:0, vz:0, vy:0, airborne:false, suspension:0, landing:0, landingSpeed:0, landingCount:0, steer:0, pitch:0, roll:0, speed:0, offroad:false};
    current.x += Math.cos(current.yaw)*lateral; current.z -= Math.sin(current.yaw)*lateral;
    previous = {...current}; road = project(current.x,current.z,index);
    elapsed = lapStart = laps = 0; travel = s.distance-segments[start].distance; lastLap = null; bestLap = null;
  }
  reset();
  function step(input, dt = STEP) {
    previous = {...current}; const c = current;c.landing=Math.max(0,c.landing-dt);c.suspension=Math.max(0,c.suspension-dt);const flying=c.airborne;
    const f = {x:Math.sin(c.yaw), z:Math.cos(c.yaw)}, right = {x:f.z,z:-f.x};
    let forward = c.vx*f.x+c.vz*f.z, lateral = c.vx*right.x+c.vz*right.z;
    c.steer += (input.steer-c.steer)*(1-Math.exp(-8*dt));
    const grip = input.handbrake ? 2.2 : c.offroad ? 4 : spec.grip;
    if(!flying)lateral *= Math.exp(-grip*dt);
    // Speed-sensitive steering and a bicycle yaw model, with a lateral-acceleration cap.
    const steerAngle = c.steer * (.48 / (1 + Math.abs(forward)/24));
    const yawRate = flying?0:clamp(forward/2.7*Math.tan(steerAngle), -1.35*spec.stability, 1.35*spec.stability);
    c.yaw += yawRate*dt;
    const acceleration = (flying?0:input.throttle)*spec.acceleration*(1-Math.max(0,forward)/spec.maxSpeed);
    forward += (acceleration - Math.sign(forward)*(.6+.003*forward*forward) - (flying?0:road.slope*9.81))*dt;
    const braking = flying?0:(input.brake*spec.braking + (input.handbrake ? 9 : 0))*dt;
    if (braking) forward = Math.sign(forward)*Math.max(0,Math.abs(forward)-braking);
    if (c.offroad&&!flying) forward *= Math.exp(-1.2*dt);
    if (!input.throttle && Math.abs(forward)<.08) forward=0;
    // Reconstruct in the old body frame: direction changes produce real lateral slip.
    c.vx=f.x*forward+right.x*lateral; c.vz=f.z*forward+right.z*lateral;
    c.x+=c.vx*dt; c.z+=c.vz*dt;
    const next=project(c.x,c.z,road.i);
    const lateralDistance=(c.x-next.x)*next.tz-(c.z-next.z)*next.tx;
    c.offroad=Math.abs(lateralDistance)>5.5;
    // Forgiving shoulder followed by a physical corridor boundary. No point snapping.
    if (Math.abs(lateralDistance)>6.5) {
      const sign=Math.sign(lateralDistance), nx=next.tz*sign, nz=-next.tx*sign;
      const penetration=Math.abs(lateralDistance)-6.5;
      c.x-=nx*penetration; c.z-=nz*penetration;
      const outward=c.vx*nx+c.vz*nz;
      if(outward>0){c.vx-=outward*nx*1.12;c.vz-=outward*nz*1.12;}
      c.vx*=.985;c.vz*=.985;
    }
    let delta=next.distance-road.distance;
    if(delta>length/2)delta-=length;if(delta<-length/2)delta+=length;
    travel+=delta; elapsed+=dt;
    if(travel>=(laps+1)*length){lastLap=elapsed-lapStart;bestLap=bestLap==null?lastLap:Math.min(bestLap,lastLap);lapStart=elapsed;laps++;}
    const ground=next.y+.03,groundVy=dt>0?(next.y-road.y)/dt:0;
    const crest=project(c.x+c.vx*.18,c.z+c.vz*.18,next.i);
    const fallsAway=ground+c.vy*.18-4.905*.18*.18>crest.y+.13;
    const ballistic=c.y+c.vy*dt-4.905*dt*dt;
    if(flying){c.vy-=9.81*dt;c.y=ballistic;if(c.y<=ground){c.landingSpeed=Math.max(0,groundVy-c.vy);c.landing=1;c.landingCount++;c.airborne=false;c.suspension=.25;c.y=ground;c.vy=groundVy;const loss=clamp((c.landingSpeed-7)*.012,0,.18);c.vx*=1-loss;c.vz*=1-loss;}}
    else if(c.suspension===0&&fallsAway&&c.speed>8&&ballistic>ground+.001){c.airborne=true;c.y=ballistic;c.vy-=9.81*dt;}
    else{c.y=ground;c.vy=groundVy;}
    road=next;c.speed=Math.hypot(c.vx,c.vz);
    const pitchTarget=c.airborne?-Math.atan2(c.vy,Math.max(1,c.speed)):-Math.atan(next.slope);
    c.pitch+=(pitchTarget-c.pitch)*(1-Math.exp(-(c.airborne?3:10)*dt));
    c.roll+=(-yawRate*forward*.002/spec.stability-c.roll)*(1-Math.exp(-7*dt));
  }
  function recover() {
    const s=segments[road.i];current.x=road.x;current.z=road.z;current.y=road.y+.03;
    current.yaw=Math.atan2(s.dx,s.dz);current.vx=0;current.vz=0;current.speed=0;current.steer=0;current.vy=0;current.airborne=false;current.suspension=0;current.landing=0;current.landingSpeed=0;current.pitch=-Math.atan(road.slope);current.roll=0;
    previous={...current};
  }
  return {step,reset,recover,setCondition,hold(dt=0){previous={...current};if(current.airborne&&dt>0){current.y+=current.vy*dt-4.905*dt*dt;current.vy-=9.81*dt;if(current.y<=road.y+.03){current.landingSpeed=Math.max(0,-current.vy);current.landingCount++;current.landing=1;current.airborne=false;current.y=road.y+.03;current.vy=0;}}},length,get road(){return road;},get distance(){return travel;},get state(){return current;},get telemetry(){return {elapsed,lapTime:elapsed-lapStart,lastLap,bestLap,laps,progress:clamp((travel-laps*length)/length,0,1)};},
    interpolate(alpha){return {...current,x:mix(previous.x,current.x,alpha),y:mix(previous.y,current.y,alpha),z:mix(previous.z,current.z,alpha),yaw:previous.yaw+angleDelta(previous.yaw,current.yaw)*alpha,pitch:mix(previous.pitch,current.pitch,alpha),roll:mix(previous.roll,current.roll,alpha)};}};
}
