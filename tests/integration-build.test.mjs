import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, '.local-build-test');
const game = 'sumiro/bundle/game-B5zfa1fm.js';
const chapters = 'sumiro/bundle/chapters-B8aGs4KP.js';
const kit = 'sumiro/bundle/kit-B01EgPBo.js';
const collision = 'sumiro/bundle/collision-DtBQEpmQ.js';
const player = 'sumiro/bundle/player-1_KrBWnI.js';

test('source-backed build preserves originals and binds live domain imports', async () => {
  const hash = data => createHash('sha256').update(data).digest('hex');
  const before = await Promise.all([game, chapters, kit, collision, player].map(p => readFile(join(root,p))));
  try {
    const result = spawnSync(process.execPath, ['scripts/build-reconstructed-dev.mjs', '--out', out], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const after = await Promise.all([game, chapters, kit, collision, player].map(p => readFile(join(root,p))));
    assert.deepEqual(after.map(hash), before.map(hash), 'published files changed');
    const [outputGame, outputChapters, outputKit, outputCollision, outputPlayer, report, index] = await Promise.all([
      readFile(join(out,game),'utf8'),
      readFile(join(out,chapters),'utf8'),
      readFile(join(out,kit),'utf8'),
      readFile(join(out,collision),'utf8'),
      readFile(join(out,player),'utf8'),
      readFile(join(out,'reconstruction-build.json'),'utf8'),
      readFile(join(out,'sumiro/index.html'),'utf8'),
    ]);
    assert.match(outputGame, /from'\.\.\/\.\.\/src\/domain\/save\.mjs'/);
    assert.doesNotMatch(outputGame, /function te\(/);
    assert.match(outputChapters, /src\/domain\/chapters\.mjs/);
    assert.match(outputKit, /src\/domain\/scrolls\.mjs/);
    assert.match(outputCollision, /src\/physics\/geometry\.mjs/);
    assert.match(outputCollision, /src\/physics\/moving-body\.mjs/);
    assert.match(outputCollision, /src\/physics\/world\.mjs/);
    assert.match(outputPlayer, /src\/player\/cinematic-timeline\.mjs/);
    assert.match(outputPlayer, /src\/player\/ledge-path\.mjs/);
    assert.match(outputPlayer, /src\/player\/input-steering\.mjs/);
    assert.match(outputPlayer, /src\/player\/locomotion\.mjs/);
    assert.match(outputPlayer, /src\/player\/movement-config\.mjs/);
    assert.match(outputPlayer, /src\/player\/ledge-grab\.mjs/);
    assert.match(outputPlayer, /src\/player\/ledge-controller\.mjs/);
    assert.match(outputPlayer, /src\/player\/mantle\.mjs/);
    assert.match(outputPlayer, /function pt\(e=1\)\{return probeLowMantle/);
    assert.match(outputPlayer, /function mt\(\)\{return probeWallMantle/);
    assert.match(outputPlayer, /function ht\(e\)\{beginLowMantle/);
    assert.match(outputPlayer, /function gt\(\)\{updateLowMantle/);
    assert.match(outputPlayer, /function St\(e,t\)\{beginLedgeGrab/);
    assert.match(outputPlayer, /function kt\(e\)\{updateLedgeHang/);
    assert.match(outputPlayer, /function jt\(\)\{completeLedgeClimb/);
    assert.doesNotMatch(outputPlayer, /var O=\{/);
    assert.match(outputPlayer, /function at\(\)\{beginJump/);
    assert.match(outputPlayer, /function it\(e=0\)\{beginFall/);
    assert.match(outputPlayer, /function Qe\(\)\{classifyGroundGait/);
    assert.match(outputPlayer, /function ot\(\)\{selectTravelDirection/);
    assert.match(outputPlayer, /function Le\(e\)\{updateInputSteering/);
    assert.doesNotMatch(outputPlayer, /function Ae\(e\)\{/);
    assert.doesNotMatch(outputPlayer, /function U\(e,t\)\{/);
    assert.doesNotMatch(outputCollision, /function i\(\)\{/);
    assert.doesNotMatch(outputKit, /w=Object\.keys\(C\)\.length/);
    assert.match(index, /bundle\/index-/);
    assert.equal(JSON.parse(report).kind, 'transitional-source-backed-development-build');

    const adapter = await import(pathToFileURL(join(out,chapters)).href);
    const readable = await import(pathToFileURL(join(out,'src/domain/chapters.mjs')).href);
    assert.deepEqual(adapter.t, readable.chapters);
    assert.deepEqual(adapter.r('ch2_pass'), { inkStep: true, sword: true });
    const scrolls = await import(pathToFileURL(join(out,'src/domain/scrolls.mjs')).href);
    assert.equal(scrolls.scrollCount, 12);
    const geometry = await import(pathToFileURL(join(out,'src/physics/geometry.mjs')).href);
    assert.equal(geometry.pointInPolygon(3, 3, [[0,0],[5,0],[5,5],[0,5]]), true);
    const collisionAdapter = await import(pathToFileURL(join(out,collision)).href);
    assert.equal(collisionAdapter.r(3, 3, [[0,0],[5,0],[5,5],[0,5]]), true);
    const movingWorld = collisionAdapter.t();
    const movingBody = movingWorld.addBody('test', [{positions:[0,0,0, 1,0,0, 0,0,1]}]);
    assert.equal(movingBody.tris.length, 1);
    movingBody.setPose(2,1,0,0,0,0,1);
    assert.deepEqual(movingBody.toWorld(0,0,0), {x:2,y:1,z:0});
    const timeline = await import(pathToFileURL(join(out,'src/player/cinematic-timeline.mjs')).href);
    assert.equal(timeline.timelineState(205), 'LEAP');
    const ledges = await import(pathToFileURL(join(out,'src/player/ledge-path.mjs')).href);
    assert.equal(ledges.createLedgePath({points:[[0,0,0,1,0],[3,0,4,1,0]]}).length,5);
    const steering = await import(pathToFileURL(join(out,'src/player/input-steering.mjs')).href);
    const state = {state:'IDLE',zone:null,holdActive:false,yaw:0,grounded:true,stickX:0,stickZ:0,stickMag:0,stickAngle:0,jumpBuf:0};
    steering.updateInputSteering(state,{forward:1,strafe:0,jump:true},null,null,1/60,.15,1.6);
    assert.equal(state.stickZ,-1);
    assert.equal(state.jumpBuf,.15);
    const locomotion = await import(pathToFileURL(join(out,'src/player/locomotion.mjs')).href);
    const movement = {vx:0,vz:0,state:'IDLE',stateT:1};
    locomotion.classifyGroundGait(movement);
    assert.equal(movement.state,'IDLE');
    const movementConfig = await import(pathToFileURL(join(out,'src/player/movement-config.mjs')).href);
    assert.equal(movementConfig.movementConfig.gravity,24);
    const grab = await import(pathToFileURL(join(out,'src/player/ledge-grab.mjs')).href);
    assert.equal(typeof grab.detectLedgeGrab, 'function');
    const controller = await import(pathToFileURL(join(out,'src/player/ledge-controller.mjs')).href);
    assert.equal(typeof controller.completeLedgeClimb, 'function');
    const mantle = await import(pathToFileURL(join(out,'src/player/mantle.mjs')).href);
    assert.equal(typeof mantle.probeLowMantle, 'function');
    const saves = await import(pathToFileURL(join(out,'src/domain/save.mjs')).href);
    assert.equal(saves.createDefaultRun().chapter, 'ch1_climb');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('build refuses unsafe destinations before altering any project files', async () => {
  const forbidden = ['.', 'sumiro', 'sumiro/assets', 'sumiro/.local-build', 'src', 'docs', 'tests', '.local-build/nested', '../outside'];
  for (const name of forbidden) {
    const result = spawnSync(process.execPath, ['scripts/build-reconstructed-dev.mjs', '--out', name], {
      cwd: root, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'unsafe output unexpectedly accepted: ' + name);
    assert.match(result.stderr, /Output must be a root-level/);
  }
});
