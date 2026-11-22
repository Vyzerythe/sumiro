import { AnimationMixer, Mesh, SkinnedMesh, Vector3, type AnimationAction, type Object3D, type Skeleton } from 'three/webgpu';
import { disposeGLTF, type AssetManager } from '../assets/asset-manager.mts';
import type { createCompanion } from '../domain/companion.mts';
import type { SystemLifetime } from '../runtime/system-host.mts';

type CompanionState = ReturnType<typeof createCompanion>['state'];

/** Owns the supplied cat rig and follows the player's animated shoulder. */
export async function loadCompanionPresentation(assets: AssetManager, lifetime: SystemLifetime<Object3D>, player: Object3D) {
  const gltf = await assets.loadGLTF('cat/cat.glb', { displaySpace: false, signal: lifetime.signal });
  const root = gltf.scene;
  const mixer = new AnimationMixer(root);
  const skeletons = new Set<Skeleton>();
  root.traverse(object => {
    if (object instanceof Mesh) object.frustumCulled = false;
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
  });
  lifetime.defer(() => {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    for (const skeleton of skeletons) skeleton.dispose();
    disposeGLTF(gltf);
  });
  lifetime.signal.throwIfAborted();
  root.name = 'companion';
  root.visible = false;
  lifetime.ownRoot(root);
  const clips = new Map(gltf.animations.map(clip => [clip.name, clip]));
  const mount = player.getObjectByName('mixamorigRightShoulder') ?? player.getObjectByName('mixamorigSpine2');
  const anchor = new Vector3();
  let current: AnimationAction | undefined;

  return {
    update(state: CompanionState, delta: number, inkLearned: boolean) {
      root.visible = true;
      const carried = state.phase === 'CARRIED';
      const clipName = carried ? 'ride' : state.phase === 'STRAY' ? (inkLearned ? 'sit' : 'hide') :
        state.phase === 'WAIT_GAP' || state.phase === 'SIT' ? 'sit' :
          state.speed > 2.2 ? 'run' : state.speed > 0.15 ? 'walk' : 'idle';
      const clip = clips.get(clipName);
      if (!clip) throw Error(`Missing companion animation ${clipName}`);
      const action = mixer.clipAction(clip);
      if (action !== current) {
        current?.fadeOut(0.18);
        action.reset().fadeIn(0.18).play();
        current = action;
      }
      const nativeSpeed = clipName === 'walk' ? 0.9 : clipName === 'run' ? 4.875 : 0;
      action.timeScale = nativeSpeed ? Math.min(2.75, Math.max(0.3, state.speed / nativeSpeed)) : 1;
      mixer.update(delta);
      if (carried && mount) {
        player.updateMatrixWorld(true);
        mount.getWorldPosition(anchor);
        root.position.copy(anchor);
        root.position.y += 0.06;
      } else root.position.set(state.x, state.y, state.z);
      root.rotation.y = state.heading + Math.PI;
    },
  };
}
