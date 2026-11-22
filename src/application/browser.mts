import { createRunProgress } from '../domain/run-progress.mts';
import { createChapterPreview } from './chapter-preview.mts';
import { createTraversalPreview } from './traversal-preview.mts';

const canvas = document.querySelector('canvas');
const status = document.querySelector<HTMLElement>('[role="status"]');
if (!canvas || !status) throw Error('The native preview requires a canvas and status element');
const statusMessage = status;

function viewport(element: HTMLCanvasElement) {
  return {
    width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight),
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  };
}

const page = new AbortController();
window.addEventListener('pagehide', event => {
  if (!event.persisted) page.abort();
}, { signal: page.signal });

const assetBaseURL = new URL('../sumiro/assets/', document.baseURI);
const query = new URLSearchParams(window.location.search);
const walk = query.get('walk') === '1';
try {
  const progress = walk && query.get('continue') === '1' ? createRunProgress({
    getItem: key => localStorage.getItem(key),
  }) : null;
  const options = { canvas, viewport: viewport(canvas), assets: { assetBaseURL } };
  const traversal = walk
    ? await createTraversalPreview({ ...options, ...(progress ? { progress } : {}),
      input: { keyboardTarget: window, getGamepads: () => navigator.getGamepads() } })
    : null;
  const runtime = traversal ?? await createChapterPreview(options);
  if (page.signal.aborted) {
    await runtime.dispose();
  } else {
    function fail(error: unknown) {
      statusMessage.hidden = false;
      statusMessage.textContent = error instanceof Error ? error.message : 'The native preview could not render.';
      page.abort();
    }

    const observer = new ResizeObserver(() => {
      const { width, height, pixelRatio } = viewport(canvas);
      try {
        runtime.resize(width, height, pixelRatio);
        runtime.render();
      } catch (error) {
        fail(error);
      }
    });
    page.signal.addEventListener('abort', () => {
      observer.disconnect();
      void runtime.dispose().catch(error => console.error(error));
    }, { once: true });
    status.hidden = !walk;
    if (traversal) {
      const controls = 'WASD or arrows to move · Space to jump';
      let prompt = controls;
      let notice: number | undefined;
      status.textContent = controls;
      function showNotice(text: string, duration: number) {
        window.clearTimeout(notice);
        statusMessage.textContent = text;
        notice = window.setTimeout(() => {
          notice = undefined;
          statusMessage.textContent = prompt;
        }, duration);
      }
      const unsubscribe = traversal.onInteraction(event => {
        switch (event.type) {
          case 'prompt':
            prompt = event.target?.prompt ?? controls;
            if (notice === undefined) statusMessage.textContent = prompt;
            break;
          case 'shrine-rested': showNotice('The lantern is lit.', 3800); break;
          case 'scroll-captured': showNotice(event.lines.join('\n'), 6000); break;
          case 'hint': showNotice(event.text, event.ms); break;
          case 'chapter-exit': showNotice('Chapter One exit reached.', 3800); break;
        }
      });
      page.signal.addEventListener('abort', () => {
        unsubscribe();
        window.clearTimeout(notice);
      }, { once: true });
      runtime.start();
    }
    observer.observe(canvas);
  }
} catch (error) {
  page.abort();
  status.textContent = error instanceof Error ? error.message : 'The native preview could not start.';
}
