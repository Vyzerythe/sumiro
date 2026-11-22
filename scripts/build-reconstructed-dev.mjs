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
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileReconstructedSource } from './compile-reconstructed-source.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const outArg = process.argv.indexOf('--out');
const output = resolve(root, outArg >= 0 ? process.argv[outArg + 1] ?? '' : '.local-build');
if (outArg >= 0 && !process.argv[outArg + 1]) throw Error('--out requires a directory');
// Only direct, untracked scratch directories are disposable. Never accept a
// tracked path, a nested path under sumiro/src, or an ancestor of the repo.
if (dirname(output) !== root || !/^\.local-build(?:-[a-z0-9-]+)?$/.test(basename(output))) {
  throw Error('Output must be a root-level .local-build[-name] scratch directory');
}

const originalGame = join(root, 'sumiro/bundle/game-B5zfa1fm.js');
const originalChapters = join(root, 'sumiro/bundle/chapters-B8aGs4KP.js');
const originalKit = join(root, 'sumiro/bundle/kit-B01EgPBo.js');
const originalCollision = join(root, 'sumiro/bundle/collision-DtBQEpmQ.js');
const originalPlayer = join(root, 'sumiro/bundle/player-1_KrBWnI.js');
const originalTrail = join(root, 'sumiro/bundle/trail-BFIL-IHB.js');
const originalRenderer = join(root, 'sumiro/bundle/render_pipeline-BTCk4Dyc.js');
const originalSight = join(root, 'sumiro/bundle/sight-DXR0ElmN.js');
const originalEntry = join(root, 'sumiro/bundle/index-DnHRwVtn.js');
const EXPECTED_GIT_BLOBS = {
  game: '284349f2f8d0235e163f3c9b88b17ed222e3b269',
  chapters: '3da4e0f31fed783d0e548dd40fd0c1113cca16ec',
  kit: 'd92a7b85baceb33cf9c7243a27fbfea98fa5436d',
  collision: 'bb06154a9be5a24421a017f4c84adf7c87064d1b',
  player: '2ba1dbb18011510e025d5f3af06b045f143a3d10',
  trail: '950ee6272e85d1c446a2de97ce0df4930c6d3145',
  renderer: 'e6b0a92ac434dbae6f6ffa8227b2f09d539a594d',
  sight: '278874e5ee81a87b366e63cd9c37d05b24448556',
  entry: 'ebb0f16331c5186608eba202d2991a8cef5ccda6',
};
const sha = data => createHash('sha1')
  .update('blob ' + Buffer.byteLength(data) + '\0')
  .update(data).digest('hex');
const game = await readFile(originalGame);
const chapters = await readFile(originalChapters);
const kit = await readFile(originalKit);
const collision = await readFile(originalCollision);
const player = await readFile(originalPlayer);
const trail = await readFile(originalTrail);
const renderer = await readFile(originalRenderer);
const sight = await readFile(originalSight);
const entry = await readFile(originalEntry);
for (const [name, bundle] of Object.entries({ game, chapters, kit, collision, player, trail, renderer, sight, entry })) {
  if (sha(bundle) === EXPECTED_GIT_BLOBS[name]) continue;
  throw Error('Published ' + name + ' bundle has changed: audit integration boundaries before rebuilding');
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
const leapLifecycleBlock = /function st\(e\)\{[\s\S]*?\}(?=function pt\(e=1\)\{)/;
const groundMotionBlock = /function ze\(e\)\{[\s\S]*?\}(?=function Be\(\)\{)/;
const airMotionBlock = /function vt\(e\)\{[\s\S]*?\}(?=function yt\(\)\{)/;
const landingBlock = /function bt\(e\)\{[\s\S]*?\}(?=function xt\(e\)\{)/;
const headingFunction = /function U\(e,t\)\{[\s\S]*?\}(?=var Me=)/;
const timelineFunctions = /function Ve\(e\)\{[\s\S]*?\}(?=var Ge=)/;
if (!headingFunction.test(playerText) || !timelineFunctions.test(playerText) || !ledgeFactory.test(playerText) || !steeringFunction.test(playerText) || !gaitFunction.test(playerText) || !directionFunction.test(playerText) || !jumpFunction.test(playerText) || !fallFunction.test(playerText) || !ledgeGrabBlock.test(playerText) || !ledgeHangBlock.test(playerText) || !lowMantleBlock.test(playerText) || !leapLifecycleBlock.test(playerText) || !groundMotionBlock.test(playerText) || !airMotionBlock.test(playerText) || !landingBlock.test(playerText)) {
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
  "import { resolveLeapRim, resolveLeapTarget, findLeapLink, beginLeap, advanceLeap, abortLeap } from '../../src/player/leap.mjs';",
  "import { stepGroundContact, stepAirborne, finishLanding } from '../../src/player/motion-physics.mjs';",
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
    ].join(''))
    .replace(leapLifecycleBlock, [
      'function st(e){ot();return resolveLeapTarget(q,e,C,v,U,O,j,A)}',
      'function $(e,t){return resolveLeapRim(e,t)}',
      'function ct(){ot();return findLeapLink(q,f,C,v,U,O,st,c)}',
      'function lt(){let e=ct();return e&&ut(e.link,e.t),!!e}',
      'function ut(e,t){beginLeap(q,K,e,t,k,{lockHeading:Re,play:(name,opts)=>y.play(name,opts),duration:name=>y.duration(name),footstep:qt,changeState:J})}',
      'function dt(e){advanceLeap(q,K,e,k,{finished:()=>y.finished(),play:(name,opts)=>y.play(name,opts),duration:name=>y.duration(name),scratch:O,ledgeOffset:j,hangingHeight:A,collisionUntil:Oe,world:v,capsule:De,collision:E,abort:ft,top:()=>y.top(),grab:St,land:bt})}',
      'function ft(){abortLeap(q,K,k,{collision:E,deflect:Ue,play:(name,opts)=>y.play(name,opts),changeState:J})}',
    ].join(''))
    .replace(groundMotionBlock,
      'function ze(e){return stepGroundContact(q,e,k,{world:v,collision:E,bodyCapsule:G,probeOffset:ke,hasSupport:We,hasSafeDrop:Ge,hasHigherGround:Ke,estimateNormal:X,deflect:Ue,surfaceName:Y})}')
    .replace(airMotionBlock,
      'function vt(e){stepAirborne(q,e,k,{jumpHeld:m.jumpHeld,collision:E,world:v,guardedCapsule:Ee,normalCapsule:Te,deflect:Ue,groundTolerance:L,play:(name,opts)=>y.play(name,opts),changeState:J,grabLedge:wt,land:bt,tryWallMantle:mt,probeMantle:pt,beginMantle:ht,updateFall:yt,surfaceName:Y})}')
    .replace(landingBlock,
      'function bt(e){finishLanding(q,e,k,{world:v,shake:Ie,sound:name=>p.set(`audio.cue`,{name}),hurt:Ht,isDead:Fe,die:Bt,play:(name,opts)=>y.play(name,opts),footstep:qt,changeState:J,consumeBufferedJump:_t})}'),
].join('\n');

const trailAdapter = [
  'export { findWalkableSegment as a, trailGroundAt as i, trailHeightTolerance as n,',
  "  createMovementTrail as r, trailCapsule as t } from '../../src/player/movement-trail.mjs';",
  '',
].join('\n');
const sightAdapter = [
  'export { createMeshRaycaster as a, hasLineOfSight as i, relaxLongEdgesInPlace as n,',
  "  raycastVisibleSurface as r, filterTrianglesByMaxEdge as t } from '../../src/physics/sight.mjs';",
  '',
].join('\n');

let rendererRewritten = renderer.toString('utf8');
for (const [boundary, replacement] of [
  [/_ssFull\(e\)\{[^}]+\}/g, '_ssFull(view){return capRenderScale(view.drawHeight,C.render.ss,O)}'],
  [/_ssFor\(e\)\{[^}]+\}/g, '_ssFor(view){return this.ssFixed||selectAdaptiveRenderScale(view,this.pixelCap,this._ssFull(view),A[A.length-1])}'],
  [/setSize\(e\)\{this\.ss=this\._ssFor\(e\);[^}]+\}/g, [
    'setSize(view){',
    'this.ss=this._ssFor(view);',
    'const {width,height,keyWidth,keyHeight,effectiveScale,pixelScale}=measureRenderTargets(view,this.ss,k);',
    'this.gbuf.setSize(width,height);this.depthCopy.setSize(width,height);this.keyMap.setSize(keyWidth,keyHeight);',
    'this.lineMask.setSize(width,height);this.post.setSize(width,height);E.uRes.value.set(width,height);',
    'E.uPxScale.value=pixelScale;this.gradeMaterial.uniforms.uSS.value=effectiveScale;',
    'this.compositeMaterial.uniforms.uSS.value=effectiveScale;}',
  ].join('')],
]) {
  if ([...rendererRewritten.matchAll(boundary)].length !== 1) {
    throw Error('Published renderer resolution boundary changed: re-audit ' + boundary);
  }
  rendererRewritten = rendererRewritten.replace(boundary, replacement);
}
rendererRewritten = "import { capRenderScale, measureRenderTargets, selectAdaptiveRenderScale } from '../../src/rendering/frame-resolution.mjs';\n"
  + rendererRewritten;

const entryText = entry.toString('utf8');
const hostBegin = entryText.indexOf('var uv=e=>');
const hostEnd = entryText.indexOf(',gv=2.5', hostBegin);
const hostConstructor = 'new hv(t)';
if (hostBegin < 0 || hostEnd <= hostBegin || entryText.split(hostConstructor).length !== 2) {
  throw Error('Published system host boundary changed: re-audit');
}
let entryRewritten = entryText.slice(0, hostBegin) + 'var ' + entryText.slice(hostEnd + 1);
const utilityBegin = entryRewritten.indexOf('mg=class{constructor(e){this.hz');
const utilityEnd = entryRewritten.indexOf(',_g=', utilityBegin);
if (utilityBegin < 0 || utilityEnd <= utilityBegin) {
  throw Error('Published simulation clock and registry boundary changed: re-audit');
}
entryRewritten = entryRewritten.slice(0, utilityBegin) + entryRewritten.slice(utilityEnd + 1);
const optionsBegin = entryRewritten.indexOf('function Yh(e,t)');
const optionsEnd = entryRewritten.indexOf('function rg(e)', optionsBegin);
if (optionsBegin < 0 || optionsEnd <= optionsBegin) throw Error('Published launch options boundary changed: re-audit');
entryRewritten = entryRewritten.slice(0, optionsBegin)
  + 'const launchOptions=parseLaunchOptions(window.location.search),tg=launchOptions.options;'
  + 'function ng(){for(const diagnostic of launchOptions.diagnostics)console.error("[engine] "+diagnostic)}'
  + entryRewritten.slice(optionsEnd);
const inputBegin = entryRewritten.indexOf(',Vg=.15,Hg=');
const inputEnd = entryRewritten.indexOf(';function Jg(e,t=!1)', inputBegin);
if (inputBegin < 0 || inputEnd <= inputBegin) throw Error('Published input manager boundary changed: re-audit');
entryRewritten = entryRewritten.slice(0, inputBegin) + entryRewritten.slice(inputEnd);
const loopBegin = entryRewritten.indexOf('runLive(){let{ctx:e}=this');
const loopEnd = entryRewritten.indexOf('}_perfWarn(', loopBegin);
if (loopBegin < 0 || loopEnd <= loopBegin) throw Error('Published live frame loop boundary changed: re-audit');
const liveLoopAdapter = [
  'runLive(){if(this.liveLoop)return;const{ctx}=this;ctx.smooth(ctx.camera);',
  'this.liveLoop=startLiveLoop({fixedDt:ctx.time.fixedDt,maxFrameDt:fg.maxFrameDt,',
  'maxStepsPerFrame:fg.maxStepsPerFrame,isPaused:()=>ctx.paused,canSubmitFrame:()=>!this._gpuBehind(),',
  'beforeStep:()=>this._keepPrevious(),step:()=>this.step(),render:alpha=>this._renderBetween(alpha),',
  'afterRender:timestamp=>{this._fenceFrame();if(tg.perf)this._perfWarn(timestamp)}})}',
].join('');
entryRewritten = entryRewritten.slice(0, loopBegin) + liveLoopAdapter + entryRewritten.slice(loopEnd + 1);
for (const [boundary, replacement] of [
  [hostConstructor, 'createSystemHost(t,{defaultBudgetMs:fg.systemMs,initializeTimeoutMs:fg.systemInitTimeoutMs,'
    + 'now:()=>og.now(),markInitialize:name=>dg("init:"+name)})'],
  ['new mg(tg.hz>0?tg.hz:pg.fixedHz)', 'new FixedStepClock(tg.hz>0?tg.hz:pg.fixedHz,pg.videoFps)'],
  ['clock:new hg(e)', 'clock:new SimulationTimeReader(e)'],
  ['registry:new gg,', 'registry:new RuntimeRegistry(),'],
  ['t._advance(),ug(t.t)', 't.advance(),ug(t.t)'],
  ['this.pausedFrame=!1,this.fences=[]', 'this.fences=[]'],
  ['wv(t),r.pausedFrame=!1', 'wv(t),r.liveLoop?.invalidate()'],
  ['()=>{n.dispose(),t.input.dispose(),t.assets.dispose()}', '()=>{r.liveLoop?.stop();n.dispose();t.input.dispose();t.assets.dispose()}'],
  ['new qg({scripted:tg.capture||tg.autorun})', 'createInputManager({keyboardTarget:window,pointerTarget:window,'
    + 'blurTarget:window,getGamepads:()=>{try{return navigator.getGamepads?.()}catch{return[]}},'
    + '...((tg.capture||tg.autorun)?{scriptedRoute:Bg}:{})})'],
  ['e._beginStep(0),this.host.update(0),e._endStep(),this._syncBeat(),t.dt=t.fixedDt',
    'e.beginStep(0);try{this.host.update(0)}finally{e.endStep()}this._syncBeat();t.dt=t.fixedDt'],
  ['n._beginStep(t.t,t.fixedDt),this.host.update(t.fixedDt,!0),n._endStep();return',
    'n.beginStep(t.t,t.fixedDt);try{this.host.update(t.fixedDt,!0)}finally{n.endStep()}return'],
  ['n._beginStep(t.t,t.fixedDt);let r=og.now();this.host.update(t.fixedDt),this.lastStepMs=og.now()-r,n._endStep(),this._syncBeat()',
    'n.beginStep(t.t,t.fixedDt);const start=og.now();'
    + 'try{this.host.update(t.fixedDt);this.lastStepMs=og.now()-start}finally{n.endStep()}this._syncBeat()'],
]) {
  if (entryRewritten.split(boundary).length !== 2) throw Error('Published entry boundary changed: ' + boundary);
  entryRewritten = entryRewritten.replace(boundary, replacement);
}
entryRewritten = "import { createSystemHost } from '../../src/runtime/system-host.mjs';\n"
  + "import { FixedStepClock, SimulationTimeReader } from '../../src/runtime/fixed-step-clock.mjs';\n"
  + "import { RuntimeRegistry } from '../../src/runtime/registry.mjs';\n"
  + "import { startLiveLoop } from '../../src/runtime/live-loop.mjs';\n"
  + "import { parseLaunchOptions } from '../../src/runtime/launch-options.mjs';\n"
  + "import { createInputManager } from '../../src/input/input-manager.mjs';\n"
  + entryRewritten;
const compiledSource = compileReconstructedSource(root, join(output, 'src'));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'sumiro'), join(output, 'sumiro'), { recursive: true });
for (const [path, contents] of compiledSource) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
await writeFile(join(output, 'sumiro/bundle/game-B5zfa1fm.js'), rewritten);
await writeFile(join(output, 'sumiro/bundle/chapters-B8aGs4KP.js'), chapterAdapter);
await writeFile(join(output, 'sumiro/bundle/kit-B01EgPBo.js'), kitRewritten);
await writeFile(join(output, 'sumiro/bundle/collision-DtBQEpmQ.js'), collisionRewritten);
await writeFile(join(output, 'sumiro/bundle/player-1_KrBWnI.js'), playerRewritten);
await writeFile(join(output, 'sumiro/bundle/trail-BFIL-IHB.js'), trailAdapter);
await writeFile(join(output, 'sumiro/bundle/render_pipeline-BTCk4Dyc.js'), rendererRewritten);
await writeFile(join(output, 'sumiro/bundle/sight-DXR0ElmN.js'), sightAdapter);
await writeFile(join(output, 'sumiro/bundle/index-DnHRwVtn.js'), entryRewritten);

const report = {
  kind: 'transitional-source-backed-development-build',
  originalGitBlob: EXPECTED_GIT_BLOBS,
  adaptedChunks: [
    'sumiro/bundle/game-B5zfa1fm.js',
    'sumiro/bundle/chapters-B8aGs4KP.js',
    'sumiro/bundle/kit-B01EgPBo.js',
    'sumiro/bundle/collision-DtBQEpmQ.js',
    'sumiro/bundle/player-1_KrBWnI.js',
    'sumiro/bundle/trail-BFIL-IHB.js',
    'sumiro/bundle/render_pipeline-BTCk4Dyc.js',
    'sumiro/bundle/sight-DXR0ElmN.js',
    'sumiro/bundle/index-DnHRwVtn.js',
  ],
  sourceModules: [
    'src/domain/save.mts',
    'src/domain/chapters.mts',
    'src/domain/scrolls.mjs',
    'src/input/input-manager.mts',
    'src/physics/geometry.mts',
    'src/physics/moving-body.mts',
    'src/physics/world.mjs',
    'src/physics/sight.mts',
    'src/player/cinematic-timeline.mjs',
    'src/player/ledge-path.mjs',
    'src/player/input-steering.mjs',
    'src/player/locomotion.mjs',
    'src/player/movement-config.mjs',
    'src/player/ledge-grab.mjs',
    'src/player/ledge-controller.mjs',
    'src/player/mantle.mjs',
    'src/player/leap.mjs',
    'src/player/motion-physics.mjs',
    'src/player/movement-trail.mts',
    'src/rendering/frame-resolution.mts',
    'src/runtime/fixed-step-clock.mts',
    'src/runtime/frame-scheduler.mts',
    'src/runtime/launch-options.mts',
    'src/runtime/live-loop.mts',
    'src/runtime/registry.mts',
    'src/runtime/system-host.mts',
  ],
  limitations: 'Other chunks still ship as compiled artifacts. Browser/playthrough parity is not yet verified.',
};
await writeFile(join(output, 'reconstruction-build.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Built ' + join(output, 'sumiro') + ' with ' + report.sourceModules.length + ' recovered source modules');
