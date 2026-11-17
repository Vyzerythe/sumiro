#!/usr/bin/env node
/**
 * Assemble a SOURCE-BACKED development distribution from the immutable
 * published build and the first recovered modules.
 *
 * This is a transitional integration build, not a fully reconstructed game.
 * The published directory under sumiro/ is never modified.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const outArg = process.argv.indexOf('--out');
const output = resolve(root, outArg >= 0 ? process.argv[outArg + 1] ?? '' : '.local-build');
if (outArg >= 0 && !process.argv[outArg + 1]) throw Error('--out requires a directory');
const relativeOutput = output.slice(root.length + 1);
// Only direct, untracked scratch directories are disposable. Never accept a
// tracked path, a nested path under sumiro/src, or an ancestor of the repo.
if (!output.startsWith(root + '/') || !/^\.local-build(?:-[a-z0-9-]+)?$/.test(relativeOutput)) {
  throw Error('Output must be a root-level .local-build[-name] scratch directory');
}

const originalGame = join(root, 'sumiro/bundle/game-B5zfa1fm.js');
const originalChapters = join(root, 'sumiro/bundle/chapters-B8aGs4KP.js');
const originalKit = join(root, 'sumiro/bundle/kit-B01EgPBo.js');
const originalCollision = join(root, 'sumiro/bundle/collision-DtBQEpmQ.js');
const originalPlayer = join(root, 'sumiro/bundle/player-1_KrBWnI.js');
const EXPECTED_GIT_BLOBS = {
  game: '284349f2f8d0235e163f3c9b88b17ed222e3b269',
  chapters: '3da4e0f31fed783d0e548dd40fd0c1113cca16ec',
  kit: 'd92a7b85baceb33cf9c7243a27fbfea98fa5436d',
  collision: 'bb06154a9be5a24421a017f4c84adf7c87064d1b',
  player: '2ba1dbb18011510e025d5f3af06b045f143a3d10',
};
const sha = data => createHash('sha1')
  .update('blob ' + Buffer.byteLength(data) + '\0')
  .update(data).digest('hex');
const game = await readFile(originalGame);
const chapters = await readFile(originalChapters);
const kit = await readFile(originalKit);
const collision = await readFile(originalCollision);
const player = await readFile(originalPlayer);
if (sha(game) !== EXPECTED_GIT_BLOBS.game || sha(chapters) !== EXPECTED_GIT_BLOBS.chapters || sha(kit) !== EXPECTED_GIT_BLOBS.kit || sha(collision) !== EXPECTED_GIT_BLOBS.collision || sha(player) !== EXPECTED_GIT_BLOBS.player) {
  throw Error('Published bundle has changed: audit integration boundaries before rebuilding');
}

const gameText = game.toString('utf8');
const start = gameText.indexOf('var u=');
const end = gameText.indexOf('var v=', start);
if (start < 0 || end < 0 || gameText.indexOf('sumiro.save.v1', start) > end) {
  throw Error('Save prelude could not be isolated');
}
const prior = gameText.slice(start, end);
for (const name of ['function p(', 'function m(', 'function te(', 'function h(', 'function g(', 'function _(']) {
  if (!prior.includes(name)) throw Error('Missing required original save function: ' + name);
}
const saveImports = [
  'saveKey as u', 'legacySaveKey as ee', 'legacyChapterAliases as d',
  'defaultOptions as f', 'migrateOptions as p', 'createDefaultRun as m',
  'isSupportedSave as te', 'normalizeSaveChapters as h',
  'loadSave as g', 'writeSave as _',
].join(',');
const rewritten = "import{" + saveImports + "}from'../../src/domain/save.mjs';\n"
  + gameText.slice(0, start) + gameText.slice(end);

const chapterAdapter = [
  "/* Transitional adapter: readable source module, original bundle export names. */",
  "export { findChapter as a, transitionToChapter as i,",
  "  firstChapterId as n, abilitiesAtChapter as r, chapters as t",
  "} from '../../src/domain/chapters.mjs';",
  '',
].join('\n');

const kitSource = kit.toString('utf8');
const catalogPattern = /var C=\{[\s\S]*?\},w=Object\.keys\(C\)\.length,T=\{[\s\S]*?\},E=\{preset:/;
const catalogMatch = kitSource.match(catalogPattern);
if (!catalogMatch || kitSource.match(/w=Object\.keys\(C\)\.length/g)?.length !== 1) {
  throw Error('Published scroll catalog layout changed; re-audit before integrating');
}
const kitRewritten = "import { scrollTexts as C, scrollCount as w, scrollsByChapter as T } from '../../src/domain/scrolls.mjs';\n"
  + kitSource.replace(catalogPattern, 'var E={preset:');

const collisionText = collision.toString('utf8');
const collisionTail = /function a\(e,t,n,r=\[\]\)\{[\s\S]*?\}function o\(e,t,n\)\{[\s\S]*?\}(?=export\{a as n,o as r,i as t\};$)/;
if (!collisionTail.test(collisionText)) throw Error('Collision geometry function boundary changed: re-audit');
const bodyPattern = /function n\(e,t\)\{[\s\S]*?\}(?=function r\(e\)\{)/;
if (!bodyPattern.test(collisionText)) throw Error('Collision moving-body factory boundary changed: re-audit');
const originalWorldFactory = /function i\(\)\{[\s\S]*?(?=export\{a as n,o as r,i as t\};$)/;
const collisionWithoutGeometryOrBody = collisionText.replace(bodyPattern, '').replace(collisionTail, '');
if (!originalWorldFactory.test(collisionWithoutGeometryOrBody)) {
  throw Error('Collision world factory boundary changed: re-audit');
}
const collisionRewritten = "import { extrudeWallPolyline as a, pointInPolygon as o } from '../../src/physics/geometry.mjs';\n"
  + "import { createMovingTriangleBody as n } from '../../src/physics/moving-body.mjs';\n"
  + "import { createCollisionWorld as i } from '../../src/physics/world.mjs';\n"
  + collisionWithoutGeometryOrBody.replace(originalWorldFactory, '');

const playerText = player.toString('utf8');
const playerConfig = /var O=\{[\s\S]*?\},k=O,ee=24/;
if (!playerConfig.test(playerText) || playerText.match(/\bk=O,ee=24/g)?.length !== 1) {
  throw Error('Movement configuration boundary changed: re-audit');
}
const ledgeFactory = /function Ae\(e\)\{[\s\S]*?\}(?=function je\()/;
const steeringFunction = /function Le\(e\)\{[\s\S]*?\}(?=function Re\(\)\{)/;
const gaitFunction = /function Qe\(\)\{[\s\S]*?\}(?=function \$e\()/;
const directionFunction = /function ot\(\)\{[\s\S]*?\}(?=function st\()/;
const jumpFunction = /function at\(\)\{[\s\S]*?\}(?=function ot\()/;
const fallFunction = /function it\(e=0\)\{[\s\S]*?\}(?=function at\()/;
const ledgeGrabBlock = /function St\(e,t\)\{[\s\S]*?\}(?=function Tt\()/;
const ledgeHangBlock = /function kt\(e\)\{[\s\S]*?\}(?=function Mt\()/;
const lowMantleBlock = /function pt\(e=1\)\{[\s\S]*?\}(?=function _t\(\))/;
const headingFunction = /function U\(e,t\)\{[\s\S]*?\}(?=var Me=)/;
const timelineFunctions = /function Ve\(e\)\{[\s\S]*?\}(?=var Ge=)/;
if (!headingFunction.test(playerText) || !timelineFunctions.test(playerText) || !ledgeFactory.test(playerText) || !steeringFunction.test(playerText) || !gaitFunction.test(playerText) || !directionFunction.test(playerText) || !jumpFunction.test(playerText) || !fallFunction.test(playerText) || !ledgeGrabBlock.test(playerText) || !ledgeHangBlock.test(playerText) || !lowMantleBlock.test(playerText)) {
  throw Error('Player cinematic timing boundary changed: re-audit');
}
const playerRewritten = [
  "import { interpolateHeading as U, runAnimationFrame as Ve, jogAnimationFrame as He, timelineState as Ue, timelineSurface as We } from '../../src/player/cinematic-timeline.mjs';",
  "import { createLedgePath as Ae } from '../../src/player/ledge-path.mjs';",
  "import { updateInputSteering } from '../../src/player/input-steering.mjs';",
  "import { classifyGroundGait, selectTravelDirection, beginJump, beginFall } from '../../src/player/locomotion.mjs';",
  "import { movementConfig as O } from '../../src/player/movement-config.mjs';",
  "import { alignToLedge, beginLedgeGrab, detectLedgeGrab } from '../../src/player/ledge-grab.mjs';",
  "import { shimmyAlongLedge, updateLedgeHang, completeLedgeClimb } from '../../src/player/ledge-controller.mjs';",
  "import { probeLowMantle, probeWallMantle, beginLowMantle, updateLowMantle } from '../../src/player/mantle.mjs';",
  playerText.replace(playerConfig, 'var k=O,ee=24').replace(headingFunction, '').replace(timelineFunctions, '').replace(ledgeFactory, '')
    .replace(steeringFunction,
      'function Le(e){updateInputSteering(q,m,p.get(`camera_rig.rail`),sn.script,e,k.buffer,me)}')
    .replace(gaitFunction,'function Qe(){classifyGroundGait(q)}')
    .replace(directionFunction,'function ot(){selectTravelDirection(q,U)}')
    .replace(jumpFunction,'function at(){beginJump(q,k,{detach:Be,play:(clip,options)=>y.play(clip,options),footstep:qt,setState:J})}')
    .replace(fallFunction,'function it(e=0){beginFall(q,k,{detach:Be,play:(clip,options)=>y.play(clip,options),setState:J},e)}')
    .replace(ledgeGrabBlock, [
      'function St(e,t){beginLedgeGrab(q,e,t,O,K,j,A,(clip,options)=>y.play(clip,options),J)}',
      'function Ct(){alignToLedge(q,O,K,j,A)}',
      'function wt(){return detectLedgeGrab(q,C.values(),O,j,A,Pe()?k.assistReach:1,St)}',
    ].join(''))
    .replace(ledgeHangBlock, [
      'function kt(e){updateLedgeHang(q,m,e,ye,{drop:Dt,align:Ct,leapBack:Et,leapSide:Tt,climbOrLeap:Ot,shimmy:At,changeState:J})}',
      'function At(e,t){shimmyAlongLedge(q,t,e,p.get(`camera_rig.rail`)?.railYaw??0,k.shimmyRate,Ct,J)}',
      'function jt(){completeLedgeClimb(q,K,y,v,{forwardOffset:N,heightGain:M,surface:Y},J)}',
    ].join(''))
    .replace(lowMantleBlock, [
      'function pt(e=1){return probeLowMantle(q,v,e)}',
      'function mt(){return probeWallMantle(q,E,v,ht)}',
      'function ht(e){beginLowMantle(q,e,F,(clip,options)=>y.play(clip,options),J)}',
      'function gt(){updateLowMantle(q,y,v,P,M,Y,J,it)}',
    ].join('')),
].join('\n');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'sumiro'), join(output, 'sumiro'), { recursive: true });
await cp(join(root, 'src'), join(output, 'src'), { recursive: true });
await writeFile(join(output, 'sumiro/bundle/game-B5zfa1fm.js'), rewritten);
await writeFile(join(output, 'sumiro/bundle/chapters-B8aGs4KP.js'), chapterAdapter);
await writeFile(join(output, 'sumiro/bundle/kit-B01EgPBo.js'), kitRewritten);
await writeFile(join(output, 'sumiro/bundle/collision-DtBQEpmQ.js'), collisionRewritten);
await writeFile(join(output, 'sumiro/bundle/player-1_KrBWnI.js'), playerRewritten);

const report = {
  kind: 'transitional-source-backed-development-build',
  originalGitBlob: EXPECTED_GIT_BLOBS,
  adaptedChunks: [
    'sumiro/bundle/game-B5zfa1fm.js',
    'sumiro/bundle/chapters-B8aGs4KP.js',
    'sumiro/bundle/kit-B01EgPBo.js',
    'sumiro/bundle/collision-DtBQEpmQ.js',
    'sumiro/bundle/player-1_KrBWnI.js',
  ],
  sourceModules: ['src/domain/save.mjs', 'src/domain/chapters.mjs', 'src/domain/scrolls.mjs', 'src/physics/geometry.mjs', 'src/physics/moving-body.mjs', 'src/physics/world.mjs', 'src/player/cinematic-timeline.mjs', 'src/player/ledge-path.mjs', 'src/player/input-steering.mjs', 'src/player/locomotion.mjs', 'src/player/movement-config.mjs', 'src/player/ledge-grab.mjs', 'src/player/ledge-controller.mjs', 'src/player/mantle.mjs'],
  limitations: 'Other chunks still ship as compiled artifacts. Browser/playthrough parity is not yet verified.',
};
await writeFile(join(output, 'reconstruction-build.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Built ' + output + '/sumiro/ with readable chapter and save modules');
