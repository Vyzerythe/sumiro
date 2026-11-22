/** Active traversal animation from the shipped player and anim-DUsNrsnS.js. */
import { AnimationMixer, Mesh, SkinnedMesh } from 'three';
import type { AnimationAction, Group, Skeleton } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { disposeGLTF, type AssetManager, type AssetRequestOptions } from '../assets/asset-manager.mts';
import { movementConfig as tuning } from './movement-config.mts';
import type { createTraversalController } from './traversal-controller.mts';

type TraversalState = ReturnType<typeof createTraversalController>['state'];
export type AnimatedPlayerState = Pick<TraversalState,
  'x' | 'y' | 'z' | 'heading' | 'vx' | 'vz' | 'grounded' | 'state' | 'stateT' | 'landHeavy' | 'stickMag'
> & Partial<Pick<TraversalState, 'jumpClip' | 'gestureClip' | 'gestureSpeed'>>;

const PLAYER_MODEL = 'player/player.glb';
const GAIT_CLIPS = ['stand_idle', 'walk', 'jog', 'run', 'sprint'] as const;
const ACTION_CLIPS = ['jump_up', 'jump_fwd', 'fall', 'land', 'land_heavy'] as const;
const GESTURE_CLIPS = ['jump_windup', 'leap_generic', 'wall_leap', 'hang_idle', 'climb_up', 'dodge', 'ink_step'] as const;
type GaitClip = (typeof GAIT_CLIPS)[number];
type ActionClip = (typeof ACTION_CLIPS)[number] | (typeof GESTURE_CLIPS)[number];
type PlayerClip = GaitClip | ActionClip;

interface Layer {
  clip: ActionClip | 'gait';
  time: number;
  speed: number;
  weight: number;
  fade: number;
  entering: boolean;
}

export interface AnimatedPlayer {
  readonly root: Group;
  readonly mixer: AnimationMixer;
  duration(name: string): number;
  update(state: AnimatedPlayerState, delta: number): void;
  reset(state?: AnimatedPlayerState): void;
  dispose(): void;
}

const ease = (value: number) => value * value * (3 - 2 * value);
const band = (low: number, high: number, value: number) => ease(Math.min(1, Math.max(0, (value - low) / (high - low))));

function releaseModel(model: GLTF) {
  model.scene?.removeFromParent();
  const skeletons = new Set<Skeleton>();
  for (const scene of model.scenes) scene.traverse(object => {
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const skeleton of skeletons) skeleton.dispose();
  disposeGLTF(model);
}

/** Takes exclusive ownership of the loaded model and its GPU resources. */
export function createAnimatedPlayer(model: GLTF): AnimatedPlayer {
  const root = model.scene;
  const clips = new Map(model.animations.map(clip => [clip.name, clip]));
  const actions = new Map<PlayerClip, AnimationAction>();
  let playerMixer: AnimationMixer | undefined;
  try {
    if (!root) throw Error('Player model has no default scene');
    for (const name of [...GAIT_CLIPS, ...ACTION_CLIPS]) {
      const clip = clips.get(name);
      if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) throw Error(`Player clip ${name} is missing or invalid`);
    }
    root.name = 'player';
    root.rotation.order = 'YXZ';
    root.traverse(object => { if (object instanceof Mesh) object.frustumCulled = false; });
    playerMixer = new AnimationMixer(root);
    for (const name of [...GAIT_CLIPS, ...ACTION_CLIPS, ...GESTURE_CLIPS]) {
      const clip = clips.get(name);
      if (!clip) continue;
      const action = playerMixer.clipAction(clip).play();
      action.setEffectiveWeight(0);
      action.paused = true;
      actions.set(name, action);
    }
  } catch (error) {
    playerMixer?.stopAllAction().uncacheRoot(root);
    releaseModel(model);
    throw error;
  }

  const mixer = playerMixer;
  let layers: Layer[] = [];
  let gaitSpeed = 0;
  let phase = 0;
  let idleTime = 0;
  let previousState: string | undefined;
  let previousStateTime = 0;
  let previousSpeed = 0;
  let wasGrounded: boolean | undefined;
  let disposed = false;

  function play(clip: Layer['clip'], fade: number, speed = 1, restart = false) {
    if (!restart && layers.at(-1)?.clip === clip) return;
    for (const layer of layers) {
      layer.entering = false;
      layer.fade = fade;
    }
    if (fade === 0) layers = [];
    layers.push({ clip, time: 0, speed, weight: fade === 0 ? 1 : 0, fade, entering: true });
  }

  function chooseAnimation(state: AnimatedPlayerState, speed: number, snap: boolean) {
    const entered = previousState !== state.state || state.stateT < previousStateTime;
    const gesture = GESTURE_CLIPS.find(clip => clip === state.gestureClip);
    const activeGesture = gesture && ['GRAB', 'HANG', 'SHIMMY', 'CLIMB', 'LEAP', 'DODGE', 'DASH'].includes(state.state);
    if (activeGesture && actions.has(gesture)) {
      play(gesture, snap ? 0 : 0.12, state.gestureSpeed ?? 1);
    } else if (!state.grounded) {
      if (state.state === 'JUMP') {
        // The traversal step chooses a jump before its first airborne integration.
        const takeoffSpeed = wasGrounded ? previousSpeed : speed;
        if (entered) play(state.jumpClip ?? (takeoffSpeed > 2.5 ? 'jump_fwd' : 'jump_up'), snap ? 0 : 0.08, 1, true);
      } else play('fall', snap ? 0 : previousState === 'JUMP' ? 0.25 : 0.2);
    } else if (wasGrounded === false || (state.state === 'LAND' && entered)) {
      const moving = !state.landHeavy && state.stickMag > 0.1 && speed > 2;
      play(state.landHeavy ? 'land_heavy' : 'land', snap ? 0 : 0.12, moving ? 1.6 : 1, true);
    } else {
      const top = layers.at(-1);
      if (top?.clip === 'land' || top?.clip === 'land_heavy') {
        const finished = top.time >= actions.get(top.clip)!.getClip().duration;
        const moveOut = top.clip === 'land' && top.time / top.speed > 0.12 && state.stickMag > 0.1;
        if (finished || moveOut) play('gait', snap ? 0 : 0.12);
      } else play('gait', snap ? 0 : 0.14);
    }
    previousState = state.state;
    previousStateTime = state.stateT;
    previousSpeed = speed;
    wasGrounded = state.grounded;
  }

  function sampleGait(speed: number, delta: number): Record<GaitClip, number> {
    gaitSpeed += (speed - gaitSpeed) * (delta > 0 ? 1 - Math.exp(-delta / 0.05) : 1);
    const idle = 1 - band(0.05, 0.5, gaitSpeed);
    const walkToJog = band(1.6, 3.2, gaitSpeed);
    const jogToRun = band(3.2, 5, gaitSpeed);
    const runToSprint = band(tuning.run + 0.2, tuning.sprint, gaitSpeed);
    const moving = 1 - idle;
    const walk = moving * (1 - walkToJog);
    const jog = moving * walkToJog * (1 - jogToRun);
    const run = moving * walkToJog * jogToRun * (1 - runToSprint);
    const sprint = moving * walkToJog * jogToRun * runToSprint;
    const stride = (walk * tuning.stride.walk + jog * tuning.stride.jog +
      run * tuning.stride.run + sprint * tuning.stride.sprint) / (walk + jog + run + sprint || 1) || tuning.stride.walk;
    if (speed > 0.05) phase = (phase + speed / stride * delta) % 1;
    idleTime += delta;
    return { stand_idle: idle, walk, jog, run, sprint };
  }

  function sampleAnimation(speed: number, delta: number) {
    const gait = sampleGait(speed, delta);
    for (const layer of layers) {
      const progress = layer.fade > 0 ? delta / layer.fade : 1;
      layer.weight = layer.entering ? Math.min(layer.weight + progress, 1) : Math.max(layer.weight - progress, 0);
      if (layer.clip !== 'gait') layer.time += delta * layer.speed;
    }
    layers = layers.filter(layer => layer.entering || layer.weight > 0);
    const total = layers.reduce((sum, layer) => sum + ease(layer.weight), 0) || 1;
    const poses = new Map<PlayerClip, { weight: number; time: number }>();
    function blend(name: PlayerClip, weight: number, time: number) {
      if (weight > 0) poses.set(name, { weight: (poses.get(name)?.weight ?? 0) + weight, time });
    }
    for (const layer of layers) {
      const weight = ease(layer.weight) / total;
      if (layer.clip === 'gait') {
        for (const name of GAIT_CLIPS) {
          const duration = actions.get(name)!.getClip().duration;
          blend(name, weight * gait[name], name === 'stand_idle' ? idleTime % duration : phase * duration);
        }
      } else {
        const duration = actions.get(layer.clip)!.getClip().duration;
        const loop = layer.clip === 'fall' || layer.clip === 'hang_idle';
        blend(layer.clip, weight, loop ? layer.time % duration : Math.min(layer.time, duration));
      }
    }
    for (const [name, action] of actions) {
      const pose = poses.get(name);
      action.setEffectiveWeight(pose?.weight ?? 0);
      if (pose) action.time = pose.time;
    }
    // Each local clip clock is driven by simulation time, so the mixer only evaluates the pose.
    mixer.update(0);
  }

  function update(state: AnimatedPlayerState, delta: number, snap = false) {
    if (disposed) return;
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Animation step must be nonnegative and finite');
    const speed = Math.hypot(state.vx, state.vz);
    chooseAnimation(state, speed, snap);
    sampleAnimation(speed, delta);
    root.position.set(state.x, state.y, state.z);
    root.rotation.y = state.heading + Math.PI;
  }

  function reset(state?: AnimatedPlayerState) {
    if (disposed) return;
    layers = [];
    gaitSpeed = phase = idleTime = previousStateTime = previousSpeed = 0;
    previousState = wasGrounded = undefined;
    if (state) update(state, 0, true);
    else {
      play('gait', 0);
      sampleAnimation(0, 0);
      root.rotation.y = Math.PI;
    }
  }

  reset();
  return {
    root, mixer, update, reset,
    duration(name) {
      const clip = clips.get(name);
      if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) throw Error(`Player clip ${name} is missing or invalid`);
      return clip.duration;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      actions.clear();
      layers = [];
      releaseModel(model);
    },
  };
}

export async function loadAnimatedPlayer(
  assets: Pick<AssetManager, 'loadGLTF'>, { signal }: AssetRequestOptions = {},
): Promise<AnimatedPlayer> {
  signal?.throwIfAborted();
  const model = await assets.loadGLTF(PLAYER_MODEL, { displaySpace: false, ...(signal ? { signal } : {}) });
  if (signal?.aborted) {
    releaseModel(model);
    signal.throwIfAborted();
  }
  return createAnimatedPlayer(model);
}
