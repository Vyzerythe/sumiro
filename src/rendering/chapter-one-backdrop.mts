import {
  AddEquation, BackSide, ClampToEdgeWrapping, CustomBlending, CylinderGeometry, DoubleSide,
  Group, LinearFilter, LinearMipmapLinearFilter, MathUtils, Mesh, MeshBasicNodeMaterial,
  NoColorSpace, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, RepeatWrapping, SrcAlphaFactor, Vector3, ZeroFactor,
  type BufferGeometry, type Camera, type Node, type Object3D, type Texture, type UniformNode,
} from 'three/webgpu';
import {
  Discard, Fn, asin, atan, cameraPosition, mix, positionWorld, smoothstep, texture,
  uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

type Triplet = readonly [number, number, number];
type Fade = readonly [number, number];
const HUB = new Vector3(2, 5, -25);
const DEGREES = 57.29578;
const TAU = 2 * 3.14159265;

interface Hill {
  readonly kind: 'hill';
  readonly name: string;
  readonly side: string;
  readonly dist: number;
  readonly key: Triplet;
  readonly away?: number;
  readonly showZ?: Fade | null;
}

interface Strip {
  readonly name: string;
  readonly r: number;
  readonly elTop: number;
  readonly deg: number;
  readonly alpha: number;
  readonly drift: number;
}

interface Ribbon {
  readonly name: string;
  readonly side: string;
  readonly distance: number;
  readonly center: Vector3;
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  readonly alpha: number;
  readonly value: number;
}

// Authored camera references and atlas samples from the shipped backdrop.
const RIBBON_CAMERA = {
  96: [6.31, -5.33, -0.345, 3.42, -18.79],
  250: [25.92, -5.83, 9.91, 10.07, -45.45],
} as const;

const RIBBON_SAMPLES = [
  ['W', 250, 300, 508, 150, 170, 196, 6, 0.58, 1],
  ['N', 96, 468, 610, 210, 150, 255, 8, 0.62, 0.96],
  ['N', 96, 368, 650, 170, 150, 150, 9, 0.4, 0.9],
] as const;

function authoredRibbons(): Ribbon[] {
  const focal = 352 / Math.tan(20 * Math.PI / 180);
  return RIBBON_SAMPLES.map(([side, frame, px, py, width, height, distance, cell, alpha, value]) => {
    const [yaw, pitch, x, y, z] = RIBBON_CAMERA[frame];
    const az = yaw * Math.PI / 180;
    const el = pitch * Math.PI / 180;
    const forward = new Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const right = new Vector3(Math.cos(az), 0, -Math.sin(az));
    const up = new Vector3().crossVectors(right, forward);
    const ray = forward.multiplyScalar(focal).addScaledVector(right, px - 640).addScaledVector(up, 352 - py);
    const distanceScale = distance / Math.hypot(ray.x, ray.z);
    const pixelScale = distance / focal;
    return {
      name: `authored_${side}${distance}`, side, distance, center: ray.multiplyScalar(distanceScale).add(new Vector3(x, y, z)),
      width: width * pixelScale, height: height * pixelScale, cell, alpha, value,
    };
  });
}

export interface ChapterOneBackdropAssets {
  loadJSON(path: string): Promise<unknown>;
  loadGLTF(path: string): Promise<{ scene: Object3D }>;
  /** Supply decoded JPEG or RGBA WebP in its original row order. */
  loadTexture(path: string): Promise<Texture>;
}

export interface ChapterOneBackdropPalette {
  readonly sky?: Triplet;
  /** Degrees of rotation. A defined value selects the three-sided vista. */
  readonly vista?: number;
}

export interface ChapterOneBackdrop {
  readonly group: Group;
  update(camera: Camera, seconds: number): void;
  setPalette(palette?: ChapterOneBackdropPalette): void;
  dispose(): void;
}

function isTuple(value: unknown, count: number): value is readonly number[] {
  return Array.isArray(value) && value.length === count && value.every(Number.isFinite);
}

function isHill(value: unknown): value is Hill {
  if (typeof value !== 'object' || value === null) return false;
  const hill = value as Partial<Hill>;
  return hill.kind === 'hill' && typeof hill.name === 'string' && typeof hill.side === 'string' &&
    Number.isFinite(hill.dist) && isTuple(hill.key, 3) &&
    (hill.away === undefined || Number.isFinite(hill.away)) &&
    (hill.showZ == null || isTuple(hill.showZ, 2));
}

function isStrip(value: unknown): value is Strip {
  if (typeof value !== 'object' || value === null) return false;
  const strip = value as Partial<Strip>;
  return typeof strip.name === 'string' && [strip.r, strip.elTop, strip.deg, strip.alpha, strip.drift].every(Number.isFinite) &&
    strip.r! > 0 && strip.deg! > 0;
}

function readRows<Row>(value: unknown, check: (value: unknown) => value is Row, label: string): Row[] {
  if (!Array.isArray(value) || !value.every(check)) throw new Error(`Invalid backdrop ${label} data`);
  return value;
}

function normalizedMap(source: Texture, flipY: boolean, wrapU: boolean, wrapV: boolean, mipmaps: boolean) {
  const map = source.clone();
  map.flipY = flipY;
  map.wrapS = wrapU ? RepeatWrapping : ClampToEdgeWrapping;
  map.wrapT = wrapV ? RepeatWrapping : ClampToEdgeWrapping;
  map.generateMipmaps = mipmaps;
  map.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  map.magFilter = LinearFilter;
  map.anisotropy = mipmaps ? 4 : 1;
  map.colorSpace = NoColorSpace;
  map.needsUpdate = true;
  return map;
}

function horizonDirection() {
  return positionWorld.sub(cameraPosition).normalize();
}

function elevation(direction: Node<'vec3'>) {
  return asin(direction.y.clamp(-1, 1)).mul(DEGREES);
}

function paperGrain(paper: Texture, direction: Node<'vec3'>) {
  const az = atan(direction.x.negate(), direction.z.negate());
  const el = asin(direction.y.clamp(-1, 1));
  return texture(paper, vec2(az, el).div(TAU / 3)).r.mul(255).sub(128).div(4 * 160);
}

function ramp(below: Node<'float'>, first: Triplet, stops: readonly (readonly [number, number, Triplet])[]) {
  let color = vec3(...first).div(255);
  for (const [start, end, rgb] of stops) color = mix(color, vec3(...rgb).div(255), smoothstep(start, end, below));
  return color;
}

function mist(below: Node<'float'>) {
  return ramp(below, [198, 190, 173], [
    [0, 3, [199, 197, 187]], [3, 8, [200, 202, 197]], [11, 16, [197, 201, 198]],
    [16, 22, [189, 192, 188]], [22, 28, [180, 184, 180]],
  ]);
}

function floor(below: Node<'float'>) {
  return ramp(below, [186, 178, 158], [[1, 5, [172, 167, 152]], [5, 11, [160, 158, 148]], [12, 22, [138, 138, 128]]]);
}

function backdropMaterial(name: string, side: typeof BackSide | typeof DoubleSide) {
  // A color-only backdrop draws from far to near. The original cleared its
  // depth buffer between cards. Here the background does not touch scene depth.
  return new MeshBasicNodeMaterial({
    name, side, depthTest: false, depthWrite: false, toneMapped: false, transparent: false,
    blending: CustomBlending, blendEquation: AddEquation, blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
  });
}

function createHillMaterial(hill: Hill, map: Texture, paper: Texture, palette: Node<'vec3'>) {
  const show = uniform(1).setName('backdropShow');
  const away = uniform(hill.away ?? 0).setName('backdropAway');
  const material = backdropMaterial(`backdrop_hill_${hill.name}`, DoubleSide);
  const key = vec3(...hill.key);
  material.fragmentNode = Fn(() => {
    const texel = texture(map, uv()).toVar();
    const alpha = texel.a.mul(show).toVar();
    Discard(alpha.lessThan(0.008));
    const direction = horizonDirection().toVar();
    const distance = cameraPosition.xz.sub(key.xz).length();
    const tint = mist(elevation(direction).negate()).mul(vec3(0.86, 0.87, 0.86));
    const color = mix(texel.rgb, tint, smoothstep(4, 26, distance).mul(away));
    return vec4(color.mul(palette).mul(paperGrain(paper, direction).mul(0.28).add(1)), alpha);
  })();
  return { material, show, away };
}

function createStripMaterial(strip: Strip, map: Texture, paper: Texture, noise: Texture, seconds: Node<'float'>, palette: Node<'vec3'>) {
  const material = backdropMaterial(`backdrop_strip_${strip.name}`, BackSide);
  material.fragmentNode = Fn(() => {
    const relative = positionWorld.sub(vec3(HUB)).toVar();
    const az = atan(relative.x, relative.z).toVar();
    const el = atan(relative.y, relative.xz.length()).mul(DEGREES).toVar();
    const noiseUV = vec2(az.mul(0.37).add(seconds.mul(0.0013)), el.mul(0.041));
    const stir = texture(noise, noiseUV).rb.sub(0.5).toVar();
    const stripUV = vec2(az.div(TAU).add(seconds.mul(strip.drift / 360)).add(stir.x.mul(0.0009)),
      el.sub(strip.elTop).div(strip.deg).add(1).add(stir.y.mul(0.002)));
    const sample = texture(map, stripUV).rg.toVar();
    const alpha = sample.g.mul(strip.alpha).toVar();
    Discard(alpha.lessThan(0.003));
    const direction = horizonDirection().toVar();
    const below = elevation(direction).negate().toVar();
    const color = mix(floor(below).mul(vec3(0.95, 0.965, 0.985)), mist(below), sample.r);
    return vec4(color.mul(palette).mul(paperGrain(paper, direction).mul(0.22).add(1)), alpha);
  })();
  return material;
}

function createRibbonMaterial(ribbon: Ribbon, map: Texture, paper: Texture, palette: Node<'vec3'>) {
  const show = uniform(1).setName('backdropShow');
  const material = backdropMaterial(`backdrop_ribbons_${ribbon.name}`, DoubleSide);
  material.fragmentNode = Fn(() => {
    const local = uv();
    // These three authored plumes occupy the bottom row of the atlas.
    const atlas = vec2(local.x.add(ribbon.cell - 6).div(4), local.y.div(4));
    const sample = texture(map, atlas).rg.toVar();
    const alpha = sample.r.mul(ribbon.alpha).mul(show).toVar();
    Discard(alpha.lessThan(0.003));
    const direction = horizonDirection().toVar();
    const below = elevation(direction).negate().toVar();
    const color = mix(floor(below), mist(below), sample.g.mul(ribbon.value).clamp());
    return vec4(color.mul(palette).mul(paperGrain(paper, direction).mul(0.22).add(1)), alpha);
  })();
  return { material, show };
}

function heightAt(radius: number, degrees: number) {
  return HUB.y + radius * Math.tan(degrees * Math.PI / 180);
}

export function chapterOneBackdropOpacity(side: string, yaw: number, z: number, showZ?: Fade | null) {
  const west = MathUtils.smoothstep(yaw, 8, 16);
  let opacity = side === 'N' ? 1 - west : side === 'W' ? west : 1;
  if (showZ) {
    const [start, end] = showZ;
    opacity *= start > end ? 1 - MathUtils.smoothstep(z, end, start) : MathUtils.smoothstep(z, start, end);
  }
  return opacity;
}

interface HillCard {
  hill: Hill;
  mesh: Mesh;
  show: UniformNode<'float'>;
  away: UniformNode<'float'>;
}

/**
 * Mount authored hill, mist strip, and plume geometry into a world-space color layer.
 * Draw over the sky before grading, with a camera far plane beyond the cards.
 * Loader geometry and images are borrowed. Texture wrappers, generated geometry
 * and materials are owned by this mount.
 */
export async function mountChapterOneBackdrop(parent: Object3D, assets: ChapterOneBackdropAssets): Promise<ChapterOneBackdrop> {
  const [hillRows, stripRows, gltf, paperSource, noiseSource, ribbonsSource] = await Promise.all([
    assets.loadJSON('backdrop/hills.json'), assets.loadJSON('backdrop/strips.json'), assets.loadGLTF('backdrop/hills.glb'),
    assets.loadTexture('backdrop/paper.jpg'), assets.loadTexture('backdrop/noise.jpg'), assets.loadTexture('backdrop/ribbons.jpg'),
  ]);
  const hills = readRows(hillRows, isHill, 'hill');
  const strips = readRows(stripRows, isStrip, 'strip');
  const authored = new Map<string, BufferGeometry>();
  gltf.scene.traverse(node => {
    if (node instanceof Mesh) authored.set(node.name, node.geometry);
  });
  for (const hill of hills) {
    if (!authored.has(hill.name)) throw new Error(`Missing backdrop hill mesh ${hill.name}`);
  }
  const texturedLayers = [
    ...strips.map(strip => ({ type: 'strip' as const, distance: strip.r, strip, path: `backdrop/strips/${strip.name}.jpg` })),
    ...hills.map(hill => ({ type: 'hill' as const, distance: hill.dist, hill, path: `backdrop/hills/${hill.name}.webp` })),
  ];
  const images = new Map(await Promise.all(texturedLayers.map(async ({ path }) => [path, await assets.loadTexture(path)] as const)));
  const layers = [
    ...texturedLayers,
    ...authoredRibbons().map(ribbon => ({ type: 'ribbon' as const, distance: ribbon.distance - 1, ribbon })),
  ].sort((a, b) => b.distance - a.distance);

  const textures: Texture[] = [];
  const geometries: BufferGeometry[] = [];
  const materials: MeshBasicNodeMaterial[] = [];
  const cards: HillCard[] = [];
  const ribbons: { ribbon: Ribbon; mesh: Mesh; show: UniformNode<'float'> }[] = [];
  const group = new Group();
  group.name = 'backdrop';
  const vista = new Group();
  vista.name = 'backdrop_vista';
  vista.visible = false;
  group.add(vista);
  const sectors = [0, 1, 2].map(index => {
    const sector = new Group();
    sector.rotation.y = index * 2 * Math.PI / 3;
    vista.add(sector);
    return sector;
  });
  const palette = uniform(new Vector3(1, 1, 1)).setName('backdropPalette');
  const seconds = uniform(0).setName('backdropSeconds');
  const paper = normalizedMap(paperSource, true, true, true, false);
  const noise = normalizedMap(noiseSource, true, true, true, true);
  const ribbonMap = normalizedMap(ribbonsSource, true, false, false, true);
  const ribbonGeometry = new PlaneGeometry(1, 1);
  textures.push(paper, noise, ribbonMap);
  geometries.push(ribbonGeometry);
  let order = -4_000_000 + 1;

  for (const layer of layers) {
    if (layer.type === 'ribbon') {
      const { ribbon } = layer;
      const { material, show } = createRibbonMaterial(ribbon, ribbonMap, paper, palette);
      const mesh = new Mesh(ribbonGeometry, material);
      mesh.name = material.name;
      mesh.position.copy(ribbon.center);
      mesh.scale.set(ribbon.width, ribbon.height, 1);
      mesh.frustumCulled = false;
      mesh.renderOrder = order++;
      group.add(mesh);
      materials.push(material);
      ribbons.push({ ribbon, mesh, show });
      continue;
    }
    const source = images.get(layer.path)!;
    const isHill = layer.type === 'hill';
    const map = normalizedMap(source, !isHill, !isHill, false, isHill);
    textures.push(map);
    if (layer.type === 'strip') {
      const { strip } = layer;
      const top = heightAt(strip.r, strip.elTop);
      const bottom = heightAt(strip.r, strip.elTop - strip.deg);
      const geometry = new CylinderGeometry(strip.r, strip.r, top - bottom, 72, 1, true);
      const material = createStripMaterial(strip, map, paper, noise, seconds, palette);
      const mesh = new Mesh(geometry, material);
      mesh.name = material.name;
      mesh.position.set(HUB.x, (top + bottom) / 2, HUB.z);
      mesh.frustumCulled = false;
      mesh.renderOrder = order++;
      group.add(mesh);
      geometries.push(geometry);
      materials.push(material);
    } else {
      const { hill } = layer;
      const geometry = authored.get(hill.name)!;
      const { material, show, away } = createHillMaterial(hill, map, paper, palette);
      const mesh = new Mesh(geometry, material);
      mesh.name = `backdrop_${hill.name}`;
      mesh.renderOrder = order++;
      group.add(mesh);
      cards.push({ hill, mesh, show, away });
      materials.push(material);
      if (hill.side === 'N' && !hill.showZ) {
        for (const sector of sectors) {
          const copy = new Mesh(geometry, material);
          copy.name = `backdrop_vista_${hill.name}`;
          copy.position.set(...hill.key).negate();
          copy.renderOrder = order++;
          sector.add(copy);
        }
      }
    }
  }

  let disposed = false;
  parent.add(group);
  return {
    group,
    update(camera, time) {
      if (disposed) return;
      seconds.value = time;
      const position = camera.position;
      const world = camera.matrixWorld.elements;
      const yaw = MathUtils.radToDeg(Math.atan2(world[8]!, world[10]!));
      if (vista.visible) vista.position.copy(position).y += 60;
      for (const { hill, mesh, show } of cards) {
        const opacity = vista.visible ? 1 : chapterOneBackdropOpacity(hill.side, yaw, position.z, hill.showZ);
        mesh.visible = !vista.visible && opacity > 0.001;
        show.value = opacity;
      }
      for (const { ribbon, mesh, show } of ribbons) {
        if (vista.visible) {
          mesh.visible = false;
          continue;
        }
        const opacity = chapterOneBackdropOpacity(ribbon.side, yaw, position.z);
        mesh.visible = opacity > 0.001;
        show.value = opacity;
        mesh.rotation.y = Math.atan2(position.x - mesh.position.x, position.z - mesh.position.z);
      }
    },
    setPalette(value) {
      if (disposed) return;
      palette.value.set(...(value?.sky ?? [1, 1, 1]));
      vista.visible = value?.vista !== undefined;
      vista.rotation.y = (value?.vista ?? 0) * Math.PI / 180;
      for (const { hill, away } of cards) {
        if (hill.side === 'N' && !hill.showZ) away.value = vista.visible ? 0 : hill.away ?? 0;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      for (const resource of [...materials, ...geometries, ...textures]) resource.dispose();
    },
  };
}
