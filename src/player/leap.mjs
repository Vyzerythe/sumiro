/**
 * Compatibility reconstruction of player leap routing and flight lifecycle.
 * Reference: immutable player-1_KrBWnI.js, functions st / $ / ct / lt /
 * ut / dt / ft. This is not the original unbundled source.
 *
 * Numeric quirks, mutable target objects and call ordering intentionally match
 * the shipped runtime until separately proven gameplay improvements exist.
 */
import { pointInPolygon } from '../physics/geometry.mts';

const clamp = (value, lower, upper) => Math.min(Math.max(value, lower), upper);
const wrapAngle = angle => {
  let result = (angle + Math.PI) % (Math.PI * 2);
  if (result < 0) result += Math.PI * 2;
  return result - Math.PI;
};
const smoothstep = (start, end, frame) => {
  const t = clamp((frame - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Convert authored ledge rim indices to arc-length endpoints. */
export function resolveLeapRim(ledge, position) {
  return ledge.rimStep
    ? ledge.s[clamp(Math.round((position - ledge.rimFrom) / ledge.rimStep), 0, ledge.points.length - 1)]
    : clamp(position, 0, ledge.length);
}

/**
 * Resolve target along destination ledge or free landing region.
 * Direction is a scratch object shared with the caller, as in the bundle.
 */
export function resolveLeapTarget(state, link, ledges, world, direction, scratch,
  ledgeOffset = .26, hangingHeight = 2.1) {
  const dx = direction.x, dz = direction.z;
  if (link.to.ledge) {
    const ledge = ledges.get(link.to.ledge);
    const first = resolveLeapRim(ledge, link.to.sFrom);
    const last = resolveLeapRim(ledge, link.to.sTo);
    let selected = first, best = Infinity;
    for (let distance = first; distance <= last + 1e-6; distance += .1) {
      ledge.at(distance, scratch);
      const deltaX = scratch.x - state.x;
      const deltaZ = scratch.z - state.z;
      const metric = link.fromLedge ? Math.hypot(deltaX, deltaZ)
        : deltaX * -dz + deltaZ * dx;
      if (Math.abs(metric) < best) {
        best = Math.abs(metric);
        selected = distance;
      }
    }
    ledge.at(selected, scratch);
    return {
      x: scratch.x + scratch.ox * ledgeOffset,
      y: scratch.y - hangingHeight,
      z: scratch.z + scratch.oz * ledgeOffset,
      ledge, s: selected,
    };
  }
  let [x,z] = link.to.land;
  const body = link.to.body ? world.body(link.to.body) : null;
  if (body) { body.toWorld(x, 0, z, scratch); x = scratch.x; z = scratch.z; }
  const relativeX = x - state.x, relativeZ = z - state.z;
  const spread = clamp(relativeX * -dz + relativeZ * dx,
    -link.to.spread, link.to.spread);
  const finalX = x - -dz * spread, finalZ = z - dx * spread;
  const ground = world.groundAt(finalX, finalZ);
  const height = ground ? ground.y : state.y;
  return {
    x: finalX, y: height, z: finalZ, ledge:null, body,
    local:body ? body.toLocal(finalX,height,finalZ) : null,
  };
}

/** Check all authored jump links, preserving original insertion order. */
export function findLeapLink(state, level, ledges, world, direction, scratch,
  destination, pointTest = pointInPolygon) {
  for (const link of level.leapLinks) {
    const from = link.from;
    if (!from?.poly) continue;
    const sample = from.body
      ? world.body(from.body)?.toLocal(state.x,state.y,state.z,scratch)
      : state;
    if (!sample || !pointTest(sample.x,sample.z,from.poly) ||
      from.yMin !== undefined && state.y < from.yMin ||
      from.yMax !== undefined && state.y > from.yMax ||
      state.recentSpeed < link.minSpeed &&
        !(state.state === 'TEETER' && state.stickMag > .1)) continue;
    const target = destination(link);
    if (!target) continue;
    const length = Math.hypot(target.x-state.x,target.z-state.z) || 1;
    if (!(((target.x-state.x)*direction.x +
      (target.z-state.z)*direction.z)/length <
      Math.cos(link.maxAngle*Math.PI/180))) return {link,t:target};
  }
  return null;
}

/** Original authored leap initiation, with callback-injected player effects. */
export function beginLeap(state, view, link, target, config, effects) {
  const distance = Math.hypot(target.x-state.x,target.z-state.z);
  const duration = Math.max(
    link.exactTime ?? link.time * clamp(distance/(link.nominal??7.4),.55,1.25),
    distance/config.leapMaxSpeed,
  );
  const gravity = config.leapGravity;
  state.leap = {
    link,t:target,time:duration,
    x0:state.x,y0:state.y,z0:state.z,
    vy:(target.y-state.y)/duration+.5*gravity*duration,
    clipStarted:false,
    heading:target.ledge ?
      Math.atan2(target.ledge.at(target.s).ox,target.ledge.at(target.s).oz)
      : Math.atan2(-(target.x-state.x),-(target.z-state.z)),
  };
  state.leap.y1 = target.y;
  state.carrier=null; state.grounded=false; state.guardsInAir=false;
  state.fromY=state.y; state.coyote=0;
  effects.lockHeading();
  view.kind='leap';view.p=0;view.link=link;
  view.landX=target.ledge?null:target.x;
  view.landZ=target.z;
  if (state.state!=='HANG' && state.state!=='SHIMMY' && state.state!=='GRAB') {
    effects.play('jump_windup',{fade:.05,speed:2.4});
    effects.footstep('R','takeoff',true);
  } else {
    effects.play(link.clip,{fade:.08,speed:effects.duration(link.clip)/duration});
    state.leap.clipStarted=true;
  }
  effects.changeState('LEAP');
}

/** In-flight animated trajectory and collision interrupt, followed by landing. */
export function advanceLeap(state, view, elapsed, config, effects) {
  const leap=state.leap, time=state.stateT;
  const progress=Math.min(time/leap.time,1);
  if (!leap.clipStarted && effects.finished()) {
    leap.clipStarted=true;
    const remaining=Math.max(leap.time-time,.2);
    effects.play(leap.link.clip,{fade:.05,speed:effects.duration(leap.link.clip)/remaining});
  }
  if (leap.t.ledge?.body) {
    leap.t.ledge.at(leap.t.s,effects.scratch);
    leap.t.x=effects.scratch.x+effects.scratch.ox*effects.ledgeOffset;
    leap.t.y=effects.scratch.y-effects.hangingHeight;
    leap.t.z=effects.scratch.z+effects.scratch.oz*effects.ledgeOffset;
  } else if (leap.t.body) {
    leap.t.body.toWorld(leap.t.local.x,leap.t.local.y,leap.t.local.z,leap.t);
  }
  const nextX=leap.x0+(leap.t.x-leap.x0)*progress;
  const nextZ=leap.z0+(leap.t.z-leap.z0)*progress;
  if (!leap.link.exactTime && !leap.t.body && !leap.t.ledge?.body &&
    progress < effects.collisionUntil) {
    effects.world.sweepCapsule(state,nextX-state.x,nextZ-state.z,
      effects.capsule,effects.collision);
    if (Math.hypot(effects.collision.x-nextX,effects.collision.z-nextZ)>.03) {
      effects.abort();
      return;
    }
  }
  state.x=nextX;state.z=nextZ;
  const t=Math.min(time,leap.time);
  state.y=leap.y0+leap.vy*t-.5*config.leapGravity*t**2+
    (leap.t.y-leap.y1)*progress;
  state.heading=wrapAngle(state.heading+
    wrapAngle(leap.heading-state.heading)*(1-Math.exp(-9*elapsed)));
  state.vy=leap.vy-config.leapGravity*time;
  view.p=progress;
  if (!leap.t.ledge && progress>.6 && effects.top()?.name!=='fall') {
    effects.play('fall',{fade:.22});
  }
  if (progress<1) return;
  const vx=(leap.t.x-leap.x0)/leap.time;
  const vz=(leap.t.z-leap.z0)/leap.time;
  view.kind=null;state.leap=null;
  if (leap.t.ledge) effects.grab(leap.t.ledge,leap.t.s);
  else {
    state.y=leap.t.y;
    state.vx=vx*.5;state.vz=vz*.5;
    state.speed=Math.hypot(state.vx,state.vz);
    state.heading=Math.atan2(-state.vx,-state.vz);
    effects.land(leap.y0-state.y);
  }
}

/** Original interrupted-leap transition. */
export function abortLeap(state,view,config,effects) {
  const leap=state.leap;
  state.vx=(leap.t.x-leap.x0)/leap.time*.3;
  state.vz=(leap.t.z-leap.z0)/leap.time*.3;
  effects.deflect(effects.collision);
  state.vy=Math.min(leap.vy-config.leapGravity*state.stateT,0);
  state.x=effects.collision.x;state.z=effects.collision.z;
  state.fromY=leap.y0;state.guardsInAir=false;
  state.leap=null;view.kind=null;
  effects.play('fall',{fade:.14});
  effects.changeState('FALL');
}
