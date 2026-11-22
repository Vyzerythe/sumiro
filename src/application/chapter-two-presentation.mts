import { Group, type Object3D } from 'three/webgpu';
import { chapterTwoMechanismSites, type createChapterTwoMechanisms } from './chapter-two-mechanisms.mts';

type Mechanisms = ReturnType<typeof createChapterTwoMechanisms>;

/** Connect the supplied visible meshes to the authoritative mechanism transforms. */
export function bindChapterTwoPresentation(root: Group, mechanisms: Mechanisms) {
  const door = chapterTwoMechanismSites.door;
  const prototype = root.getObjectByName('court_leaf');
  const hinges: { node: Group; side: number }[] = [];
  if (prototype) {
    const leaves = new Group();
    leaves.name = 'court_door_leaves';
    leaves.position.set(door.x, door.y, door.z);
    for (const side of [-1, 1]) {
      const node = new Group();
      node.position.x = side * door.hinge;
      const leaf = prototype.clone();
      leaf.visible = true;
      leaf.scale.set(door.leafWidth, door.leafHeight, 1);
      leaf.rotation.y = side < 0 ? 0 : Math.PI;
      node.add(leaf);
      leaves.add(node);
      hinges.push({ node, side });
    }
    root.add(leaves);
  }

  const slab = root.getObjectByName(chapterTwoMechanismSites.slab.node);
  const bells = mechanisms.bells.map(bell => ({ bell, node: root.getObjectByName(bell.node) }));
  const templates: Object3D[] = [];
  root.traverse(node => { if (node.name.startsWith('crumble') && 'isMesh' in node) templates.push(node); });
  const stones = mechanisms.crumbles.map((stone, index) => {
    const template = templates[index % templates.length];
    if (!template) return { stone, node: undefined };
    const node = template.clone();
    node.name = stone.id;
    root.add(node);
    return { stone, node };
  });

  return () => {
    for (const { node, side } of hinges) node.rotation.y = -side * mechanisms.door.leafAngle;
    if (slab) slab.position.z = mechanisms.slab.body.z;
    for (const { bell, node } of bells) if (node) node.rotation.z = bell.roll;
    for (const { stone, node } of stones) if (node) {
      node.position.set(stone.pose.x, stone.pose.y, stone.pose.z);
      node.visible = stone.pose.visible;
    }
  };
}
