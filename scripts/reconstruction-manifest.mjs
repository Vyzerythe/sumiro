import { createHash } from 'node:crypto';

/** Published bundle paths are relative to the distribution root. */
export const bundleAdapters = {
  game: {
    file: 'bundle/game-B5zfa1fm.js', gitBlob: '284349f2f8d0235e163f3c9b88b17ed222e3b269',
    status: 'hybrid', sourceModules: ['src/domain/save.mts', 'src/domain/scene-transition.mts'],
  },
  chapters: {
    file: 'bundle/chapters-B8aGs4KP.js', gitBlob: '3da4e0f31fed783d0e548dd40fd0c1113cca16ec',
    status: 'source', sourceModules: ['src/domain/chapters.mts'],
  },
  kit: {
    file: 'bundle/kit-B01EgPBo.js', gitBlob: 'd92a7b85baceb33cf9c7243a27fbfea98fa5436d',
    status: 'hybrid', sourceModules: ['src/domain/scrolls.mjs'],
  },
  collision: {
    file: 'bundle/collision-DtBQEpmQ.js', gitBlob: 'bb06154a9be5a24421a017f4c84adf7c87064d1b',
    status: 'source',
    sourceModules: ['src/physics/geometry.mts', 'src/physics/moving-body.mts', 'src/physics/world.mts'],
  },
  player: {
    file: 'bundle/player-1_KrBWnI.js', gitBlob: '2ba1dbb18011510e025d5f3af06b045f143a3d10',
    status: 'hybrid',
    sourceModules: [
      'src/player/cinematic-timeline.mjs',
      'src/player/input-steering.mjs',
      'src/player/leap.mjs',
      'src/player/ledge-controller.mjs',
      'src/player/ledge-grab.mjs',
      'src/player/ledge-path.mjs',
      'src/player/locomotion.mjs',
      'src/player/mantle.mjs',
      'src/player/motion-physics.mjs',
      'src/player/movement-config.mjs',
    ],
  },
  hud: {
    file: 'bundle/hud-D8uImnxA.js', gitBlob: 'd1fee95d80a07bed241dc8a2c60fe345f73d38f0',
    status: 'hybrid', sourceModules: ['src/runtime/hud-timeline.mts'],
  },
  trail: {
    file: 'bundle/trail-BFIL-IHB.js', gitBlob: '950ee6272e85d1c446a2de97ce0df4930c6d3145',
    status: 'source', sourceModules: ['src/player/movement-trail.mts'],
  },
  renderer: {
    file: 'bundle/render_pipeline-BTCk4Dyc.js', gitBlob: 'e6b0a92ac434dbae6f6ffa8227b2f09d539a594d',
    status: 'hybrid', sourceModules: ['src/rendering/frame-resolution.mts'],
  },
  sight: {
    file: 'bundle/sight-DXR0ElmN.js', gitBlob: '278874e5ee81a87b366e63cd9c37d05b24448556',
    status: 'source', sourceModules: ['src/physics/sight.mts'],
  },
  entry: {
    file: 'bundle/index-DnHRwVtn.js', gitBlob: 'ebb0f16331c5186608eba202d2991a8cef5ccda6',
    status: 'hybrid',
    sourceModules: [
      'src/input/input-manager.mts',
      'src/runtime/fixed-step-clock.mts',
      'src/runtime/frame-scheduler.mts',
      'src/runtime/launch-options.mts',
      'src/runtime/live-loop.mts',
      'src/runtime/registry.mts',
      'src/runtime/system-host.mts',
    ],
  },
};

export function gitBlobHash(bytes) {
  return createHash('sha1').update('blob ' + bytes.byteLength + '\0').update(bytes).digest('hex');
}
