import { createChapterPreview } from './chapter-preview.mts';

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
try {
  const runtime = await createChapterPreview({
    canvas, viewport: viewport(canvas), assets: { assetBaseURL },
  });
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
    status.hidden = true;
    observer.observe(canvas);
  }
} catch (error) {
  page.abort();
  status.textContent = error instanceof Error ? error.message : 'The native preview could not start.';
}
