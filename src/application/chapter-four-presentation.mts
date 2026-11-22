import { Group, type Object3D } from 'three/webgpu';
import type { createChapterFourMechanisms } from './chapter-four-mechanisms.mts';

/** Conventional temple gate and platform bindings for the supplied GLB nodes. */
export function bindChapterFourPresentation(root: Object3D, mechanisms: ReturnType<typeof createChapterFourMechanisms>) {
  const small = root.getObjectByName('leaf_door');
  const great = root.getObjectByName('leaf_great');
  if (!small || !great) throw Error('The temple requires both supplied door leaves');
  const gates = mechanisms.gates.map(gate => {
    const group = new Group();
    group.name = gate.id;
    group.position.set(gate.x, gate.y, gate.z);
    group.rotation.y = gate.yaw;
    const template = gate.great ? great : small;
    function hinge(side: number) {
      const pivot = new Group();
      pivot.position.x = side * gate.w / 2;
      const leaf = template.clone();
      leaf.visible = true;
      if (!gate.great) leaf.scale.set(gate.w / 2, gate.h, 1);
      leaf.rotation.y = side < 0 ? 0 : Math.PI;
      pivot.add(leaf);
      group.add(pivot);
      return pivot;
    }
    const left = hinge(-1), right = hinge(1);
    root.add(group);
    return { gate, left, right };
  });
  small.visible = great.visible = false;
  const bells = mechanisms.bells.map(bell => ({ bell, mesh: root.getObjectByName(bell.nodeName) }));
  const bodies = [...mechanisms.platforms.map(platform => platform.body), ...mechanisms.lifts.flatMap(lift => lift.bodies)]
    .map(body => ({ body, mesh: root.getObjectByName('n_' + body.id) }));
  const crumbles = mechanisms.crumbles.map(stone => ({ stone, mesh: root.getObjectByName('n_' + stone.id) }));
  return () => {
    for (const { gate, left, right } of gates) { left.rotation.y = gate.leftYaw; right.rotation.y = gate.rightYaw; }
    for (const { bell, mesh } of bells) if (mesh) mesh.rotation.z = bell.roll;
    for (const { body, mesh } of bodies) if (mesh) mesh.position.set(body.x, body.y, body.z);
    for (const { stone, mesh } of crumbles) if (mesh) {
      const { x, y, z, visible } = stone.pose;
      mesh.position.set(x, y, z);
      mesh.visible = visible;
    }
  };
}
