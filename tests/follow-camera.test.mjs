import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mesh, MeshBasicMaterial, PlaneGeometry, Scene } from 'three';
import { createMeshRaycaster } from '../src/physics/sight.mts';
import { createCollisionWorld } from '../src/physics/world.mts';
import { createFollowCamera } from '../src/rendering/follow-camera.mts';

const rail = {
  feetAt(seconds, out) {
    const frame = seconds * 24;
    Object.assign(out, { x: 0, y: frame >= 258 ? 8 : 0, z: -frame });
  },
  poseAt(seconds, out) {
    this.feetAt(seconds, out);
    out.y += 1.25;
    out.z += 6;
    out.yaw = 0;
    out.pitch = -10;
  },
};

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, 'expected ' + expected + ', got ' + actual);
}

test('settles lateral framing according to elapsed seconds across frame rates', () => {
  const finish = rate => {
    const camera = createFollowCamera({ rail });
    camera.update({ feet: { x: 0, y: 0, z: -10 }, speed: 0, deltaSeconds: 0 });
    let pose;
    for (let step = 0; step < rate / 2; step++) {
      pose = camera.update({ feet: { x: 2, y: 0, z: -10 }, speed: 0, deltaSeconds: 1 / rate });
    }
    return pose;
  };
  // The first metre moves the target 0.75 m, the second a full metre,
  // and the soft dead zone absorbs another 0.08 m.
  const expected = 1.67 * (1 - 4 * Math.exp(-3));
  for (const rate of [30, 60, 120]) {
    const pose = finish(rate);
    close(pose.x, expected);
    close(pose.z, -4.9);
    assert.equal(pose.railFrame, 10);
    assert.equal(pose.pitch, -10);
  }
});

test('retracts before a physics obstacle and eases outward when it clears', () => {
  const world = createCollisionWorld();
  world.addTriangles([
    -10, 0, 4, 10, 0, 4, 10, 5, 4,
    -10, 0, 4, 10, 5, 4, -10, 5, 4,
  ], { kind: 8, group: 'wall', fades: 'bridge' });
  world.setGroup('wall', false);
  const camera = createFollowCamera({ rail, world });
  const frame = { feet: { x: 0, y: 0, z: 0 }, speed: 3.5 };
  close(camera.update({ ...frame, deltaSeconds: 0 }).z, 6);

  world.setGroup('wall', true);
  const blocked = camera.update({ ...frame, deltaSeconds: 1 / 120 });
  assert.equal(blocked.obstructed, true);
  assert.equal(blocked.fadeTarget, 'bridge');
  close(blocked.z, 3.6);
  world.setGroup('wall', false);

  const clearing = camera.update({ ...frame, deltaSeconds: 0.5 });
  assert.equal(clearing.obstructed, false);
  assert.equal(clearing.fadeTarget, null);
  close(clearing.z, 6 - 2.4 * 2.25 * Math.exp(-1.25));
});

test('counts an actual front-facing sight mesh and maintains near-surface clearance', () => {
  const scene = new Scene();
  const geometry = new PlaneGeometry(10, 5);
  const material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material);
  mesh.name = 'camera-wall';
  mesh.position.set(0, 1.25, 4);
  scene.add(mesh);
  try {
    const frame = { feet: { x: 0, y: 0, z: 0 }, speed: 3.5, deltaSeconds: 0 };
    scene.updateMatrixWorld(true);
    const back = createFollowCamera({ rail, sight: createMeshRaycaster(scene, /^camera-wall$/) }).update(frame);
    assert.equal(back.obstructed, false);
    close(back.z, 6);

    mesh.rotation.y = Math.PI;
    scene.updateMatrixWorld(true);
    const front = createFollowCamera({ rail, sight: createMeshRaycaster(scene, /^camera-wall$/) }).update(frame);
    assert.equal(front.obstructed, true);
    close(front.z, 3.45);
  } finally {
    geometry.dispose();
    material.dispose();
  }
});

test('keeps the camera above terrain immediately after a terrain change', () => {
  const world = createCollisionWorld();
  world.addTriangles([
    -10, 1.2, 4, 10, 1.2, 4, 10, 1.2, 8,
    -10, 1.2, 4, 10, 1.2, 8, -10, 1.2, 8,
  ], { group: 'floor' });
  world.setGroup('floor', false);
  const camera = createFollowCamera({ rail, world });
  const frame = { feet: { x: 0, y: 0, z: 0 }, speed: 3.5 };
  close(camera.update({ ...frame, deltaSeconds: 0 }).y, 1.25);
  world.setGroup('floor', true);
  close(camera.update({ ...frame, deltaSeconds: 1 / 120 }).y, 1.6);
});

test('abrupt relocations project globally and discard stale follow state', () => {
  const camera = createFollowCamera({ rail });
  camera.update({ feet: { x: 0, y: 0, z: -10 }, speed: 0, deltaSeconds: 0 });
  camera.update({ feet: { x: 2, y: 0, z: -12 }, speed: 0, deltaSeconds: 0.1 });
  const target = { feet: { x: 0, y: 8, z: -270 }, deltaSeconds: 0, teleport: 1, speed: 3.5 };
  const moved = camera.update(target);
  assert.equal(moved.zone, 'plateau');
  assert.equal(moved.railFrame, 270);
  close(moved.x, 0);
  close(moved.y, 9.25);
  close(moved.z, -264);
  assert.deepEqual(moved, createFollowCamera({ rail }).update(target));
  camera.reset();
  const restarted = camera.update({ ...target, feet: { x: 0, y: 0, z: -100 } });
  assert.equal(restarted.zone, 'way_up');
  assert.equal(restarted.railFrame, 100);
});
