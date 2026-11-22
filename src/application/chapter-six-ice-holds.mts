/** Local grip anchors and visual ice lifecycle from de, $e, et, and tt in ch6_summit-BczK7QHX.js. */
import type { MovingTriangleBody } from '../physics/moving-body.mts';
import type { CollisionPosition, CollisionWorld } from '../physics/world.mts';
import { chapterSixLedgeAttachments } from './chapter-six-ledges.mts';

const HOLD_SECONDS = 3.2;
const WARN_FRACTION = 0.4;
const HIDE_AFTER = 1.2;
const RESTORE_AFTER = 4.5;
const GRIP_STATES = new Set(['HANG', 'SHIMMY', 'GRAB']);

export type IceHoldPhase = 'whole' | 'holding' | 'falling' | 'gone';

export interface ChapterSixIceHoldPose extends CollisionPosition {
  rotationZ: number;
  visible: boolean;
}

export interface ChapterSixIceHold {
  readonly id: string;
  readonly bodyId: string;
  readonly nodeName: string;
  readonly body: MovingTriangleBody;
  readonly phase: IceHoldPhase;
  readonly pose: Readonly<ChapterSixIceHoldPose>;
}

export interface ChapterSixIceHoldPlayer {
  readonly state: string;
  readonly ledge?: Readonly<{ id: string }> | null;
  readonly teleports?: number;
}

export type ChapterSixIceHoldEvent = { type: 'cue'; name: 'crumble' } | { type: 'shake'; strength: number };

interface IceHoldNode {
  position: CollisionPosition & { set(x: number, y: number, z: number): unknown };
  rotation: { z: number };
  visible: boolean;
}

interface IceHoldRoot {
  getObjectByName(name: string): IceHoldNode | undefined;
}

/** The original switch platforms have empty collision batches and fixed grip transforms. */
export function createChapterSixIceHolds(
  world: Pick<CollisionWorld, 'addBody' | 'body'>,
  { onEvent }: { onEvent?: (event: ChapterSixIceHoldEvent) => void } = {},
) {
  const duplicate = chapterSixLedgeAttachments.find(({ bodyId }) => world.body(bodyId));
  if (duplicate) throw Error(`Chapter Six ice hold body ${duplicate.bodyId} was already installed`);

  const holds = chapterSixLedgeAttachments.map(attachment => ({
    ...attachment,
    nodeName: `hold_${attachment.id}`,
    body: world.addBody(attachment.bodyId, []),
    phase: 'whole' as IceHoldPhase,
    pose: { x: attachment.x, y: attachment.y, z: attachment.z, rotationZ: 0, visible: true },
    elapsed: 0, drop: 0, warned: false,
  }));
  type Hold = typeof holds[number];
  let teleport: number | undefined;
  let disposed = false;
  let presentation: { present(): void; unbind(): void } | undefined;

  function restorePresentation(hold: Hold) {
    Object.assign(hold.pose, { x: hold.x, y: hold.y, z: hold.z, rotationZ: 0, visible: true });
  }

  function resetHolds() {
    for (const hold of holds) {
      hold.phase = 'whole';
      hold.elapsed = hold.drop = 0;
      hold.warned = false;
      hold.body.enabled = true;
      hold.body.setPose(hold.x, hold.y, hold.z);
      restorePresentation(hold);
    }
  }

  function reset() {
    if (disposed) return;
    teleport = undefined;
    resetHolds();
    presentation?.present();
  }

  function step(delta: number, player?: ChapterSixIceHoldPlayer | null) {
    if (!Number.isFinite(delta) || delta < 0) throw RangeError('Ice-hold step must be finite and nonnegative');
    if (disposed || delta === 0 || !player) return;
    if (teleport !== player.teleports) {
      teleport = player.teleports;
      resetHolds();
    }
    const gripping = GRIP_STATES.has(player.state) ? player.ledge?.id : undefined;
    for (const hold of holds) {
      hold.body.setPose(hold.x, hold.y, hold.z, 0, 0, 0, delta);
      hold.elapsed += delta;
      switch (hold.phase) {
        case 'whole':
          if (gripping === hold.id) {
            hold.phase = 'holding';
            hold.elapsed = 0;
          }
          break;
        case 'holding': {
          const fraction = hold.elapsed / HOLD_SECONDS;
          const wobble = fraction > WARN_FRACTION ? 0.008 + 0.05 * (fraction - WARN_FRACTION) : 0;
          hold.pose.x = hold.x + Math.sin(hold.elapsed * 67) * wobble;
          hold.pose.y = hold.y - fraction * fraction * 0.06;
          if (fraction > WARN_FRACTION && !hold.warned) {
            hold.warned = true;
            onEvent?.({ type: 'cue', name: 'crumble' });
          }
          if (fraction >= 1) {
            hold.phase = 'falling';
            hold.elapsed = hold.drop = 0;
            hold.warned = false;
            hold.body.enabled = false;
            onEvent?.({ type: 'shake', strength: 0.14 });
          }
          break;
        }
        case 'falling':
          hold.drop += (8 + hold.elapsed * 18) * delta;
          hold.pose.y = hold.y - hold.drop;
          hold.pose.rotationZ = hold.elapsed * 0.8;
          if (hold.elapsed > HIDE_AFTER) {
            hold.phase = 'gone';
            hold.elapsed = 0;
            hold.pose.visible = false;
          }
          break;
        case 'gone':
          if (hold.elapsed >= RESTORE_AFTER) {
            hold.phase = 'whole';
            hold.elapsed = 0;
            hold.body.enabled = true;
            restorePresentation(hold);
          }
          break;
      }
    }
    presentation?.present();
  }

  /** Bind the authored `hold_*` groups after loading `props.glb`. */
  function bindPresentation(root: IceHoldRoot): () => void {
    if (disposed) throw Error('Chapter Six ice holds are disposed');
    const targets = holds.map(hold => {
      const node = root.getObjectByName(hold.nodeName);
      if (!node) throw Error(`Chapter Six ice hold node ${hold.nodeName} is missing`);
      return { hold, node };
    });
    presentation?.unbind();

    const bindings = targets.map(({ hold, node }) => ({ hold, node, previous: {
      x: node.position.x, y: node.position.y, z: node.position.z, rotationZ: node.rotation.z, visible: node.visible,
    } }));
    function apply(node: IceHoldNode, pose: ChapterSixIceHoldPose) {
      node.position.set(pose.x, pose.y, pose.z);
      node.rotation.z = pose.rotationZ;
      node.visible = pose.visible;
    }
    const binding = {
      present() { for (const { node, hold } of bindings) apply(node, hold.pose); },
      unbind() {
        if (presentation !== binding) return;
        presentation = undefined;
        for (const { node, previous } of bindings) apply(node, previous);
      },
    };
    presentation = binding;
    binding.present();
    return binding.unbind;
  }

  resetHolds();
  return {
    holds: holds as readonly ChapterSixIceHold[],
    bindPresentation, step, reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      presentation?.unbind();
      for (const hold of holds) {
        hold.body.enabled = false;
        hold.body.setPose(hold.x, hold.y, hold.z);
      }
    },
  };
}
