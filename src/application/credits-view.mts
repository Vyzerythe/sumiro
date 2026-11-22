import type { Credits } from './credits.mts';

/** The credits roll and end card share one focus target and one cancelable animation. */
export function createCreditsView(root: HTMLElement, button: HTMLButtonElement, close: () => void) {
  function find(selector: string) {
    const node = root.querySelector<HTMLElement>(selector);
    if (!node) throw Error(`Missing credits element ${selector}`);
    return node;
  }
  const roll = find('.credit-roll');
  const end = find('.credit-end');
  let animation: Animation | undefined;
  let closing = false;

  function reset() {
    animation?.cancel();
    animation = undefined;
    roll.replaceChildren();
    roll.hidden = end.hidden = root.hidden = true;
    closing = false;
  }

  function finishRoll() {
    animation?.cancel();
    animation = undefined;
    roll.hidden = true;
    end.hidden = false;
    button.textContent = 'Return to title';
  }

  function advance() {
    if (root.hidden || closing) return;
    if (end.hidden) { finishRoll(); return; }
    closing = true;
    close();
  }

  function show(data: Credits) {
    reset();
    const append = (tag: string, text: string, parent = roll) => {
      const element = document.createElement(tag);
      element.textContent = text;
      parent.append(element);
      return element;
    };
    append('h2', 'The road');
    for (const chapter of data.chapters) {
      const row = append('p', '');
      append('span', chapter.numeral, row);
      append('strong', chapter.title, row);
      append('small', `${chapter.found} of ${chapter.total}`, row);
    }
    append('h2', 'Scrolls');
    append('p', `${data.found} of ${data.total}`);
    if (data.found >= data.total) append('p', 'Every scroll on the mountain, found.');
    append('h2', 'Time on the road');
    append('p', `${data.minutes} minute${data.minutes === 1 ? '' : 's'}`);
    append('h2', 'Sumiro');
    for (const line of data.lines) append('p', line);
    roll.hidden = root.hidden = false;
    button.textContent = 'Skip credits';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      roll.classList.add('stationary');
    } else {
      roll.classList.remove('stationary');
      animation = roll.animate([{ transform: 'translateY(0)' },
        { transform: `translateY(-${root.clientHeight + roll.offsetHeight}px)` }], { duration: 30_000, fill: 'forwards' });
      animation.onfinish = finishRoll;
    }
    button.focus();
  }
  return { show, advance, reset };
}
