import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCollisionWorld } from '../src/physics/world.mts';
import { t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const triangles = [
  // Two ground squares, a vertical guard and a sloping ramp.
  { coords: [0,0,0, 10,0,0, 0,0,10, 10,0,0, 10,0,10, 0,0,10], options: { surface:'floor' } },
  { coords: [12,0,0, 20,0,0, 12,4,8], options: {surface:'ramp', group:'ramp'} },
  { coords: [5,0,0, 5,3,0, 5,0,10], options: {kind:4, group:'wall', fades:'wall-fade'} },
  { coords: [0,0,10, 0,2,10, 10,2,10], options: {kind:2, round:true} },
];

function makeWorld(factory) {
  const world=factory();
  for (const entry of triangles) world.addTriangles(entry.coords,entry.options);
  world.addDisc(3,3,1,0,3);
  const platform=world.addBody('platform',[
    {positions:[-2,1,-2, 2,1,-2, -2,1,2, 2,1,-2,2,1,2,-2,1,2],surface:'platform'}
  ]);
  platform.setPose(-3,0,-4,0.2,0,0,1);
  return world;
}
const normalize = value => value === null ? null : ({
  y:value.y, nx:value.nx, ny:value.ny, nz:value.nz,
  surface:value.surface, body:value.body?.id ?? null
});
const contact = value => ({
  x:value.x,z:value.z,hit:value.hit,solid:value.solid,
  depth:value.depth,kind:value.kind,nx:value.nx,nz:value.nz,
  group:value.group,round:value.round,body:value.body?.id ?? null
});
const samplePositions = [
  [-10,-10],[-3,-4],[0,0],[3,3],[4,4],[5,5],
  [9.999,1],[10.001,5],[12,0],[13,2],[16,5],[100,100]
];
function compareGround(original, candidate) {
  for (const [x,z] of samplePositions) for (const [maximum,minimum] of [
    [Infinity,-Infinity],[10,-10],[1.5,-1],[0,0],[-1,-5]
  ]) {
    assert.deepEqual(
      normalize(candidate.groundAt(x,z,maximum,minimum)),
      normalize(original.groundAt(x,z,maximum,minimum)),
      'groundAt '+JSON.stringify([x,z,maximum,minimum])
    );
  }
}

test('world triangle/disc indexing, body exposure, and ground normals match',()=>{
  const original=makeWorld(createPublishedWorld);
  const candidate=makeWorld(createCollisionWorld);
  assert.deepEqual(candidate.stats(),original.stats());
  assert.deepEqual(candidate.discs(),original.discs());
  assert.deepEqual(candidate.triangles().map(tri => [...tri]),original.triangles().map(tri => [...tri]));
  assert.equal(candidate.body('absent'),null);
  assert.equal(candidate.body('platform').id,original.body('platform').id);
  compareGround(original,candidate);
  original.setGroup('ramp',false);
  candidate.setGroup('ramp',false);
  compareGround(original,candidate);
  original.setGroup('ramp',true);
  candidate.setGroup('ramp',true);
  compareGround(original,candidate);
});

test('ray distance, mask filters, and fades agree with published engine',()=>{
  const original=makeWorld(createPublishedWorld);
  const candidate=makeWorld(createCollisionWorld);
  const rays = [
    [5,10,5,0,-1,0,50],[5,5,-4,0,0,1,30],
    [15,10,3,0,-1,0,40],[-3,9,-4,0,-1,0,20],
    [-10,0,-10,1,0,1,40],[5,1,15,0,0,-1,30],
    [100,100,100,0,-1,0,20],[0,0,0,1,0,0,10],
  ];
  for (const mask of [1,2,4,7,10,15]) for (const args of rays) {
    const a=original.raycast(...args,mask);
    const b=candidate.raycast(...args,mask);
    assert.equal(b,a,'raycast '+JSON.stringify({args,mask}));
    assert.equal(candidate.rayFades,original.rayFades);
  }
  original.setGroup('wall',false);
  candidate.setGroup('wall',false);
  for (const args of rays) {
    assert.equal(candidate.raycast(...args),original.raycast(...args));
    assert.equal(candidate.rayFades,original.rayFades);
  }
});

test('capsule sweeps preserve contacts, discs, guards, and moving triangle behavior',()=>{
  const original=makeWorld(createPublishedWorld);
  const candidate=makeWorld(createCollisionWorld);
  const inputs = [
    [{x:2,y:0,z:1},3,2,{}],
    [{x:5,y:0,z:-2},0,6,{radius:.4,height:2,guards:true,solid:true}],
    [{x:3,y:0,z:3},1,0,{radius:.3,height:1.7}],
    [{x:-3,y:1,z:-4},1,0,{radius:.4,height:2}],
    [{x:10,y:0,z:10},2,1,{radius:.25,height:1.5,guards:false}],
    [{x:1,y:0,z:1},0,0,{radius:.5,height:2}],
    [{x:Infinity,y:1,z:0},2,0,{}],
  ];
  for (const [position,dx,dz,settings] of inputs) {
    const a=original.sweepCapsule({...position},dx,dz,settings,{});
    const b=candidate.sweepCapsule({...position},dx,dz,settings,{});
    assert.deepEqual(contact(b),contact(a),'sweep '+JSON.stringify([position,dx,dz,settings]));
  }
});

test('ground hits are borrowed while capsule sweeps fill caller-owned output', () => {
  const original = makeWorld(createPublishedWorld);
  const candidate = makeWorld(createCollisionWorld);
  for (const world of [candidate, original]) {
    const ground = world.groundAt(1, 1);
    const floor = normalize(ground);
    assert.equal(floor.surface, 'floor');
    assert.equal(world.groundAt(100, 100), null);
    assert.deepEqual(normalize(ground), floor, 'a miss does not clear a borrowed hit');
    assert.strictEqual(world.groundAt(-3, -4), ground);
    assert.strictEqual(ground.body, world.body('platform'));
    assert.equal(ground.surface, 'platform');

    const output = { tag: Symbol(), kind: 'pending' };
    const disc = { x: 3, y: 0, z: 3 };
    assert.strictEqual(world.sweepCapsule(disc, 1, 0, undefined, output), output);
    assert.equal(output.hit, true);
    assert.equal(output.round, true);
    const tag = output.tag;
    assert.strictEqual(world.sweepCapsule({ x: Infinity, y: 1, z: 7 }, 2, 0, undefined, output), output);
    assert.strictEqual(output.tag, tag);
    assert.deepEqual(contact(output), {
      x: Infinity, z: 7, hit: false, solid: false, depth: 0, kind: 0, nx: 0, nz: 0,
      group: null, round: false, body: null,
    });
    assert.notStrictEqual(world.sweepCapsule(disc, 1, 0), world.sweepCapsule(disc, 1, 0));
  }
});

test('deterministic random ground/ray sweeps retain parity',()=>{
  let seed=0x9a213;
  const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
  const original=makeWorld(createPublishedWorld);
  const candidate=makeWorld(createCollisionWorld);
  for (let index=0;index<120;index++) {
    const x=rand()*35-10,z=rand()*35-10,y=rand()*12-4;
    assert.deepEqual(normalize(candidate.groundAt(x,z)),normalize(original.groundAt(x,z)));
    const direction=[rand()*2-1,rand()*2-1,rand()*2-1];
    const args=[x,y,z,...direction,12,15];
    assert.equal(candidate.raycast(...args),original.raycast(...args));
    assert.equal(candidate.rayFades,original.rayFades);
    const moveX=(rand()-.5)*3,moveZ=(rand()-.5)*3;
    const opts={radius:.25+rand()*.3,height:1+rand(),solid:rand()>.5};
    const a=original.sweepCapsule({x,y,z},moveX,moveZ,opts);
    const b=candidate.sweepCapsule({x,y,z},moveX,moveZ,opts);
    assert.deepEqual(contact(b),contact(a),'random sweep at '+index);
  }
});
