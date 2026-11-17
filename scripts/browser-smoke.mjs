#!/usr/bin/env node
/* Chromium smoke gate for the published and source-backed Sumiro builds.
 * Playwright must be installed in the environment. Do not treat an
 * unbootable reference as evidence that the candidate is equivalent.
 */
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const built = resolve(root, '.local-build-browser');
const build = spawnSync(process.execPath, ['scripts/build-reconstructed-dev.mjs', '--out', built], {
  cwd: root, encoding: 'utf8', timeout: 180000,
});
if (build.status !== 0) throw Error('Development build failed: ' + (build.stderr || build.stdout));

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
async function serve(directory) {
  const rootDir = resolve(directory);
  const server = createServer(async (req, res) => {
    try {
      const raw = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (raw.includes('\0')) throw Error('invalid path');
      const path = raw.endsWith('/') ? raw + 'index.html' : raw;
      const file = resolve(rootDir, '.' + path);
      if (!file.startsWith(rootDir + sep)) throw Error('path escape');
      const info = await stat(file);
      if (!info.isFile()) throw Error('not a file');
      const headers = {
        'Content-Type': mime[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
      };
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        if (start > end || start >= info.size) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + info.size });
          res.end();
          return;
        }
        res.writeHead(206, {
          ...headers, 'Content-Length': end - start + 1,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + info.size,
        });
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port }));
  });
}
const servers = [];
const interaction = process.argv.includes('--interaction');
const sandbox = process.argv.includes('--play');
const gapLeap = process.argv.includes('--gap-leap');
const referenceOnly = process.argv.includes('--reference-only');
if (interaction && sandbox) throw Error('--play and --interaction are mutually exclusive');
if (process.argv.includes('--jump') && !sandbox) throw Error('--jump requires --play');
if (gapLeap && (!sandbox || process.argv.includes('--jump'))) throw Error('--gap-leap requires --play without --jump');
if (referenceOnly && !gapLeap) throw Error('--reference-only requires --gap-leap');
let browser;
async function observe(label, port) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  console.log(label + ': launching page');
  const errors = [];
  const missing = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) missing.push(response.status() + ' ' + new URL(response.url()).pathname);
  });
  try {
    await page.goto('http://127.0.0.1:' + port + '/sumiro/' + (sandbox ? '?play=1' : ''), {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const launched = await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      return !!(canvas && canvas.width > 0 && canvas.height > 0);
    }, null, { timeout: 90000 }).then(() => true, () => false);
    if (!launched) throw Error('No WebGL canvas appeared during initial boot');
    console.log(label + ': canvas initialized, waiting for completed engine boot');
    await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 90000 });
    let titleMenu = null;
    let movementSummary = null;
    if (sandbox) {
      console.log(label + ': boot overlay removed; waiting for sandbox PLAY');
      await page.waitForFunction(() => window.__game?.read?.()?.game === 'PLAY', null, {
        timeout: 60000,
      });
      const before = await page.evaluate(() => window.__game.read());
      if (![before.x, before.y, before.z, before.t].every(Number.isFinite)) {
        throw Error('Sandbox player position or simulation clock is not finite');
      }
      if (gapLeap) {
        console.log(label + ': locating real Chapter One gap-forward leap geometry');
        const prepared = await page.evaluate(() => {
          const engine = window.__engine;
          const game = window.__game;
          const body = engine?.registry?.get('player.body');
          const level = game?.level;
          const leap = level?.leapLinks?.find(link => link.id === 'gap_forward');
          const ledge = level?.ledges?.find(item => item.id === leap?.to?.ledge);
          if (!body?.teleport || !body.c || !leap?.from?.poly || !ledge?.points) {
            throw Error('Missing published player/level leap instrumentation');
          }
          const polygon = leap.from.poly;
          const minX = Math.min(...polygon.map(point => point[0]));
          const maxX = Math.max(...polygon.map(point => point[0]));
          const minZ = Math.min(...polygon.map(point => point[1]));
          const maxZ = Math.max(...polygon.map(point => point[1]));
          const inside = (x,z) => {
            let result = false;
            for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
              const [xi,zi] = polygon[i], [xj,zj] = polygon[j];
              if((zi>z)!==(zj>z) && x<((xj-xi)*(z-zi))/(zj-zi)+xi) result=!result;
            }
            return result;
          };
          // The source level specifies rim position in the sampled point
          // index domain, independent from the engine's runtime arc length.
          const from = ledge.rimFrom ?? 0;
          const step = ledge.rimStep ?? 1;
          const firstIndex = Math.max(0,Math.round((leap.to.sFrom-from)/step));
          const lastIndex = Math.min(ledge.points.length-1,
            Math.round((leap.to.sTo-from)/step));
          const candidates = [];
          const groundExamples=[];
          for(let xi=0;xi<=24;xi++) for(let zi=0;zi<=24;zi++) {
            const x=minX+(maxX-minX)*(xi+.5)/25;
            const z=minZ+(maxZ-minZ)*(zi+.5)/25;
            if(!inside(x,z))continue;
            const ground=game.world.groundAt(x,z);
            if (groundExamples.length < 8) groundExamples.push([x,z,ground?.y??null]);
            if(!ground || ground.y < (leap.from.yMin ?? -Infinity) + .08)continue;
            for(let index=firstIndex;index<=lastIndex;index++) {
              const point=ledge.points[index];
              if(!point)continue;
              const dx=point[0]-x,dz=point[2]-z;
              const length=Math.hypot(dx,dz);
              if(length<.2)continue;
              candidates.push({x,z,y:ground.y,
                directionX:dx/length,directionZ:dz/length,
                distance:length,pointIndex:index});
            }
          }
          candidates.sort((a,b)=>a.distance-b.distance);
          if(!candidates.length) return {
            found:false,poly:polygon,groundExamples,rim:{from,step,firstIndex,lastIndex},
          };
          const chosen=candidates[Math.floor(candidates.length*.25)];
          body.script={x:chosen.directionX,z:chosen.directionZ,mag:1};
          body.teleport(chosen.x,chosen.z,{
            y:chosen.y,
            heading:Math.atan2(-chosen.directionX,-chosen.directionZ),
          });
          body.c.recentSpeed=8;
          return {found:true,chosen,count:candidates.length,groundExamples,
            level:level.id,link:leap.id};
        });
        console.log(label + ': authored leap setup ' + JSON.stringify(prepared));
        if(!prepared.found) throw Error('No ground-supported candidate in published gap-forward source polygon');
        await page.waitForFunction(() => {
          const body=window.__engine?.registry?.get('player.body');
          if(body)body.c.recentSpeed=Math.max(body.c.recentSpeed,8);
          return window.__game?.read?.()?.leapReady === 'gap_forward';
        },null,{timeout:45000});
        console.log(label + ': authored gap-forward link available; injecting buffered jump');
        await page.evaluate(() => {
          const body=window.__engine.registry.get('player.body');
          window.__gapTrace=[];
          let frames=0;
          const capture=()=>{
            const now=window.__game?.read?.();
            if(now)window.__gapTrace.push({
              state:now.state,t:now.t,ledge:now.ledge,
              leapReady:now.leapReady,grounded:now.grounded,
              x:now.x,y:now.y,z:now.z,
            });
            if(++frames<900)requestAnimationFrame(capture);
          };
          requestAnimationFrame(capture);
          body.c.jumpBuf=.3;
        });
        await page.waitForFunction(() =>
          window.__gapTrace?.some(item => item.state === 'LEAP'),
        null,{timeout:60000});
        console.log(label + ': authored LEAP observed, awaiting rim GRAB');
        await page.waitForFunction(() =>
          window.__gapTrace?.some(item =>
            ['GRAB','HANG','SHIMMY','CLIMB'].includes(item.state) &&
            item.ledge === 'rim_front'),
        null,{timeout:120000});
        // Preserve the source input contract: the scripted vector is only for
        // positioning/aim; W is the actual climb command in hanging states.
        await page.evaluate(() => {
          window.__engine.registry.get('player.body').script=null;
        });
        await page.keyboard.down('w');
        try {
          await page.waitForFunction(() =>
            window.__gapTrace?.some(item => item.state === 'CLIMB'),
          null,{timeout:90000});
        } finally {
          await page.keyboard.up('w');
        }
        const trace=await page.evaluate(() => window.__gapTrace ?? []);
        const states=[...new Set(trace.map(item=>item.state))];
        const after=await page.evaluate(() => window.__game.read());
        movementSummary={
          game:after.game,level:after.level,finite:
            [after.x,after.y,after.z,after.t].every(Number.isFinite),
          authoredLeap:{
            link:'gap_forward',
            initial:prepared.chosen,
            states,
            reachedRim:trace.some(item=>item.ledge==='rim_front'),
            enteredClimb:trace.some(item=>item.state==='CLIMB'),
            completedClimb:trace.some((item,index)=>
              item.state==='IDLE' && item.grounded &&
              trace.slice(0,index).some(earlier=>earlier.state==='CLIMB')),
            finalState:after.state,
          },
        };
        if(!movementSummary.finite || !movementSummary.authoredLeap.enteredClimb ||
            !movementSummary.authoredLeap.reachedRim || movementSummary.game !== 'PLAY') {
          throw Error('Real authored leap did not reach the rim and enter CLIMB');
        }
        console.log(label + ': authored leap and climb ' + JSON.stringify(movementSummary));
      } else {
      console.log(label + ': PLAY ready; pressing W to test actual locomotion');
      await page.keyboard.down('w');
      try {
        await page.waitForFunction(initial => {
          const now = window.__game?.read?.();
          return !!now && now.game === 'PLAY' &&
            now.t > initial.t + .10 &&
            Math.hypot(now.x - initial.x, now.z - initial.z) > .04;
        }, {x:before.x,z:before.z,t:before.t}, {timeout:60000});
      } finally {
        await page.keyboard.up('w');
      }
      const after = await page.evaluate(() => window.__game.read());
      movementSummary = {
        game: after.game,
        level: after.level,
        moved: Math.hypot(after.x-before.x, after.z-before.z),
        simulatedSeconds: after.t-before.t,
        initialState: before.state,
        finalState: after.state,
        finite: [after.x,after.y,after.z,after.t,after.heading,after.speed].every(Number.isFinite),
      };
      if (!movementSummary.finite || movementSummary.moved <= .04 ||
          movementSummary.simulatedSeconds <= .10 || movementSummary.game !== 'PLAY') {
        throw Error('Sandbox locomotion did not produce valid forward movement');
      }
      if (process.argv.includes('--jump')) {
        // A separate frame-sampled trace avoids missing short transient states
        // under slow software-rendered WebGL.
        await page.waitForFunction(() => window.__game?.read?.()?.grounded === true, null,
          {timeout:60000});
        const jumpStart = await page.evaluate(() => window.__game.read());
        await page.evaluate(() => {
          window.__jumpTrace = [];
          let frames = 0;
          const capture = () => {
            const now = window.__game?.read?.();
            if (now) window.__jumpTrace.push({
              state: now.state, y: now.y, grounded: now.grounded, t: now.t,
            });
            if (++frames < 1500) requestAnimationFrame(capture);
          };
          requestAnimationFrame(capture);
        });
        console.log(label + ': pressing Space to verify jump impulse');
        await page.keyboard.down('Space');
        try {
          await page.waitForFunction(initial =>
            window.__jumpTrace?.some(sample =>
              sample.state === 'JUMP' && sample.y > initial.y + .05),
          {y:jumpStart.y}, {timeout:90000});
        } finally {
          await page.keyboard.up('Space');
        }
        console.log(label + ': upward jump confirmed; awaiting ground contact');
        await page.waitForFunction(initial => {
          const now = window.__game?.read?.();
          return !!now && now.game === 'PLAY' && now.grounded &&
            now.t > initial.t + .40;
        }, {t:jumpStart.t}, {timeout:140000});
        const landed = await page.evaluate(() => window.__game.read());
        const trace = await page.evaluate(() => window.__jumpTrace ?? []);
        const peakHeight = Math.max(...trace.map(sample => sample.y));
        movementSummary.jump = {
          upwardMotion: peakHeight - jumpStart.y,
          landed: landed.grounded,
          finite: [landed.x, landed.y, landed.z, landed.t, peakHeight].every(Number.isFinite),
          game: landed.game,
          level: landed.level,
        };
        if (!movementSummary.jump.landed || !movementSummary.jump.finite ||
            movementSummary.jump.upwardMotion < .05 ||
            movementSummary.jump.game !== 'PLAY') {
          throw Error('Sandbox jump failed to return to valid gameplay/ground state');
        }
      }
      }

    } else {
      console.log(label + ': boot overlay removed; checking title menu');
      await page.locator('#ink-ui .menu.on h1').waitFor({ state: 'visible', timeout: 15000 });
      titleMenu = await page.locator('#ink-ui .menu.on h1').textContent();
      if (titleMenu?.trim() !== 'Sumiro') throw Error('Unexpected title screen: ' + titleMenu);
    }
    let saveSummary = null;
    if (interaction) {
    console.log(label + ': clicking New Game');
    await page.locator('#ink-ui .menu.on li').filter({ hasText: /^New Game$/ }).click();
    console.log(label + ': waiting for persisted save');
    await page.waitForFunction(() => {
      const save = localStorage.getItem('sumiro.save.v1');
      if (!save) return false;
      try {
        const run = JSON.parse(save);
        return run.v === 1 && run.started === true
          && run.chapter === 'ch1_climb' && run.unlocked?.includes('ch1_climb');
      } catch {
        return false;
      }
    }, null, { timeout: 45000 });
    console.log(label + ': save persisted, waiting for PLAY state');
    await page.waitForFunction(() => {
      return window.__engine?.registry?.get('game.state') === 'PLAY';
    }, null, { timeout: 45000 });
    console.log(label + ': PLAY state confirmed');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sumiro.save.v1')));
    saveSummary = {
      version: saved.v, chapter: saved.chapter, unlocked: saved.unlocked,
      started: saved.started, music: saved.options?.music,
    };
    }
    const state = await page.evaluate(() => ({
      title: document.title,
      canvasCount: document.querySelectorAll('canvas').length,
      bootVisible: !!document.querySelector('#boot') &&
        getComputedStyle(document.querySelector('#boot')).display !== 'none',
    }));
    const result = { label, launched, ...state, titleMenu, saveSummary, movementSummary, errors: errors.slice(0, 12), missing: missing.slice(0, 12) };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } catch (error) {
    console.error(label + ': FAILED: ' + error.message);
    console.error(label + ': errors=' + JSON.stringify(errors));
    console.error(label + ': missing=' + JSON.stringify(missing));
    if (sandbox) console.error(label + ': recent jump samples=' + JSON.stringify(await page.evaluate(() => window.__jumpTrace?.slice(-12) ?? []).catch(() => [])));
    if (gapLeap) console.error(label + ': authored gap trace=' + JSON.stringify(await page.evaluate(() => window.__gapTrace?.slice(-20) ?? []).catch(() => [])));
    console.error(label + ': diagnostic=' + JSON.stringify(await page.evaluate(() => ({
      title: document.title,
      engineExists: !!window.__engine,
      state: window.__engine?.registry?.get('game.state') ?? null,
      menu: document.querySelector('#ink-ui .menu.on')?.innerText?.slice(0, 200) ?? null,
      savePresent: !!localStorage.getItem('sumiro.save.v1'),
    })).catch(() => null)));
    throw error;
  } finally {
    await context.close();
  }
}
try {
  servers.push(await serve(root));
  servers.push(await serve(built));
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const original = await observe('published-reference', servers[0].port);
  const candidate = referenceOnly ? null : await observe('source-backed-development', servers[1].port);
  if (!original.launched || original.errors.length || original.missing.length) {
    throw Error('Published baseline failed browser gate; cannot assert parity with a broken reference');
  }
  if (!referenceOnly && (!candidate.launched || candidate.errors.length || candidate.missing.length)) {
    throw Error('Source-backed build failed browser boot or asset resolution gate');
  }
  if (!referenceOnly && candidate.title !== original.title) throw Error('Document title mismatch');
  if (sandbox && !referenceOnly) {
    if (!original.movementSummary || !candidate.movementSummary ||
        original.movementSummary.level !== candidate.movementSummary.level ||
        original.movementSummary.game !== candidate.movementSummary.game ||
        !original.movementSummary.finite || !candidate.movementSummary.finite ||
        (gapLeap && (!original.movementSummary.authoredLeap?.enteredClimb ||
          !candidate.movementSummary.authoredLeap?.enteredClimb ||
          !original.movementSummary.authoredLeap?.reachedRim ||
          !candidate.movementSummary.authoredLeap?.reachedRim ||
          original.movementSummary.authoredLeap.link !== candidate.movementSummary.authoredLeap.link)) ||
        (process.argv.includes('--jump') &&
          (!original.movementSummary.jump?.landed || !candidate.movementSummary.jump?.landed ||
           original.movementSummary.jump.level !== candidate.movementSummary.jump.level))) {
      throw Error('Published and source-backed PLAY state or movement baseline differ');
    }
  }
  if (original.bootVisible || (!referenceOnly && candidate.bootVisible)) throw Error('Boot overlay did not disappear');
  if (!referenceOnly && original.canvasCount !== candidate.canvasCount) throw Error('Canvas count mismatch');
  if (interaction && !referenceOnly && JSON.stringify(original.saveSummary) !== JSON.stringify(candidate.saveSummary)) {
    throw Error('New-game saved state differs between original and source-backed builds');
  }
  process.stdout.write(gapLeap
    ? (referenceOnly ? 'Published reference reached authored gap LEAP, rim GRAB and CLIMB entry.\n' : 'Both builds reached authored gap LEAP, rim GRAB and CLIMB entry.\n')
    : sandbox
    ? (process.argv.includes('--jump')
        ? 'Both builds entered PLAY, moved and completed a jump/ground contact with finite player states.\n'
        : 'Both builds entered sandbox PLAY and demonstrated keyboard locomotion with finite player states.\n')
    : interaction ? 'Both builds booted, entered PLAY, and persisted matching saves.\n'
    : 'Both builds completed boot to the title menu without errors.\n');
} finally {
  await browser?.close();
  await Promise.all(servers.map(({ server }) => new Promise((done) => server.close(done))));
}
