import { createRunProgress } from '../domain/run-progress.mts';
import { createDefaultRun } from '../domain/save.mts';
import { createChapterPreview } from './chapter-preview.mts';
import { createTraversalPreview } from './traversal-preview.mts';

function element<Kind extends Element>(selector: string): Kind {
  const found = document.querySelector<Kind>(selector);
  if (!found) throw Error(`Missing application element ${selector}`);
  return found;
}

const canvas = element<HTMLCanvasElement>('canvas');
const status = element<HTMLElement>('[role="status"]');
const title = element<HTMLElement>('#title');
const startButton = element<HTMLButtonElement>('#new-run');
const continueButton = element<HTMLButtonElement>('#continue');
const pauseButton = element<HTMLButtonElement>('#pause-button');
const pauseMenu = element<HTMLElement>('#pause-menu');
const resumeButton = element<HTMLButtonElement>('#resume');
const returnButton = element<HTMLButtonElement>('#return-to-title');

function viewport(element: HTMLCanvasElement) {
  return {
    width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight),
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  };
}

const page = new AbortController();
const listen = { signal: page.signal };
const assetBaseURL = new URL('../sumiro/assets/', document.baseURI);
const query = new URLSearchParams(window.location.search);
type Game = Awaited<ReturnType<typeof createTraversalPreview>>;
type Runtime = Game | Awaited<ReturnType<typeof createChapterPreview>>;
let runtime: Runtime | undefined;
let game: Game | undefined;
let stopInterface: (() => void) | undefined;
let starting = false;
let closing: Promise<void> | undefined;

const readProgress = () => createRunProgress({ getItem: key => localStorage.getItem(key) });

function showTitle() {
  continueButton.disabled = !readProgress().hasSave;
  startButton.disabled = false;
  title.hidden = false;
  (continueButton.disabled ? startButton : continueButton).focus();
}

function displayError(error: unknown) {
  status.hidden = false;
  status.textContent = error instanceof Error ? error.message : 'The native session could not start.';
}

function presentGame(current: Game) {
  const controls = 'WASD or arrows to move · Space to jump';
  let prompt = controls;
  let notice: number | undefined;
  status.hidden = false;
  status.textContent = controls;
  pauseButton.hidden = false;
  canvas.focus();
  function showNotice(text: string, duration: number) {
    window.clearTimeout(notice);
    status.textContent = text;
    notice = window.setTimeout(() => { notice = undefined; status.textContent = prompt; }, duration);
  }
  const unsubscribe = current.onInteraction(event => {
    switch (event.type) {
      case 'prompt':
        prompt = event.target?.prompt ?? controls;
        if (notice === undefined) status.textContent = prompt;
        break;
      case 'shrine-rested': showNotice('The lantern is lit.', 3800); break;
      case 'scroll-captured': showNotice(event.lines.join('\n'), 6000); break;
      case 'hint': showNotice(event.text, event.ms); break;
      case 'chapter-exit': showNotice('Chapter One exit reached.', 3800); break;
    }
  });
  const unpause = current.context.registry.on('game.paused', paused => {
    pauseMenu.hidden = !paused;
    pauseButton.hidden = paused;
    if (paused) resumeButton.focus();
    else canvas.focus();
  });
  stopInterface = () => { unsubscribe(); unpause(); window.clearTimeout(notice); };
}

function closeSession() {
  if (closing) return closing;
  const previous = runtime;
  runtime = game = undefined;
  stopInterface?.();
  stopInterface = undefined;
  pauseButton.hidden = pauseMenu.hidden = status.hidden = true;
  closing = Promise.resolve().then(() => previous?.dispose()).finally(() => { closing = undefined; });
  return closing;
}

async function launch(kind: 'new' | 'continue' | 'geometry') {
  if (starting || closing || runtime || page.signal.aborted) return;
  starting = true;
  title.hidden = true;
  status.hidden = false;
  status.textContent = 'Loading chapter…';
  try {
    const options = { canvas, viewport: viewport(canvas), assets: { assetBaseURL } };
    if (kind === 'geometry') {
      const chapter = query.get('chapter');
      runtime = await createChapterPreview({ ...options, ...(chapter ? { chapter } : {}) });
    } else {
      const previous = readProgress();
      const fresh = createDefaultRun(previous.current.options);
      const progress = kind === 'continue' ? previous : createRunProgress({ getItem: () => JSON.stringify(fresh) });
      game = await createTraversalPreview({ ...options, progress,
        input: { keyboardTarget: canvas, pointerTarget: canvas, blurTarget: window, getGamepads: () => navigator.getGamepads() },
        audio: { createContext: () => new AudioContext(), gestureTarget: window, visibilityTarget: document },
      });
      runtime = game;
    }
    if (page.signal.aborted) { await closeSession(); return; }
    runtime.render();
    status.hidden = true;
    if (game) { presentGame(game); game.start(); }
  } catch (error) {
    await closeSession().catch(cleanupError => console.error(cleanupError));
    if (!page.signal.aborted) { showTitle(); displayError(error); }
  } finally {
    starting = false;
  }
}

const observer = new ResizeObserver(() => {
  if (!runtime) return;
  const { width, height, pixelRatio } = viewport(canvas);
  try { runtime.resize(width, height, pixelRatio); runtime.render(); }
  catch (error) { displayError(error); }
});
observer.observe(canvas);
window.addEventListener('pagehide', event => { if (!event.persisted) page.abort(); }, listen);
page.signal.addEventListener('abort', () => {
  observer.disconnect();
  void closeSession().catch(error => console.error(error));
}, { once: true });
startButton.addEventListener('click', () => { void launch('new'); }, listen);
continueButton.addEventListener('click', () => { void launch('continue'); }, listen);
pauseButton.addEventListener('click', () => game?.setPaused(true), listen);
resumeButton.addEventListener('click', () => game?.setPaused(false), listen);
window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && game?.context.paused && event.target !== canvas && !event.repeat) game.setPaused(false);
}, listen);
returnButton.addEventListener('click', () => {
  void closeSession().then(() => { if (!page.signal.aborted) showTitle(); }, displayError);
}, listen);

if (query.get('walk') === '1') void launch(query.get('continue') === '1' ? 'continue' : 'new');
else if (query.has('chapter') || query.get('geometry') === '1') void launch('geometry');
else showTitle();
