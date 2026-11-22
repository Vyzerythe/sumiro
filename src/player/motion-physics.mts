/**
 * Reconstructed integrated player collision/airborne/landing mechanics.
 * Published oracle: player-1_KrBWnI.js, functions ze, vt, bt.
 * This is a compatible replacement for a bounded player-physics slice,
 * not a new movement design or the original unbundled source.
 */
import type { MovingTriangleBody } from '../physics/moving-body.mts';
import type { CapsuleHit, CapsuleOptions, CollisionPosition, CollisionSurface, CollisionWorld } from '../physics/world.mts';
import type { movementConfig } from './movement-config.mts';

type MovementConfig = typeof movementConfig;
type ChangeState = (state: string) => void;
type SurfaceName = (surface: CollisionSurface) => CollisionSurface;
type PlayClip = (name: string, options: { fade: number; speed?: number }) => void;

interface HorizontalMotion extends CollisionPosition {
  vx: number;
  vz: number;
}

interface SurfaceMotion extends HorizontalMotion {
  surface: CollisionSurface;
  lastGroundY: number;
}

export interface GroundContactState extends SurfaceMotion {
  carrier: MovingTriangleBody | null;
  drift: { x: number; z: number };
}

export interface AirborneState extends SurfaceMotion {
  vy: number;
  speed: number;
  stickX: number;
  stickZ: number;
  stickMag: number;
  heading: number;
  state: string;
  stateT: number;
  jumpCut: boolean;
  guardsInAir: boolean;
  drift: { x: number; z: number; air: number };
  noGrab: number;
  fromY: number;
}

export interface LandingState extends HorizontalMotion {
  carrier: MovingTriangleBody | null;
  grounded: boolean;
  guardsInAir: boolean;
  vy: number;
  coyote: number;
  fade: number;
  dissolve: number;
  rootY: number;
  lastGroundY: number;
  airDashed: boolean;
  landHeavy: boolean;
  stickMag: number;
  jumpBuf: number;
}

interface CollisionEffects {
  world: Pick<CollisionWorld, 'sweepCapsule' | 'groundAt'>;
  collision: CapsuleHit;
  deflect(collision: CapsuleHit): void;
  surfaceName: SurfaceName;
}

export interface GroundContactEffects extends CollisionEffects {
  bodyCapsule: CapsuleOptions;
  probeOffset: number;
  hasSupport(x: number, z: number): boolean;
  hasSafeDrop(x: number, z: number, dx: number, dz: number): boolean;
  hasHigherGround(x: number, z: number, dx: number, dz: number): boolean;
  estimateNormal(x: number, z: number, fallbackX: number, fallbackZ: number, collision: CapsuleHit): void;
}

export interface AirborneEffects<Mantle> extends CollisionEffects {
  jumpHeld: boolean;
  guardedCapsule: CapsuleOptions;
  normalCapsule: CapsuleOptions;
  groundTolerance: number;
  play?: PlayClip;
  changeState: ChangeState;
  grabLedge?(): boolean;
  land(dropHeight: number): void;
  tryWallMantle?(): boolean;
  probeMantle?(): Mantle | null;
  beginMantle?(mantle: Mantle): void;
  updateFall?(): void;
}

export interface LandingEffects {
  world: Pick<CollisionWorld, 'groundAt'>;
  shake?(strength: number): void;
  sound?(name: string): void;
  hurt?(reason: string): void;
  isDead?(): boolean;
  die?(): void;
  play?: PlayClip;
  footstep?(side: 'R' | 'L', action: 'land', force: boolean): void;
  changeState: ChangeState;
  consumeBufferedJump(): void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
function wrapAngle(x: number) {
  let out=(x+Math.PI)%(Math.PI*2);
  if(out<0)out+=Math.PI*2;
  return out-Math.PI;
}

/**
 * Sweep a grounded player, test support and guard/surface transitions.
 * Returns the original supported-ground boolean. Mutable collision result
 * and callbacks are provided by the original controller.
 */
export function stepGroundContact(state: GroundContactState, delta: number,
  config: Pick<MovementConfig, 'stepUp' | 'stepDown'>, effects: GroundContactEffects) {
  const {world,collision,bodyCapsule}=effects;
  world.sweepCapsule(state,(state.vx+state.drift.x)*delta,
    (state.vz+state.drift.z)*delta,bodyCapsule,collision);
  const support=world.groundAt(collision.x,collision.z,
    state.y+config.stepUp,state.y-config.stepDown);
  if(!support) {
    const speed=Math.hypot(state.vx,state.vz)||1;
    if(world.groundAt(collision.x+state.vx/speed*effects.probeOffset,
      collision.z+state.vz/speed*effects.probeOffset,
      state.y+config.stepUp,state.y-config.stepDown)) {
      state.x=collision.x;state.z=collision.z;
      return true;
    }
    if(collision.hit&&(collision.body||state.carrier) ||
      !effects.hasSupport(state.x,state.z)) {
      state.x=collision.x;state.z=collision.z;
      return false;
    }
    const length=Math.hypot(state.vx,state.vz)||1;
    if(effects.hasSafeDrop(collision.x,collision.z,
      state.vx/length,state.vz/length)) {
      state.x=collision.x;state.z=collision.z;
      return false;
    }
    collision.hit=true;
    collision.kind=effects.hasHigherGround(collision.x,collision.z,
      state.vx/length,state.vz/length)?2:4;
    effects.estimateNormal(collision.x,collision.z,
      -state.vx/length,-state.vz/length,collision);
    effects.deflect(collision);
    const alternate=world.groundAt(
      state.x+state.vx*delta,state.z+state.vz*delta,
      state.y+config.stepUp,state.y-config.stepDown);
    if(alternate) {
      state.x+=state.vx*delta;
      state.z+=state.vz*delta;
      state.y=alternate.y;
    } else {
      state.vx=state.vz=0;
    }
    state.lastGroundY=state.y;
    return true;
  }
  state.x=collision.x;state.z=collision.z;
  state.y=support.y;
  state.surface=effects.surfaceName(support.surface);
  state.lastGroundY=support.y;
  state.carrier=support.body;
  if(collision.hit)effects.deflect(collision);
  return true;
}

/**
 * Original airborne frame integration. Gameplay hooks cover grabbing,
 * mantling, landing, damage/fade, audio and animation.
 */
export function stepAirborne<Mantle,>(state: AirborneState, delta: number,
  config: Pick<MovementConfig, 'airMin' | 'airAccel' | 'jumpCut' | 'gravity'>, effects: AirborneEffects<Mantle>) {
  let velocity=Math.hypot(state.vx,state.vz);
  if(state.stickMag>.1) {
    const desiredSpeed=Math.max(velocity,config.airMin);
    const targetX=state.stickX*desiredSpeed;
    const targetZ=state.stickZ*desiredSpeed;
    const diffX=targetX-state.vx;
    const diffZ=targetZ-state.vz;
    const length=Math.hypot(diffX,diffZ)||1;
    const amount=Math.min(config.airAccel*delta,length);
    state.vx+=diffX/length*amount;
    state.vz+=diffZ/length*amount;
    const angularLimit=5*delta;
    state.heading=wrapAngle(state.heading+clamp(
      wrapAngle(Math.atan2(-state.vx,-state.vz)-state.heading),
      -angularLimit,angularLimit));
  }
  if(state.state==='JUMP'&&!state.jumpCut&&!effects.jumpHeld &&
    state.vy>0&&state.stateT>.06) {
    state.vy*=config.jumpCut;
    state.jumpCut=true;
  }
  state.vx+=state.drift.x*state.drift.air*delta;
  state.vz+=state.drift.z*state.drift.air*delta;
  const priorY=state.y;
  state.vy-=config.gravity*delta;
  state.y+=state.vy*delta;
  const contact=effects.collision;
  effects.world.sweepCapsule(state,state.vx*delta,state.vz*delta,
    state.guardsInAir?effects.guardedCapsule:effects.normalCapsule,contact);
  state.x=contact.x;state.z=contact.z;
  if(contact.hit)effects.deflect(contact);
  state.speed=Math.hypot(state.vx,state.vz);
  if(state.state==='JUMP'&&state.vy< -1.5) {
    effects.play?.('fall',{fade:.25});
    effects.changeState('FALL');
  }
  if(state.noGrab>0) state.noGrab-=delta;
  else if(state.vy<3&&effects.grabLedge?.())return;
  if(state.vy<=0) {
    const ground=effects.world.groundAt(state.x,state.z,
      Math.max(priorY+.1,state.y+effects.groundTolerance),state.y-.02);
    if(ground) {
      state.y=ground.y;
      state.surface=effects.surfaceName(ground.surface);
      state.lastGroundY=ground.y;
      effects.land(state.fromY-state.y);
      return;
    }
    if(state.stickMag>.1&&state.vy> -7) {
      if(contact.solid &&
        -(state.stickX*contact.nx+state.stickZ*contact.nz) >
          .3*state.stickMag && effects.tryWallMantle?.())return;
      const mantle=effects.probeMantle?.();
      if(mantle && effects.beginMantle) {
        effects.beginMantle(mantle);
        return;
      }
    }
  }
  effects.updateFall?.();
}

/** Land after a drop or jump, with carrier momentum and heavy-fall effects. */
export function finishLanding(state: LandingState, dropHeight: number,
  config: Pick<MovementConfig, 'heavyFall'>, effects: LandingEffects) {
  state.carrier=effects.world.groundAt(state.x,state.z,
    state.y+.2,state.y-.3)?.body??null;
  if(state.carrier) {
    state.vx-=state.carrier.vx;
    state.vz-=state.carrier.vz;
  }
  state.grounded=true;state.guardsInAir=false;
  state.vy=0;state.coyote=0;state.fade=0;state.dissolve=0;
  state.rootY=state.y;state.lastGroundY=state.y;
  state.airDashed=false;
  state.landHeavy=dropHeight>config.heavyFall;
  if(state.landHeavy) {
    effects.shake?.(1);
    effects.sound?.('heavyLanding');
    effects.hurt?.('fall');
    if(effects.isDead?.()) {
      effects.die?.();
      return;
    }
  } else if(dropHeight>2) effects.shake?.(.35);
  const moving=!state.landHeavy&&state.stickMag>.1&&
    Math.hypot(state.vx,state.vz)>2;
  effects.play?.(state.landHeavy?'land_heavy':'land',{
    fade:.12,speed:moving?1.6:1,
  });
  effects.footstep?.('R','land',dropHeight>1.5||state.landHeavy);
  effects.footstep?.('L','land',dropHeight>1.5||state.landHeavy);
  effects.changeState('LAND');
  if(state.jumpBuf>0)effects.consumeBufferedJump();
}
