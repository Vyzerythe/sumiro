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
let browser;
async function observe(label, port) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  const missing = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) missing.push(response.status() + ' ' + new URL(response.url()).pathname);
  });
  try {
    await page.goto('http://127.0.0.1:' + port + '/sumiro/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const launched = await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      return !!(canvas && canvas.width > 0 && canvas.height > 0);
    }, null, { timeout: 90000 }).then(() => true, () => false);
    await page.waitForTimeout(2000);
    await page.locator('#ink-ui .menu.on h1').waitFor({ state: 'visible', timeout: 20000 });
    const titleMenu = await page.locator('#ink-ui .menu.on h1').textContent();
    if (titleMenu?.trim() !== 'Sumiro') throw Error('Unexpected title screen: ' + titleMenu);
    await page.locator('#ink-ui .menu.on li').filter({ hasText: /^New Game$/ }).click();
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
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      return window.__engine?.registry?.get('game.state') === 'PLAY';
    }, null, { timeout: 90000 });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sumiro.save.v1')));
    const saveSummary = {
      version: saved.v, chapter: saved.chapter, unlocked: saved.unlocked,
      started: saved.started, music: saved.options?.music,
    };
    const state = await page.evaluate(() => ({
      title: document.title,
      canvasCount: document.querySelectorAll('canvas').length,
      bootVisible: !!document.querySelector('#boot') &&
        getComputedStyle(document.querySelector('#boot')).display !== 'none',
    }));
    const result = { label, launched, ...state, titleMenu, saveSummary, errors: errors.slice(0, 12), missing: missing.slice(0, 12) };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
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
  const candidate = await observe('source-backed-development', servers[1].port);
  if (!original.launched || original.errors.length || original.missing.length) {
    throw Error('Published baseline failed browser gate; cannot assert parity with a broken reference');
  }
  if (!candidate.launched || candidate.errors.length || candidate.missing.length) {
    throw Error('Source-backed build failed browser boot or asset resolution gate');
  }
  if (candidate.title !== original.title) throw Error('Document title mismatch');
  if (original.bootVisible || candidate.bootVisible) throw Error('Boot overlay did not disappear');
  if (original.canvasCount !== candidate.canvasCount) throw Error('Canvas count mismatch');
  if (JSON.stringify(original.saveSummary) !== JSON.stringify(candidate.saveSummary)) {
    throw Error('New-game saved state differs between original and source-backed builds');
  }
  process.stdout.write('Both builds booted, entered PLAY, persisted matching new-game saves, and loaded without errors.\n');
} finally {
  await browser?.close();
  await Promise.all(servers.map(({ server }) => new Promise((done) => server.close(done))));
}
