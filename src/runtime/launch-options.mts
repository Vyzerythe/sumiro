type CameraPose = readonly [x: number, y: number, z: number, targetX: number, targetY: number, targetZ: number];

interface LaunchOptions {
  capture: boolean;
  autorun: boolean;
  perf: boolean;
  t: number;
  seed: number;
  hz: number;
  only: readonly string[] | null;
  cam: CameraPose | null;
  size: Readonly<{ width: number; height: number }> | null;
  raw: URLSearchParams;
}

function cameraPose(value: string | null): CameraPose | null {
  if (value === null) return null;
  const fields = value.split(',');
  if (fields.length !== 6 || fields.some(field => !field.trim())) return null;
  const values = fields.map(Number);
  if (!values.every(Number.isFinite)) return null;
  return [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!];
}

function viewportSize(value: string | null): LaunchOptions['size'] {
  const match = /^(\d+)x(\d+)$/.exec(value ?? '');
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (![width, height].every(dimension => Number.isSafeInteger(dimension) && dimension > 0)) return null;
  return { width, height };
}

/** Parse startup options without touching browser globals or logging. */
export function parseLaunchOptions(query: string | URLSearchParams) {
  const raw = new URLSearchParams(query);
  function enabled(key: string): boolean {
    const value = raw.get(key);
    return value !== null && value !== '0' && value !== 'false';
  }
  function finite(key: string, fallback: number): number {
    const value = Number(raw.get(key));
    return raw.has(key) && Number.isFinite(value) ? value : fallback;
  }

  const diagnostics: string[] = [];
  const options: Readonly<LaunchOptions> = Object.freeze({
    capture: enabled('capture'),
    autorun: enabled('autorun'),
    perf: enabled('perf'),
    t: Math.max(0, finite('t', 0)),
    seed: Math.trunc(finite('seed', 1)),
    hz: finite('hz', 0),
    only: raw.get('only')?.split(',').map(name => name.trim()).filter(Boolean) ?? null,
    cam: cameraPose(raw.get('cam')),
    size: viewportSize(raw.get('size')),
    raw,
  });

  if (raw.has('cam') && !options.cam) diagnostics.push('Invalid ?cam. Expected six coordinates: x,y,z,targetX,targetY,targetZ.');
  if (raw.has('size') && !options.size) diagnostics.push('Invalid ?size. Expected positive integer dimensions in WxH form.');
  if (raw.has('t') && !Number.isFinite(Number(raw.get('t')))) diagnostics.push('Invalid ?t. Expected a finite time.');
  if (raw.has('hz') && options.hz <= 0) diagnostics.push('Invalid ?hz. Expected a positive simulation rate.');
  return { options, diagnostics };
}
