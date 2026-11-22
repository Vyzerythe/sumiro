import type { RunVitalsSnapshot } from '../domain/run-vitals.mts';

export function createVitalsView(root: HTMLElement, assetBaseURL: URL) {
  const strokes = document.createElement('div');
  const drinks = document.createElement('div');
  strokes.className = 'vital-strokes';
  drinks.className = 'vital-drinks';
  root.append(strokes, drinks);

  function draw(container: HTMLElement, filled: number, total: number, picture: (index: number) => string) {
    while (container.children.length > total) container.lastElementChild?.remove();
    for (let index = container.children.length; index < total; index++) {
      const image = document.createElement('img');
      image.src = new URL(picture(index), assetBaseURL).href;
      image.alt = '';
      container.append(image);
    }
    for (const [index, image] of Array.from(container.children).entries()) image.classList.toggle('spent', index >= filled);
  }

  return {
    draw(data: RunVitalsSnapshot) {
      draw(strokes, data.strokes, data.maxStrokes, index => `ui/stroke_${index % 5 + 1}.png`);
      draw(drinks, data.drinks, data.maxDrinks, () => 'ui/gourd.png');
      root.setAttribute('aria-label', `Strokes ${data.strokes} of ${data.maxStrokes}. Gourd ${data.drinks} of ${data.maxDrinks}.`);
    },
  };
}
