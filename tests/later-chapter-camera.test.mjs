import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import { laterChapterCameraDefinitions } from '../src/application/chapter-camera-zones.mts';
import { createChapterCameraRig, createLaterChapterCamera } from '../src/application/later-chapter-camera.mts';
import { createMeshRaycaster } from '../src/physics/sight.mts';

async function inspect(filename) {
  const url = new URL(`../sumiro/bundle/${filename}`, import.meta.url);
  const ast = ts.createSourceFile(filename, await readFile(url,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const nodes = ast.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? [...statement.declarationList.declarations] : [statement]);
  function node(name) {
    const entry = nodes.find(entry => entry.name?.getText(ast) === name);
    assert.ok(entry,name);
    return entry;
  }
  return {
    exact: name => node(name).getText(ast),
    statements: ast.statements.map(statement => statement.getText(ast)),
    property: (name,key) => node(name).initializer.properties.find(member => member.name?.getText(ast) === key)?.initializer.getText(ast),
  };
}

const chapters = [
  ['ch2_pass','9Opjv4P2','Z',['J','Y','Ae','je']],
  ['ch3_pines','BCHma7IG','q',['C','me']],
  ['ch4_temple','XtSLeUue','W',['S']],
  ['ch5_sea','CpHUIhkX','q',['C']],
  ['ch6_summit','BczK7QHX','q',['x']],
];
const originals = Object.fromEntries(await Promise.all(chapters.map(async ([id, chunk, level, helpers]) => {
  const { exact, statements, property } = await inspect(`${id}-${chunk}.js`);
  // Wobble affects the Z of the horizontal sides only. The two vertical
  // sides are plain, so the world generator's seed cannot change these X minima.
  const rocks = id === 'ch2_pass' ? `
    const T=()=>{},F=0;
    ${exact('pe')} ${exact('C')}
    const ${exact('L')},${exact('S')};
    let ${exact('me')};
    ${statements.find(statement => statement.startsWith('L(`ink_a`'))}
  ` : '';
  return [id,Function(`
    ${rocks}
    const ${helpers.map(exact).join(',')};
    return {zones:${property(level,'cameraZones')},sightMeshes:${property(level,'sightMeshes')},
      ${property(level,'sightTwoSided') ? `twoSided:${property(level,'sightTwoSided')}` : ''}};
  `)()];
})));

const { exact } = await inspect('camera_rig-DQPkG66d.js');
const collision = await inspect('collision-DtBQEpmQ.js');
const sightKernel = await import('../sumiro/bundle/sight-DXR0ElmN.js');
const pointTest = Function(`${collision.exact('o')};return o;`)();

const tuning = ['u','d','f','p','m','h','g','_','v','P','Te','Ee','De','Oe','ke','Ae','F','je','Me','Ne','Pe','Fe','Ie','Le',
  'Re','ze','Be','Ve','He','Ue','We','Ge','Ke','qe','Je','Ye','Xe','$e','et','tt','nt','rt','it','at','ot','I','Ut'];
const methods = ['l','y','b','At','jt','Pt','Rt','zt','Bt','Vt','Ht','Wt','Gt'];
const makeOriginal = Function('e','t','n','definition','world','sight','fighting',`
  const ${tuning.map(exact).join(',')};
  ${methods.map(exact).join('\n')}
  const r=15, Ft={yaw:0,pitch:0}, It={copy(){}}, stubs={lookX:0,lookY:0};
  const point={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});},copy(){}};
  const rotation={set(pitch,yaw){Object.assign(this,{pitch,yaw});}};
  const camera={position:point,rotation};
  const level={cameraZones:definition.zones,world,sight};
  const H=b(level,{fighting});
  const B={}, pt={update(fade){this.fade=fade;}};
  const G={goal:0,fresh:true},K={spring:u(),goal:0,wait:0,clear:0,fresh:true},q={spring:u(),goal:0,clear:0},
    J={x:u(),y:u(),z:u(),fresh:true},Y=u(),W=u(),St=u(),Ct=u(),Z={yaw:0,pitch:0};
  let dt=0,$=false,X=true,U=0;
  let packet={};
  const registry={get:key=>packet[key]};
  const ctx={camera,input:stubs,registry,time:{t:0}};
  return (feet,movement,delta,teleport,look={})=>{
    packet={'player.move':{...movement,link:{camera:{zone:movement.leapZone}}},'level.current':level,
      'player.teleports':teleport,'game.options':{sensitivity:look.sensitivity,invertY:look.invertY}};
    Object.assign(stubs,{lookX:look.x??0,lookY:look.y??0});
    ctx.time.t+=delta;
    Pt(delta,ctx,feet);
    return {x:point.x,y:point.y,z:point.z,pitch:B.pitch,yaw:B.yaw,railYaw:B.railYaw,zone:B.zone,
      fadeTarget:pt.fade??null,railFrame:null};
  };
`);

const clearWorld = () => ({ raycast: () => Infinity, groundAt: () => null, rayFades: null });
function comparePose(actual, expected) {
  for (const key of ['x','y','z','yaw','pitch','railYaw']) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} vs ${expected[key]}`);
  }
  for (const key of ['zone','fadeTarget','railFrame']) assert.equal(actual[key],expected[key],key);
}

test('all 149 authored zones and sight patterns match the five published chapter declarations', () => {
  assert.deepEqual(laterChapterCameraDefinitions,originals);
  assert.deepEqual(Object.values(originals).map(chapter => chapter.zones.length),[44,23,29,33,20]);
});

const scenarios = {
  ch2_pass: [
    [{x:14,y:7,z:-17},{grounded:true},'court'],
    [{x:14,y:7,z:-45},{grounded:true,carrier:'court_slab'},'court_slab'],
    [{x:48,y:30,z:-220},{grounded:false,groundY:33,kind:'leap',leapZone:'cleft'},'cleft'],
    [{x:50,y:32,z:-219},{grounded:true},'cleft'],
    [{x:14.8,y:5,z:-219},{grounded:false,groundY:5,kind:'hang',holdYaw:-Math.PI/2},'ink_a_hold'],
    [{x:39,y:17,z:-128.4},{grounded:true},'hop',null,true],
    [{x:37.8,y:39.4,z:-221},{grounded:true},'ridge_fight','ridge'],
    [{x:37.8,y:39.4,z:-221},{grounded:true},'west_top'],
  ],
  ch3_pines: [
    [{x:40,y:18,z:-139.45},{grounded:true},'shelf'],
    [{x:-206,y:26,z:-198},{grounded:true},'r8_table',null,true],
    [{x:-206,y:26,z:-198},{grounded:true},'r8_fight','pines_far'],
    [{x:-195,y:24,z:-204.5},{grounded:false,groundY:26,kind:'hang',holdYaw:1.1},'r8_face_hold'],
    [{x:3,y:8,z:-18},{grounded:true},'ascent',null,true],
  ],
  ch4_temple: [
    [{x:22,y:16,z:-111},{grounded:true},'t2'],
    [{x:30,y:59,z:-431},{grounded:true},'gc',null,true],
    [{x:31,y:59,z:-435},{grounded:true},'gc_fight','great'],
    [{x:30,y:62,z:-480},{grounded:false,groundY:59},'gc_fight','great'],
    [{x:30,y:60,z:-480},{grounded:true},'hall'],
    [{x:76,y:39,z:-285},{grounded:true},'top_fight','top_guard'],
  ],
  ch5_sea: [
    [{x:31,y:6,z:-215},{grounded:false,groundY:4},'raft'],
    [{x:36,y:2,z:-230},{grounded:true,carrier:'raft'},'on_raft'],
    [{x:7,y:3,z:-298},{grounded:true,carrier:'grey'},'on_grey'],
    [{x:41,y:5,z:-286},{grounded:true,carrier:'boat1'},'on_boat1'],
    [{x:140,y:5,z:-397},{grounded:true},'across_fight','across',true],
    [{x:121,y:2,z:-535},{grounded:false,groundY:3,kind:'leap',leapZone:'court'},'court'],
    [{x:165,y:3,z:-532},{grounded:true,carrier:'barge'},'on_barge'],
  ],
  ch6_summit: [
    [{x:33,y:13,z:-108},{grounded:true},'z_a1'],
    [{x:-129.4,y:72,z:-351},{grounded:true},'z_gaunt_fight','gauntlet',true],
    [{x:-132.4,y:72,z:-351},{grounded:true},'z_gaunt_fight','gauntlet'],
    [{x:-132.4,y:72,z:-351},{grounded:true},'z_gaunt'],
    [{x:-274.5,y:87,z:-349},{grounded:true},'z_end',null,true],
    [{x:-276.6,y:87.2,z:-350},{grounded:true},'z_end'],
  ],
};

for (const [chapter, samples] of Object.entries(scenarios)) {
  test(`${chapter} follows its published pose and steering across representative movement`, () => {
    let encounter, teleport = 0;
    const fighting = id => id === encounter;
    const native = createChapterCameraRig(laterChapterCameraDefinitions[chapter],{world:clearWorld(),fighting});
    const shipped = makeOriginal(pointTest,sightKernel.i,sightKernel.r,originals[chapter],clearWorld(),undefined,fighting);
    for (const [feet,movement,zone,fight,reset] of samples) {
      encounter = fight;
      if (reset) teleport++;
      for (let i = 0; i < 20; i++) {
        const look = i === 2 ? {x:35,y:-12,sensitivity:.6,invertY:true} : undefined;
        const actual = native.update(feet,movement,1/60,teleport,look);
        const expected = shipped(feet,movement,1/60,teleport,look);
        assert.equal(actual.zone,zone);
        comparePose(actual,expected);
      }
    }
  });
}

function cameraWall() {
  const root = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([
    5,0,-13, 23,12,-13, 23,0,-13,
    5,0,-13, 5,12,-13, 23,12,-13,
  ],3));
  const wall = new Mesh(geometry);
  wall.name = 'pass_wall_oracle';
  root.add(wall);
  return root;
}

test('sight and physical collision adjust the authored camera and expose a fade target', () => {
  const chapter = 'ch2_pass';
  const root = cameraWall();
  root.updateWorldMatrix(true,true);
  const nativeSight = createMeshRaycaster(root,originals[chapter].sightMeshes);
  const originalSight = sightKernel.a(root,originals[chapter].sightMeshes);
  function nearWorld() {
    return { blocked: true, rayFades: null,
      raycast(x,y,z,dx,dy,dz,dist,kind) {
        const hit = this.blocked && kind === 8 && dist > 1 ? 1 : Infinity;
        this.rayFades = hit < Infinity ? 'cliff' : null;
        return hit;
      },
      groundAt: nullGround,
    };
  }
  function nullGround() { return null; }
  const nw = nearWorld(), ow = nearWorld();
  const native = createChapterCameraRig(laterChapterCameraDefinitions[chapter],{world:nw,sight:nativeSight});
  const shipped = makeOriginal(pointTest,sightKernel.i,sightKernel.r,originals[chapter],ow,originalSight,()=>false);
  const feet = {x:14,y:6,z:-17};
  const movement = {grounded:true};
  const clear = createChapterCameraRig(laterChapterCameraDefinitions[chapter]).update(feet,movement,0);
  const first = native.update(feet,movement,0);
  comparePose(first,shipped(feet,movement,0,0));
  assert.ok(first.pitch < clear.pitch);
  assert.ok(first.obstructed);
  assert.equal(first.fadeTarget,'cliff');
  nw.blocked = ow.blocked = false;
  for (let i=0;i<100;i++) comparePose(native.update(feet,movement,1/60),shipped(feet,movement,1/60,0));
  const indexed = createLaterChapterCamera(nearWorld(),chapter,{root});
  const state = {...feet,heading:0,grounded:true,lastGroundY:feet.y,state:'IDLE',carrier:null,leap:null};
  comparePose(indexed(state,0,0),first);
});

test('the traversal factory uses a safe stable pose for chapters without authored zones', () => {
  const camera = createLaterChapterCamera(clearWorld(),'missing');
  const state = {x:10,y:2,z:-8,heading:0,grounded:true,lastGroundY:2,state:'IDLE',carrier:null,leap:null};
  const pose = camera(state,0,0);
  assert.equal(pose.zone,'missing');
  assert.equal(pose.yaw,0);
  assert.ok(Math.abs(pose.y - 4.55) < 1e-12 && Math.abs(pose.z + 2.7) < 1e-12);
  assert.equal(pose.railFrame,null);
});
