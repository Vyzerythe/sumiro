import { createRunProgress } from '../domain/run-progress.mts';
import { createNativeSaveStorage } from '../domain/native-save-storage.mts';
import { createNativePreferencesStorage, type NativePreferences } from '../domain/native-preferences.mts';
import { createDefaultRun, saveKey } from '../domain/save.mts';
import { createChapterPreview } from './chapter-preview.mts';
import { createCredits } from './credits.mts';
import { createCreditsView } from './credits-view.mts';
import { createVitalsView } from './vitals-view.mts';
import { createOptionsView, renderChapterMenu } from './native-menu-pages.mts';
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
const restartButton = element<HTMLButtonElement>('#restart-checkpoint');
const returnButton = element<HTMLButtonElement>('#return-to-title');
const advanceCredits = element<HTMLButtonElement>('#advance-credits');
const vitalsRoot = element<HTMLElement>('#vitals');
const chaptersButton = element<HTMLButtonElement>('#select-chapter');
const chaptersMenu = element<HTMLElement>('#chapters-menu');
const chapterButtons = element<HTMLElement>('#unlocked-chapters');
const optionsMenu = element<HTMLElement>('#options-menu');
const controlsMenu = element<HTMLElement>('#controls-menu');

function viewport(element: HTMLCanvasElement) {
  return {
    width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight),
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  };
}

const page = new AbortController();
const listen = { signal: page.signal };
const assetBaseURL = new URL('../sumiro/assets/', document.baseURI);
const dracoDecoderBaseURL = new URL('../node_modules/three/examples/jsm/libs/draco/gltf/', document.baseURI);
const query = new URLSearchParams(window.location.search);
type Game = Awaited<ReturnType<typeof createTraversalPreview>>;
type Runtime = Game | Awaited<ReturnType<typeof createChapterPreview>>;
let runtime: Runtime | undefined;
let game: Game | undefined;
let activeProgress: ReturnType<typeof createRunProgress> | undefined;
let menuPage: { root: HTMLElement; owner: HTMLElement; trigger: HTMLElement } | undefined;
let shownPreferences: NativePreferences | undefined;
let stopInterface: (() => void) | undefined;
let starting = false;
let closing: Promise<void> | undefined;

const directPreview = query.get('walk') === '1';
const nativeStorage = createNativeSaveStorage(() => localStorage);
const preferences = createNativePreferencesStorage(() => localStorage);
const progressStorage = directPreview ? { getItem: nativeStorage.getItem } : nativeStorage;
const readProgress = () => createRunProgress(progressStorage);
const credits = createCreditsView(element<HTMLElement>('#credits'), advanceCredits, returnToTitle);
const vitals = createVitalsView(vitalsRoot, assetBaseURL);
const showSettings = createOptionsView(element<HTMLElement>('#options-fields'), settings => {
  shownPreferences = settings;
  activeProgress?.setOptions(settings, false);
  game?.context.registry.set('game.options', settings);
}, () => {
  if (!shownPreferences || directPreview) return;
  preferences.write(shownPreferences);
  activeProgress?.save();
});

function showMenuPage(root: HTMLElement, trigger: HTMLElement, initial?: HTMLElement | null) {
  const owner = game ? pauseMenu : title;
  owner.hidden = true;
  root.hidden = false;
  menuPage = { root, owner, trigger };
  (initial ?? root.querySelector<HTMLElement>('button'))?.focus();
}

function closeMenuPage(restore = true) {
  if (!menuPage) return;
  const { root, owner, trigger } = menuPage;
  menuPage = undefined;
  root.hidden = true;
  if (restore) {
    owner.hidden = false;
    trigger.focus();
  }
}

function showTitle() {
  closeMenuPage(false);
  const available = readProgress();
  continueButton.disabled = !available.hasSave;
  chaptersButton.hidden = !available.hasSave || available.current.unlocked.length <= 1;
  startButton.disabled = false;
  title.hidden = false;
  (continueButton.disabled ? startButton : continueButton).focus();
}

function displayError(error: unknown) {
  status.hidden = false;
  status.textContent = error instanceof Error ? error.message : 'The native session could not start.';
}

function presentGame(current: Game, progress: ReturnType<typeof createRunProgress>) {
  const controls = 'WASD or arrows to move · Space to jump';
  let prompt = controls;
  let notice: number | undefined;
  let sceneActive = false;
  let subtitle: string | null = null;
  status.hidden = false;
  status.textContent = controls;
  pauseButton.hidden = false;
  vitalsRoot.hidden = false;
  canvas.focus();
  function refreshStatus() {
    status.textContent = subtitle ?? (sceneActive ? 'Enter or Escape to skip' : prompt);
  }
  function showNotice(text: string, duration: number) {
    if (sceneActive || subtitle) return;
    window.clearTimeout(notice);
    status.textContent = text;
    notice = window.setTimeout(() => { notice = undefined; refreshStatus(); }, duration);
  }
  const unsubscribe = current.onInteraction(event => {
    switch (event.type) {
      case 'prompt':
        prompt = event.target?.prompt ?? controls;
        if (notice === undefined) refreshStatus();
        break;
      case 'shrine-rested': showNotice('The lantern is lit.', 3800); break;
      case 'scroll-captured': showNotice(event.lines.join('\n'), 6000); break;
      case 'hint': showNotice(event.text, event.ms); break;
      case 'chapter-exit': showNotice('Chapter One exit reached.', 3800); break;
    }
  });
  const unpause = current.context.registry.on('game.paused', paused => {
    pauseMenu.hidden = !paused;
    pauseButton.hidden = paused || sceneActive;
    vitalsRoot.hidden = paused || sceneActive;
    status.hidden = paused;
    if (paused) resumeButton.focus();
    else canvas.focus();
  });
  const activeScene = current.context.registry.on('story.scene', scene => {
    sceneActive = Boolean(scene);
    window.clearTimeout(notice);
    notice = undefined;
    pauseButton.hidden = sceneActive || current.context.paused;
    vitalsRoot.hidden = pauseButton.hidden;
    refreshStatus();
  });
  const sceneSubtitle = current.context.registry.on('story.subtitle', line => {
    subtitle = typeof line === 'string' ? line : null;
    refreshStatus();
  });
  const laterPrompt = current.context.registry.on('chapter.prompt', value => {
    if (current.context.registry.get('chapter.current') === 'ch1_climb') return;
    prompt = value ?? controls;
    if (notice === undefined) refreshStatus();
  });
  const completed = current.context.registry.on('game.completed', finished => {
    if (!finished) return;
    vitalsRoot.hidden = pauseButton.hidden = pauseMenu.hidden = status.hidden = true;
    credits.show(createCredits(progress.current));
  });
  const showVitals = current.context.registry.on('game.vitals', vitals.draw);
  const showCompanion = current.context.registry.on('companion.state', vitals.companion);
  stopInterface = () => {
    unsubscribe(); unpause(); activeScene(); sceneSubtitle(); laterPrompt(); completed(); showVitals(); showCompanion();
    window.clearTimeout(notice);
    credits.reset();
  };
}

function closeSession() {
  if (closing) return closing;
  const previous = runtime;
  runtime = game = undefined;
  activeProgress = undefined;
  closeMenuPage(false);
  stopInterface?.();
  stopInterface = undefined;
  vitalsRoot.hidden = pauseButton.hidden = pauseMenu.hidden = status.hidden = true;
  closing = Promise.resolve().then(() => previous?.dispose()).finally(() => { closing = undefined; });
  return closing;
}

function returnToTitle() {
  void closeSession().then(() => { if (!page.signal.aborted) showTitle(); }, displayError);
}

async function launch(kind: 'new' | 'continue' | 'geometry' | 'chapter', chapterId?: string) {
  if (starting || closing || runtime || page.signal.aborted) return;
  starting = true;
  closeMenuPage(false);
  title.hidden = true;
  status.hidden = false;
  status.textContent = 'Loading chapter…';
  let newRun: ReturnType<typeof createRunProgress> | undefined;
  let run: ReturnType<typeof createRunProgress> | undefined;
  try {
    const options = { canvas, viewport: viewport(canvas), assets: { assetBaseURL, dracoDecoderBaseURL } };
    if (kind === 'geometry') {
      const chapter = query.get('chapter');
      runtime = await createChapterPreview({ ...options, ...(chapter ? { chapter } : {}) });
    } else {
      const previous = readProgress();
      const settings = preferences.read(previous.current.options);
      const fresh = createDefaultRun({ ...previous.current.options, ...settings });
      const progress = kind !== 'new' ? previous : createRunProgress({
        ...progressStorage, getItem: key => key === saveKey ? JSON.stringify(fresh) : null,
      });
      if (kind === 'chapter' && (!chapterId || !progress.selectUnlockedChapter(chapterId))) throw Error('That chapter is still locked.');
      progress.setOptions(settings, false);
      run = progress;
      if (kind !== 'continue' && !directPreview) newRun = progress;
      game = await createTraversalPreview({ ...options, progress,
        input: { keyboardTarget: canvas, pointerTarget: canvas, blurTarget: window, getGamepads: () => navigator.getGamepads() },
        audio: { createContext: () => new AudioContext(), gestureTarget: window, visibilityTarget: document },
      });
      runtime = game;
      activeProgress = progress;
    }
    if (page.signal.aborted) { await closeSession(); return; }
    runtime.render();
    newRun?.save();
    status.hidden = true;
    if (game && run) { presentGame(game, run); game.start(); }
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
startButton.addEventListener('click', () => {
  if (directPreview || !readProgress().hasSave || window.confirm('Begin a new native run?')) void launch('new');
}, listen);
continueButton.addEventListener('click', () => { void launch('continue'); }, listen);
chaptersButton.addEventListener('click', () => {
  const unlocked = readProgress().current.unlocked;
  const first = renderChapterMenu(chapterButtons, unlocked, id => { void launch('chapter', id); });
  showMenuPage(chaptersMenu, chaptersButton, first);
}, listen);
for (const prefix of ['title', 'pause'] as const) {
  const optionsButton = element<HTMLButtonElement>(`#${prefix}-options`);
  optionsButton.addEventListener('click', () => {
    const fallback = activeProgress?.current.options ?? readProgress().current.options;
    shownPreferences = directPreview && shownPreferences ? shownPreferences : preferences.read(fallback);
    showSettings(shownPreferences);
    showMenuPage(optionsMenu, optionsButton, optionsMenu.querySelector('input'));
  }, listen);
  const controlsButton = element<HTMLButtonElement>(`#${prefix}-controls`);
  controlsButton.addEventListener('click', () => showMenuPage(controlsMenu, controlsButton), listen);
}
for (const back of document.querySelectorAll<HTMLButtonElement>('[data-page-back]')) {
  back.addEventListener('click', () => closeMenuPage(), listen);
}
pauseButton.addEventListener('click', () => game?.setPaused(true), listen);
resumeButton.addEventListener('click', () => game?.setPaused(false), listen);
restartButton.addEventListener('click', () => game?.restartFromCheckpoint(), listen);
window.addEventListener('keydown', event => {
  if (event.code !== 'Escape' || event.repeat) return;
  if (menuPage) { event.preventDefault(); closeMenuPage(); }
  else if (game?.context.paused && event.target !== canvas) game.setPaused(false);
}, listen);
returnButton.addEventListener('click', returnToTitle, listen);
advanceCredits.addEventListener('click', credits.advance, listen);

if (directPreview) void launch(query.get('continue') === '1' ? 'continue' : 'new');
else if (query.has('chapter') || query.get('geometry') === '1') void launch('geometry');
else showTitle();
