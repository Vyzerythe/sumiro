import { BoxGeometry, Mesh, MeshBasicNodeMaterial, Vector3, type Object3D } from 'three/webgpu';
import type { EnemyAttack } from '../combat/encounter-enemy.mts';
import { companionArrowHits } from '../domain/companion-risk.mts';
import type { CollisionPosition, CollisionWorld } from '../physics/world.mts';

type Shot = Exclude<EnemyAttack, { type: 'melee' }>;
interface Projectile {
  attack: Shot;
  position: Vector3;
  direction: Vector3;
  remaining: number;
  mesh: Mesh;
}

export function createEncounterProjectiles(world: CollisionWorld, root: Object3D) {
  const geometry = new BoxGeometry(1, 1, 1);
  const arrows = new MeshBasicNodeMaterial({ color: 0x332d29 });
  const waves = new MeshBasicNodeMaterial({ color: 0x22252b });
  const launched: Projectile[] = [];
  const target = new Vector3();
  const direction = new Vector3();

  function launch(attack: Shot) {
    const { origin } = attack;
    const base = new Vector3(origin.x, origin.y, origin.z);
    const axis = attack.type === 'arrow'
      ? new Vector3(attack.target.x, attack.target.y, attack.target.z).sub(base).normalize()
      : new Vector3(-Math.sin(attack.heading), 0, -Math.cos(attack.heading));
    if (axis.lengthSq() === 0) return;
    const mesh = new Mesh(geometry, attack.type === 'arrow' ? arrows : waves);
    mesh.name = attack.type;
    mesh.scale.set(attack.type === 'arrow' ? 0.025 : attack.width, attack.type === 'arrow' ? 0.025 : 0.15,
      attack.type === 'arrow' ? 0.75 : 0.45);
    mesh.position.copy(base);
    mesh.lookAt(direction.copy(base).add(axis));
    root.add(mesh);
    launched.push({ attack, mesh, direction: axis, position: base, remaining: attack.type === 'arrow' ? 85 : attack.length });
  }

  function step(delta: number, player: CollisionPosition, onStrike: (attack: Shot) => void, companion?: {
    position: Readonly<CollisionPosition>;
    onStrike(attack: Shot): void;
  }) {
    if (delta <= 0) return;
    for (let index = launched.length - 1; index >= 0; index--) {
      const shot = launched[index]!;
      const { position, direction: axis, attack, mesh } = shot;
      const travel = Math.min(shot.remaining, attack.speed * delta);
      const obstacle = world.raycast(position.x, position.y, position.z, axis.x, axis.y, axis.z, travel, 3);
      target.set(player.x, player.y + (attack.type === 'arrow' ? 0.9 : 0), player.z).sub(position);
      if (attack.type === 'wave') target.y *= 0.25;
      const projected = target.dot(axis);
      const closestAlong = Math.min(Math.max(projected, 0), travel, obstacle);
      target.addScaledVector(axis, -closestAlong);
      const radius = attack.type === 'arrow' ? 0.58 : attack.width / 2 + 0.3;
      const hit = target.lengthSq() < radius ** 2 && (obstacle === Infinity || projected < obstacle);
      const cat = companion?.position;
      const catTravel = Math.min(travel, obstacle, hit ? Math.max(0, closestAlong) : Infinity);
      const catHit = cat && attack.type === 'arrow' && catTravel > 0 && companionArrowHits({
        x: position.x + axis.x * catTravel, y: position.y + axis.y * catTravel, z: position.z + axis.z * catTravel,
        vx: axis.x, vy: axis.y, vz: axis.z,
      }, cat, catTravel);
      if (catHit) companion.onStrike(attack);
      else if (hit) onStrike(attack);
      shot.remaining -= travel;
      if (hit || catHit || obstacle < Infinity || shot.remaining <= 0) {
        mesh.removeFromParent();
        launched.splice(index, 1);
      } else {
        position.addScaledVector(axis, travel);
        mesh.position.copy(position);
      }
    }
  }

  function reset() { for (const shot of launched.splice(0)) shot.mesh.removeFromParent(); }
  return { launch, step, reset, dispose() { reset(); geometry.dispose(); arrows.dispose(); waves.dispose(); } };
}
