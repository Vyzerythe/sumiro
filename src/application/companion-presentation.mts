import { AnimationMixer, LoopOnce, LoopRepeat, Mesh, MeshStandardMaterial, SkinnedMesh, Vector3,
  type AnimationAction, type Node, type Object3D, type Skeleton } from 'three/webgpu';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { clamp, materialColor, mix, vec4, vertexColor } from 'three/tsl';
import { disposeGLTF, type AssetManager } from '../assets/asset-manager.mts';
import type { createCompanion } from '../domain/companion.mts';
import { createInkMaterial } from '../rendering/ink-material.mts';
import type { SystemLifetime } from '../runtime/system-host.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';

type CompanionState = ReturnType<typeof createCompanion>['state'];

function bindFur(root: Object3D, lifetime: Pick<ChapterLifetime, 'defer'>) {
  root.traverse(object => {
    if (!(object instanceof SkinnedMesh) || !(object.material instanceof MeshStandardMaterial)) return;
    const original = object.material;
    // The shipped cat uses COLOR_0 as ink data. Its separate base texture is
    // the painted fur, while the glTF specular extension only disables gloss.
    const surface = new MeshStandardMaterial().copy(original);
    surface.color.setHex(16381419);
    surface.metalness = 0;
    const paint = object.geometry.hasAttribute('color');
    const fur = createInkMaterial(surface, { preset: 'cloth', vertexPaint: paint, lineWeight: 1 });
    surface.dispose();
    if (paint) {
      const base = vec4(materialColor as unknown as Node<'vec4'>);
      const cavity = mix(.47, 1, clamp(vertexColor().r, 0, 1));
      fur.colorNode = vec4(base.rgb.mul(cavity), base.a);
    }
    object.material = fur;
    lifetime.defer(() => { object.material = original; fur.dispose(); });
  });
}

/** Owns the supplied cat rig and follows the player's animated shoulder. */
export async function loadCompanionPresentation(assets: AssetManager, lifetime: SystemLifetime<Object3D>, player: Object3D) {
  const gltf = await assets.loadGLTF('cat/cat.glb', { displaySpace: false, signal: lifetime.signal });
  const root = gltf.scene;
  lifetime.defer(() => disposeGLTF(gltf));
  lifetime.signal.throwIfAborted();
  bindFur(root, lifetime);
  root.name = 'companion';
  root.visible = false;
  lifetime.ownRoot(root);
  const clips = new Map(gltf.animations.map(clip => [clip.name, clip]));
  const mount = player.getObjectByName('mixamorigRightShoulder') ?? player.getObjectByName('mixamorigSpine2');
  const anchor = new Vector3();

  function rig(model: Object3D, owner: Pick<ChapterLifetime, 'defer'>) {
    const mixer = new AnimationMixer(model);
    const skeletons = new Set<Skeleton>();
    model.traverse(object => {
      if (object instanceof Mesh) object.frustumCulled = false;
      if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
    });
    owner.defer(() => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      for (const skeleton of skeletons) skeleton.dispose();
    });
    let current: AnimationAction | undefined;
    const head = model.getObjectByName('head');
    return {
      root: model,
      head,
      duration(name: string) { return clips.get(name)?.duration; },
      advance(delta: number) { mixer.update(delta); },
      play(name: string, fade: number, { loop = true, time = 0, speed = 1, restart = false } = {}) {
        const clip = clips.get(name);
        if (!clip) throw Error(`Missing companion animation ${name}`);
        const action = mixer.clipAction(clip);
        if (action !== current || restart) {
          if (current !== action) current?.fadeOut(fade);
          action.reset().setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
          action.clampWhenFinished = !loop;
          action.time = time;
          action.fadeIn(fade).play();
          current = action;
        }
        action.timeScale = speed;
        return action;
      },
    };
  }
  const companion = rig(root, lifetime);
  const spare = new Vector3();
  let reaction: AnimationAction | undefined;
  function shoulderPosition(output: Vector3) {
    if (mount) return mount.getWorldPosition(output).add(spare.set(0, 0.06, 0));
    return output.copy(player.position).add(spare.set(0, 1.4, 0));
  }

  return {
    ...companion,
    family(parent: Object3D, owner: ChapterLifetime, name: string) {
      const model = clone(root);
      model.name = name;
      parent.add(model);
      owner.defer(() => { model.removeFromParent(); });
      return rig(model, owner);
    },
    shoulderPosition,
    flinch(clip: 'hurt' | 'meow') {
      reaction = companion.play(clip, .12, { loop: false, restart: true });
    },
    update(state: CompanionState, delta: number, inkLearned: boolean) {
      root.visible = true;
      const carried = state.phase === 'CARRIED';
      const clipName = carried ? 'ride' : state.phase === 'STRAY' ? (inkLearned ? 'sit' : 'hide') :
        state.phase === 'WAIT_GAP' || state.phase === 'SIT' || state.phase === 'REUNITED' ? 'sit' :
          state.speed > 2.2 ? 'run' : state.speed > 0.15 ? 'walk' : 'idle';
      const nativeSpeed = clipName === 'walk' ? 0.9 : clipName === 'run' ? 4.875 : 0;
      if (!reaction || reaction.paused || carried) {
        reaction = undefined;
        companion.play(clipName, 0.18, { speed: nativeSpeed ? Math.min(2.75, Math.max(0.3, state.speed / nativeSpeed)) : 1 });
      }
      companion.advance(delta);
      if (carried) root.position.copy(shoulderPosition(anchor));
      else root.position.set(state.x, state.y, state.z);
      root.rotation.y = state.heading + Math.PI;
    },
  };
}
