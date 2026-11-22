/**
 * Input sampling reconstructed from `qg` in sumiro/bundle/index-DnHRwVtn.js
 * (Git blob ebb0f16331c5186608eba202d2991a8cef5ccda6).
 */

const HANDLED_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight',
  'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyP', 'KeyE', 'KeyQ', 'Enter', 'Tab',
]);

const MENU_CONTROLS = ['up', 'down', 'left', 'right', 'confirm', 'back'] as const;
type MenuControl = (typeof MENU_CONTROLS)[number];

const KEYBOARD_MENU = new Map<string, MenuControl>([
  ['ArrowUp', 'up'], ['KeyW', 'up'], ['ArrowDown', 'down'], ['KeyS', 'down'],
  ['ArrowLeft', 'left'], ['KeyA', 'left'], ['ArrowRight', 'right'], ['KeyD', 'right'],
  ['Enter', 'confirm'], ['Space', 'confirm'], ['KeyE', 'confirm'], ['Escape', 'back'], ['Backspace', 'back'],
]);

const GAMEPAD_MENU: readonly (readonly [number, MenuControl])[] = [
  [0, 'confirm'], [1, 'back'], [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'],
];

const STICK_DEAD_ZONE = 0.15;
const FULL_STICK_THRESHOLD = 0.92;
const MENU_STICK_THRESHOLD = 0.5;
const STICK_LOOK_SCALE = 8;

const INACTIVE_GAMEPLAY_EDGES = {
  jump: false, inkStep: false, attack: false, parry: false, drink: false, interact: false, cat: false,
};

export interface GamepadSample {
  readonly axes: ArrayLike<number>;
  readonly buttons: ArrayLike<{ readonly pressed: boolean }>;
  readonly connected?: boolean;
}

export interface InputRouteState<Segment = unknown> {
  t: number;
  s: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  segment: Segment | null;
}

export interface ScriptedInputRoute<Segment = unknown> {
  sAtTime(time: number): number;
  feetAtTime(time: number, output: Pick<InputRouteState<Segment>, 'x' | 'y' | 'z'>): unknown;
  atS(distance: number): { heading: number };
  segmentAt(distance: number): Segment | null;
}

export interface InputManagerOptions<Segment = unknown> {
  keyboardTarget?: EventTarget;
  pointerTarget?: EventTarget;
  blurTarget?: EventTarget;
  getGamepads?: () => ArrayLike<GamepadSample | null | undefined> | null | undefined;
  scriptedRoute?: ScriptedInputRoute<Segment>;
}

export interface InputManager<Segment = unknown> {
  readonly scripted: boolean;
  readonly route: Readonly<InputRouteState<Segment>> | null;
  readonly menu: Readonly<Record<MenuControl, boolean>>;
  readonly forward: number;
  readonly strafe: number;
  readonly magnitude: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly leap: boolean;
  readonly jump: boolean;
  readonly jumpHeld: boolean;
  readonly walk: boolean;
  readonly sprint: boolean;
  readonly inkStep: boolean;
  readonly attack: boolean;
  readonly parry: boolean;
  readonly drink: boolean;
  readonly interact: boolean;
  readonly cat: boolean;
  readonly pause: boolean;
  readonly fullStickS: number;
  muted: boolean;
  isDown(code: string): boolean;
  wasPressed(code: string): boolean;
  beginStep(time: number, delta?: number): void;
  endStep(): void;
  reset(): void;
  dispose(): void;
}

function readAxis(pad: GamepadSample, index: number): number {
  const value = pad.axes[index] ?? 0;
  return Number.isFinite(value) && Math.abs(value) >= STICK_DEAD_ZONE ? value : 0;
}

/** Samples an explicitly supplied set of platform sources once per simulation step. */
export function createInputManager<Segment = unknown>({
  keyboardTarget, pointerTarget, blurTarget = keyboardTarget ?? pointerTarget, getGamepads, scriptedRoute,
}: InputManagerOptions<Segment> = {}): InputManager<Segment> {
  const route: InputRouteState<Segment> | null = scriptedRoute
    ? { t: 0, s: 0, x: 0, y: 0, z: 0, heading: 0, segment: null } : null;
  const held = new Map<string, number>();
  let stepHeld: Map<string, number> | undefined;
  let presses = new Map<string, number>();
  let stepPresses = new Map<string, number>();
  let sequence = 0;
  const menuHits = new Set<MenuControl>();
  let pointerX = 0;
  let pointerY = 0;
  let previousPadButtons: boolean[] = [];
  let padStickEngaged = false;
  let resyncPad = false;
  let disposed = false;
  const removeListeners: (() => void)[] = [];

  const input = {
    scripted: scriptedRoute !== undefined,
    route,
    menu: { up: false, down: false, left: false, right: false, confirm: false, back: false },
    forward: 0, strafe: 0, magnitude: 0, lookX: 0, lookY: 0,
    ...INACTIVE_GAMEPLAY_EDGES,
    leap: false, jumpHeld: false, walk: false, sprint: false, pause: false, fullStickS: 0, muted: false,
    isDown: (code: string) => (stepHeld ?? held).has(code),
    wasPressed: (code: string) => stepPresses.has(code),
    beginStep, endStep, reset, dispose,
  };

  function sampleRoute(time: number) {
    if (!scriptedRoute || !route) return;
    const distance = scriptedRoute.sAtTime(time);
    scriptedRoute.feetAtTime(time, route);
    route.t = time;
    route.s = distance;
    route.heading = scriptedRoute.atS(distance).heading;
    route.segment = scriptedRoute.segmentAt(distance);
    input.forward = input.magnitude = 1;
    input.strafe = 0;
  }

  function beginStep(time: number, delta = 0) {
    if (disposed) return;
    if (scriptedRoute) {
      sampleRoute(time);
      return;
    }

    const sampledHeld = new Map(held);
    stepHeld = sampledHeld;
    stepPresses = presses;
    presses = new Map();
    const menu = new Set(menuHits);
    menuHits.clear();
    const edge = (code: string) => stepPresses.has(code);
    const mostRecent = (code: string) => Math.max(sampledHeld.get(code) ?? 0, stepPresses.get(code) ?? 0);
    const direction = (positive: string, positiveArrow: string, negative: string, negativeArrow: string) => Math.sign(
      Math.max(mostRecent(positive), mostRecent(positiveArrow)) - Math.max(mostRecent(negative), mostRecent(negativeArrow)),
    );

    let forward = direction('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown');
    let strafe = direction('KeyD', 'ArrowRight', 'KeyA', 'ArrowLeft');
    let magnitude = forward || strafe ? 1 : 0;
    const actions = {
      jump: edge('Space'), jumpHeld: sampledHeld.has('Space'), walk: sampledHeld.has('KeyC'),
      inkStep: edge('ShiftLeft') || edge('ShiftRight'), attack: edge('Mouse0') || edge('KeyJ'),
      parry: edge('Mouse2') || edge('KeyK'), drink: edge('KeyR'), interact: edge('KeyE'), cat: edge('KeyF'),
    };
    let pause = edge('Escape') || edge('KeyP');
    let lookX = pointerX;
    let lookY = pointerY;
    pointerX = pointerY = 0;

    const pad = getGamepads?.()?.[0];
    if (pad && pad.connected !== false) {
      const buttons = Array.from(pad.buttons, button => Boolean(button?.pressed));
      const pressed = (index: number) => !resyncPad && buttons[index] === true && !previousPadButtons[index];
      const x = readAxis(pad, 0);
      const y = readAxis(pad, 1);
      if (x || y) {
        forward = -y;
        strafe = x;
        magnitude = Math.min(1, Math.hypot(x, y));
      }
      input.fullStickS = magnitude >= FULL_STICK_THRESHOLD ? input.fullStickS + delta : 0;
      lookX += readAxis(pad, 2) * STICK_LOOK_SCALE;
      lookY += readAxis(pad, 3) * STICK_LOOK_SCALE;
      actions.jump ||= pressed(0);
      actions.jumpHeld ||= buttons[0] === true;
      actions.inkStep ||= pressed(1);
      actions.attack ||= pressed(2);
      actions.drink ||= pressed(3);
      actions.interact ||= pressed(3);
      actions.parry ||= pressed(4);
      actions.cat ||= pressed(5);
      pause ||= pressed(9);
      for (const [button, control] of GAMEPAD_MENU) if (pressed(button)) menu.add(control);
      if (!padStickEngaged && !resyncPad) {
        if (y < -MENU_STICK_THRESHOLD) menu.add('up');
        if (y > MENU_STICK_THRESHOLD) menu.add('down');
        if (x < -MENU_STICK_THRESHOLD) menu.add('left');
        if (x > MENU_STICK_THRESHOLD) menu.add('right');
      }
      padStickEngaged = Math.abs(x) > MENU_STICK_THRESHOLD || Math.abs(y) > MENU_STICK_THRESHOLD;
      previousPadButtons = buttons;
    } else {
      previousPadButtons = [];
      padStickEngaged = false;
      input.fullStickS = 0;
    }
    resyncPad = false;

    if (input.muted) {
      Object.assign(actions, INACTIVE_GAMEPLAY_EDGES, { jumpHeld: false, walk: false });
      forward = strafe = magnitude = 0;
    }
    Object.assign(input, actions, { forward, strafe, magnitude, lookX, lookY, leap: actions.jump, pause });
    for (const control of MENU_CONTROLS) input.menu[control] = menu.has(control);
  }

  function endStep() {
    stepHeld = undefined;
    stepPresses.clear();
    Object.assign(input, INACTIVE_GAMEPLAY_EDGES, { leap: false, pause: false, lookX: 0, lookY: 0 });
    for (const control of MENU_CONTROLS) input.menu[control] = false;
  }

  function reset() {
    endStep();
    held.clear();
    presses.clear();
    menuHits.clear();
    sequence = pointerX = pointerY = 0;
    previousPadButtons = [];
    padStickEngaged = false;
    resyncPad = true;
    Object.assign(input, { forward: 0, strafe: 0, magnitude: 0, jumpHeld: false, walk: false, fullStickS: 0 });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const remove of removeListeners) remove();
    removeListeners.length = 0;
    reset();
  }

  function listen(target: EventTarget | undefined, type: string, listener: EventListener) {
    if (!target) return;
    target.addEventListener(type, listener);
    removeListeners.push(() => target.removeEventListener(type, listener));
  }

  if (scriptedRoute) sampleRoute(0);
  else {
    try {
      listen(keyboardTarget, 'keydown', raw => {
        const { code, repeat, altKey, ctrlKey } = raw as KeyboardEvent;
        if (!held.has(code)) {
          const order = repeat ? 1 : ++sequence;
          held.set(code, order);
          if (!repeat) presses.set(code, order);
        }
        const control = KEYBOARD_MENU.get(code);
        if (control) menuHits.add(control);
        if ((HANDLED_KEYS.has(code) || (altKey && code !== 'F4')) && !(ctrlKey && code === 'KeyW')) raw.preventDefault();
      });
      listen(keyboardTarget, 'keyup', raw => {
        const { code } = raw as KeyboardEvent;
        held.delete(code);
        if (code === 'AltLeft' || code === 'AltRight') raw.preventDefault();
      });
      listen(blurTarget, 'blur', reset);
      listen(pointerTarget, 'mousemove', raw => {
        const { movementX, movementY } = raw as MouseEvent;
        if (Number.isFinite(movementX)) pointerX += movementX;
        if (Number.isFinite(movementY)) pointerY += movementY;
      });
      listen(pointerTarget, 'mousedown', raw => {
        const { button } = raw as MouseEvent;
        if (button === 0 || button === 2) presses.set(`Mouse${button}`, 0);
      });
      listen(pointerTarget, 'contextmenu', event => event.preventDefault());
    } catch (error) {
      dispose();
      throw error;
    }
  }
  return input;
}
