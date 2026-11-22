import { Vector3, type Object3D, type PerspectiveCamera } from 'three/webgpu';
import type { createAudioCues } from '../audio/audio-cues.mts';
import type { createCompanion } from '../domain/companion.mts';
import { pointInPolygon } from '../physics/geometry.mts';
import type { CollisionWorld } from '../physics/world.mts';
import type { AnimatedPlayer } from '../player/animated-player.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { chapterOneGroundRegions } from './chapter-one-terrain.mts';
import { createLanternRestScene, type LanternRestCommand } from './lantern-rest-scene.mts';
import type { loadCompanionPresentation } from './companion-presentation.mts';
import {
  createStorySceneController, storySceneSites,
  type ScenePoint, type SceneShot, type StoryActor, type StorySceneCommand, type StorySceneEffects, type StorySceneId,
} from './story-scenes.mts';

type Player = ReturnType<typeof createTraversalController>;
type Companion = ReturnType<typeof createCompanion>;
type Cat = Awaited<ReturnType<typeof loadCompanionPresentation>>;
type CatRig = ReturnType<Cat['family']>;
type Walk = Extract<StorySceneCommand, { type: 'walk' }>;
type Face = Extract<StorySceneCommand, { type: 'face' }>;

interface StoryPresentationOptions {
  id: StorySceneId | null;
  root: Object3D;
  lifetime: ChapterLifetime;
  player: Player;
  companion: Companion;
  actor: AnimatedPlayer;
  cat: Cat;
  camera: PerspectiveCamera;
  world: CollisionWorld;
  audio: ReturnType<typeof createAudioCues> | undefined;
  onActive(id: StorySceneId | 'lantern_rest' | null): void;
  onSubtitle(text: string | null): void;
}

const familyNames = ['family0', 'family1', 'family2'] as const;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => value * value * (3 - 2 * value);
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const headingTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const radians = Math.PI / 180;

function shotPose(shot: SceneShot, phase: number, position: Vector3, look: Vector3, spare: Vector3) {
  if ('orbit' in shot) {
    const angle = (shot.from + (shot.to - shot.from) * phase) * radians;
    const [x, y, z] = shot.orbit;
    position.set(x + Math.sin(angle) * shot.radius, y + shot.height, z - Math.cos(angle) * shot.radius);
    look.set(x, y + shot.look, z);
    return;
  }
  const frame = phase * (shot.keys.length - 1);
  const first = shot.keys[Math.floor(frame)]!;
  const second = shot.keys[Math.min(shot.keys.length - 1, Math.floor(frame) + 1)]!;
  const sample = (mark: ScenePoint | (() => ScenePoint)) => typeof mark === 'function' ? mark() : mark;
  position.set(...sample(first.pos)).lerp(spare.set(...sample(second.pos)), frame % 1);
  look.set(...sample(first.look)).lerp(spare.set(...sample(second.look)), frame % 1);
}

/** Directs the live rigs and camera during the chapter's authored story scene. */
export function createStoryPresentation({
  id, root, lifetime, player, companion, actor, cat, camera, world, audio, onActive, onSubtitle,
}: StoryPresentationOptions) {
  const rigs = new Map<StoryActor, CatRig>([['cat', cat]]);
  const walks = new Map<StoryActor, { command: Walk; time: number; complete: boolean }>();
  const followUps = new Map<StoryActor, { done(): boolean; clip: string; fade: number }>();
  const pointBuffer = new Vector3(), shotPosition = new Vector3(), shotLook = new Vector3(), spare = new Vector3();
  const hand = actor.root.getObjectByName('mixamorigLeftHand');
  const secondHand = actor.root.getObjectByName('mixamorigRightHand');
  const head = actor.root.getObjectByName('mixamorigHead');
  let shot: { cue: SceneShot; blend: number; time: number; from: Vector3; toward: Vector3 } | undefined;
  let playerClip: { name: string; time: number; speed: number; fade: number; duration: number } | undefined;
  let playerTurn: { command: Face; complete: boolean } | undefined;
  let catTurn: { heading: number; complete: boolean } | undefined;
  let catMotion: { from: Vector3; target: 'hands' | 'shoulder' | ScenePoint; time: number; duration: number; hop: boolean } | undefined;
  let held: 'hands' | 'shoulder' | null = null;
  let dwell = 0;
  let wasEligible = false;
  let completed = false;

  const ground = (x: number, z: number, y: number) => world.groundAt(x, z, y + .65, y - .65)?.y;
  function place(rig: CatRig, point: ScenePoint, heading: number) {
    rig.root.position.set(...point);
    rig.root.rotation.y = heading + Math.PI;
    rig.root.visible = true;
  }
  function anchor(target: 'hands' | 'shoulder' | ScenePoint, output: Vector3) {
    if (target === 'shoulder') return cat.shoulderPosition(output);
    if (target !== 'hands') return output.set(...target);
    if (!hand || !secondHand) return output.set(player.state.x, player.state.y + 1.1, player.state.z);
    hand.getWorldPosition(output).lerp(secondHand.getWorldPosition(spare), .5);
    return output;
  }
  function lift(target: 'hands' | 'shoulder' | ScenePoint, duration: number, hop = false) {
    const motion = { from: cat.root.position.clone(), target, time: 0, duration, hop };
    catMotion = motion;
    held = null;
    return { done: () => motion.time >= motion.duration };
  }

  function clearScene() {
    onActive(null);
    onSubtitle(null);
    shot = playerClip = playerTurn = catTurn = catMotion = undefined;
    held = null;
    walks.clear();
    followUps.clear();
  }

  function beginScene(current: StorySceneId | 'lantern_rest') {
      const { x, z, heading } = player.state;
      player.reset({ x, z, heading });
      held = companion.state.phase === 'CARRIED' ? 'shoulder' : null;
      if (current === 'reunion') {
        const [fx, y, fz] = storySceneSites.reunion.reunion_family;
        const starts = [[-.64, -.3], [.65, .54], [.1, -.82]] as const;
        for (const [index, name] of familyNames.entries()) {
          const rig = rigs.get(name)!;
          const [dx, dz] = starts[index]!;
          place(rig, [fx + dx, ground(fx + dx, fz + dz, y) ?? y, fz + dz], Math.PI / 2);
          rig.play('idle', 0, { restart: true });
        }
      }
      onActive(current);
  }

  function apply(command: LanternRestCommand, signal: AbortSignal) {
      switch (command.type) {
        case 'lantern-hop':
          cat.play('jump_down', .15, { loop: false, restart: true });
          return lift(command.point, .45, true);
        case 'lantern-turn': {
          const turn = { heading: command.heading, complete: false };
          catTurn = turn;
          return { done: () => turn.complete };
        }
        case 'lantern-rig':
          if (command.pose === 'hands' || command.pose === 'lift') return lift('hands', command.seconds);
          break;
        case 'shot':
          shot = { cue: command.shot, blend: command.blend, time: 0,
            from: camera.position.clone(), toward: camera.getWorldDirection(new Vector3()) };
          break;
        case 'sound':
          // The published audio router aliases these mews to one take and disables purring.
          if (command.name !== 'catPurr') audio?.playRecording('audio/sfx/catMeow_1.ogg', 'effects', signal,
            command.name === 'catMeow' ? 4 : 6);
          break;
        case 'line':
          return audio?.playRecording(`audio/voice/${command.line.voice}.ogg`, 'voice', signal);
        case 'subtitle':
          onSubtitle(command.text);
          break;
        case 'hold':
          walks.delete('player');
          break;
        case 'walk': {
          const move = { command, time: 0, complete: false };
          walks.set(command.actor, move);
          if (command.actor === 'player') playerClip = undefined;
          else rigs.get(command.actor)?.play(command.speed && command.speed >= 1.2 ? 'run' : 'walk', .16);
          return { done: () => move.complete };
        }
        case 'face': {
          const turn = { command, complete: false };
          playerTurn = turn;
          return { done: () => turn.complete };
        }
        case 'play': {
          if (command.actor === 'player') {
            const duration = actor.duration(command.clip);
            const clip = { name: command.clip, time: command.time ?? 0, speed: command.speed ?? 1, fade: command.fade, duration };
            playerClip = clip;
            return { done: () => clip.speed < 0 ? clip.time <= 0 : clip.time >= clip.duration };
          }
          const rig = rigs.get(command.actor);
          if (!rig) return;
          const action = rig.play(command.clip, command.fade, {
            loop: command.loop === true, time: command.time ?? 0, speed: command.speed ?? 1, restart: true,
          });
          if (command.then) followUps.set(command.actor, { done: () => action.paused, clip: command.then, fade: command.fade });
          else followUps.delete(command.actor);
          break;
        }
        case 'attach':
          catMotion = undefined;
          held = command.to;
          break;
        case 'rig':
          if (command.pose === 'opening-hands') break;
          if (command.pose === 'reunion-kneel') { held = 'hands'; break; }
          if (command.pose === 'reunion-rise') {
            const duration = actor.duration('rise');
            playerClip = { name: 'rise', duration, time: 0, speed: duration / (command.seconds ?? duration), fade: .2 };
            break;
          }
          if (command.pose === 'shoulder-transfer') return lift('shoulder', command.seconds ?? 1.6);
          if (command.pose === 'reunion-lower' && command.point) {
            const [x, y, z] = command.point;
            return lift([x, y + .3, z], command.seconds ?? .9);
          }
          if (command.pose === 'reunion-step-down' && command.point) {
            if (command.heading !== undefined) cat.root.rotation.y = command.heading + Math.PI;
            return lift(command.point, command.seconds ?? .25, true);
          }
          return lift('hands', command.seconds ?? .55);
      }
  }

  const effects: StorySceneEffects = {
    begin: beginScene,
    apply,
    finish(result) {
      clearScene();
      if (result.player) {
        const [x, , z] = result.player.point;
        player.reset({ x, z, heading: result.player.heading });
      }
      actor.reset(player.state);
      if (result.flag) {
        const { x, y, z, heading, state, grounded, carrier } = player.state;
        companion.completeIntroduction({ x, y, z, heading, state, grounded, speed: 0, onCarrier: carrier !== null });
      }
      if (result.cat) {
        const [x, y, z] = result.cat.point;
        companion.reunite({ x, y, z, heading: result.cat.heading });
        place(cat, result.cat.point, result.cat.heading);
      }
      if (result.catClip) cat.play(result.catClip, .2);
      for (const member of result.family ?? []) {
        const rig = rigs.get(member.actor)!;
        place(rig, member.point, member.heading);
        rig.play(member.clip, .2);
      }
      completed = result.outcome === 'completed' || result.outcome === 'skipped';
    },
    point(name, mark) {
      if (name === 'player') {
        if (mark === 'head' && head) return head.getWorldPosition(pointBuffer).toArray();
        const { x, y, z } = player.state;
        return [x, y, z];
      }
      const rig = rigs.get(name);
      return (mark === 'head' ? rig?.head ?? rig?.root : rig?.root)?.getWorldPosition(pointBuffer).toArray();
    },
    heading(name) { return name === 'player' ? player.state.heading : (rigs.get(name)?.root.rotation.y ?? Math.PI) - Math.PI; },
    ground,
    duration(name, clip) { return name === 'player' ? actor.duration(clip) : rigs.get(name)?.duration(clip); },
  };
  const controller = createStorySceneController(effects);
  const rest = createLanternRestScene({
    begin() { beginScene('lantern_rest'); },
    apply,
    point(name) {
      if (name === 'camera') return camera.position.toArray();
      return effects.point?.(name) ?? [player.state.x, player.state.y, player.state.z];
    },
    heading: name => effects.heading?.(name),
    ground,
    duration: clip => actor.duration(clip),
    finish() {
      clearScene();
      actor.reset(player.state);
      cat.play('ride', .2);
    },
  });
  if (id === 'reunion') for (const name of familyNames) {
    const rig = cat.family(root, lifetime, name);
    rig.root.visible = false;
    rigs.set(name, rig);
  }
  lifetime.defer(() => { controller.dispose(); rest.dispose(); });

  function advanceWalks(delta: number) {
    let vx = 0, vz = 0;
    for (const [name, move] of walks) {
      const { command } = move;
      const isPlayer = name === 'player';
      const rig = rigs.get(name);
      const point = isPlayer ? player.state : rig!.root.position;
      const dx = command.x - point.x, dz = command.z - point.z;
      const distance = Math.hypot(dx, dz);
      move.time += delta;
      if (distance <= (command.within ?? .08) || move.time >= command.timeout) {
        move.complete = true;
        walks.delete(name);
        if (rig) {
          if (command.face !== undefined) rig.root.rotation.y = command.face + Math.PI;
          if (command.then !== null) rig.play(command.then ?? 'idle', .15, { loop: !command.then || command.then !== 'greet' });
        }
        continue;
      }
      const scale = Math.min(1, (command.speed ?? 1.6) * delta / distance);
      const heading = headingTo(dx, dz);
      if (isPlayer) {
        const { x, z } = point;
        const next = player.moveCombat(dx * scale, dz * scale, heading);
        vx = (next.x - x) / delta;
        vz = (next.z - z) / delta;
      } else if (rig) {
        const next = world.sweepCapsule(point, dx * scale, dz * scale, { radius: .12, height: .3, guards: false });
        const y = ground(next.x, next.z, point.y);
        if (y !== undefined) place(rig, [next.x, y, next.z], heading);
      }
    }
    return { vx, vz };
  }

  function animate(delta: number) {
    const speed = advanceWalks(delta);
    if (playerTurn) {
      const { command } = playerTurn;
      const difference = wrapAngle(command.heading - player.state.heading);
      const allowance = command.rate * delta;
      if (Math.abs(difference) <= Math.max(.012, allowance)) {
        player.moveCombat(0, 0, command.heading);
        playerTurn.complete = true;
        playerTurn = undefined;
      } else player.moveCombat(0, 0, player.state.heading + Math.sign(difference) * allowance);
    }
    if (catTurn) {
      const difference = wrapAngle(catTurn.heading + Math.PI - cat.root.rotation.y);
      const allowance = delta * 3.2;
      cat.root.rotation.y += Math.sign(difference) * Math.min(allowance, Math.abs(difference));
      if (Math.abs(difference) <= allowance) {
        catTurn.complete = true;
        catTurn = undefined;
      }
    }
    const clip = playerClip;
    if (clip) clip.time = clamp01((clip.time + delta * clip.speed) / clip.duration) * clip.duration;
    actor.update({ ...player.state, ...speed }, delta,
      clip ? { clip: clip.name, frame: clip.time * 24, fade: clip.fade } : undefined);
    for (const rig of rigs.values()) rig.advance(delta);
    for (const [name, next] of followUps) if (next.done()) {
      rigs.get(name)!.play(next.clip, next.fade);
      followUps.delete(name);
    }
    if (catMotion) {
      catMotion.time += delta;
      const progress = clamp01(catMotion.time / catMotion.duration);
      const target = anchor(catMotion.target, pointBuffer);
      cat.root.position.copy(catMotion.from).lerp(target, ease(progress));
      if (catMotion.hop) cat.root.position.y += Math.sin(progress * Math.PI) * .16;
      if (progress === 1) {
        held = typeof catMotion.target === 'string' ? catMotion.target : null;
        catMotion = undefined;
      }
    } else if (held) cat.root.position.copy(anchor(held, pointBuffer));
    if (held === 'shoulder') cat.root.rotation.y = player.state.heading + Math.PI;
  }

  function presentCamera(delta: number) {
    if (!shot) return;
    shot.time += delta;
    shotPose(shot.cue, clamp01(shot.time / shot.cue.dur), shotPosition, shotLook, spare);
    if ('keys' in shot.cue && (shot.cue.clear || shot.cue.guard)) {
      const from = shot.cue.guard;
      const origin = from ? pointBuffer.set(...(typeof from === 'function' ? from() : from)) : shotLook;
      const direction = spare.subVectors(shotPosition, origin);
      const length = direction.length();
      if (length > .2) {
        direction.multiplyScalar(1 / length);
        const hit = world.raycast(origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, length, 3);
        if (hit < length) shotPosition.copy(origin).addScaledVector(direction, Math.max(.2, hit - .2));
      }
    }
    const weight = shot.blend > 0 ? ease(clamp01(shot.time / shot.blend)) : 1;
    camera.position.copy(shot.from).lerp(shotPosition, weight);
    const direction = spare.subVectors(shotLook, shotPosition).normalize();
    camera.lookAt(shotLook.copy(shot.toward).lerp(direction, weight).normalize().add(camera.position));
  }

  return {
    get complete() { return completed; },
    get active() { return controller.active !== null || rest.active; },
    rest(shrine: Parameters<typeof rest.start>[0]) {
      return !controller.active && rest.start(shrine, { carried: companion.state.phase === 'CARRIED', signal: lifetime.signal });
    },
    trigger(delta: number, duelCleared: boolean) {
      if (!id || completed || controller.active || rest.active) return;
      const { grounded, x, y, z } = player.state;
      if (id === 'reunion') {
        if (grounded && duelCleared && pointInPolygon(x, z, storySceneSites.reunion.trigger.poly)) {
          controller.play(id, { carried: companion.state.phase === 'CARRIED', signal: lifetime.signal });
        }
        return;
      }
      if (companion.state.found) return;
      const site = storySceneSites.opening_cat.trigger;
      const eligible = grounded && y >= site.yMin && pointInPolygon(x, z, chapterOneGroundRegions[2].poly);
      if (!eligible) {
        if (dwell > 0) wasEligible = true;
        dwell = 0;
        return;
      }
      dwell += delta;
      if (dwell >= (wasEligible ? site.dwell : site.initialDwell)) controller.play(id, { signal: lifetime.signal });
    },
    step(delta: number) {
      if (controller.active) {
        controller.step(delta);
        if (controller.active) animate(delta);
      } else if (rest.active) {
        rest.step(delta);
        if (rest.active) animate(delta);
      } else if (completed) {
        for (const name of familyNames) rigs.get(name)?.advance(delta);
      }
    },
    presentCamera,
    skip() { return controller.skip() || rest.skip(); },
  };
}
