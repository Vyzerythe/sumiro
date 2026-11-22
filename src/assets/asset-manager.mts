/**
 * Asset service derived from `sv` and `lv` in sumiro/bundle/index-DnHRwVtn.js.
 * Loader contracts are from Three.js r187: GLTFLoader.parseAsync and decoder
 * setters, DRACOLoader.setDecoderPath/dispose, LoadingManager and TextureLoader.
 */
import { BufferGeometry, LoaderUtils, LoadingManager, Material, NoColorSpace, Texture, TextureLoader } from 'three';
import type { Object3D } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRACO_GLTF_CONFIG, DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DISPLAY_TEXTURES = [
  'map', 'emissiveMap', 'aoMap', 'lightMap', 'normalMap', 'roughnessMap',
  'metalnessMap', 'alphaMap', 'bumpMap', 'displacementMap', 'specularMap',
] as const;

export interface AssetManagerOptions {
  assetBaseURL: string | URL;
  dracoDecoderBaseURL?: string | URL;
  timeoutMs?: number;
  /** Transport for JSON, binary files, and the root glTF file. */
  fetch?: typeof fetch;
}

export interface AssetRequestOptions {
  signal?: AbortSignal;
}

export interface GLTFRequestOptions extends AssetRequestOptions {
  displaySpace?: boolean;
}

export interface TextureRequestOptions extends AssetRequestOptions {
  colorSpace?: Texture['colorSpace'];
}

export interface AssetManager {
  readonly pending: number;
  url(path: string): string;
  loadGLTF(path: string, options?: GLTFRequestOptions): Promise<GLTF>;
  loadTexture(path: string, options?: TextureRequestOptions): Promise<Texture<HTMLImageElement>>;
  loadJSON(path: string, options?: AssetRequestOptions): Promise<unknown>;
  loadArrayBuffer(path: string, options?: AssetRequestOptions): Promise<ArrayBuffer>;
  /** Wait for public load promises to settle, including loads queued by their completion handlers. */
  whenIdle(): Promise<void>;
  dispose(): void;
}

function directory(base: string | URL): string {
  const path = String(base);
  if (!path) return './';
  return path.endsWith('/') ? path : path + '/';
}

function useDisplaySpace(root: Object3D) {
  root.traverse(object => {
    if (!('material' in object) || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const map of DISPLAY_TEXTURES) {
        const texture: unknown = (material as Record<string, unknown>)[map];
        if (texture instanceof Texture && texture.colorSpace !== NoColorSpace) {
          texture.colorSpace = NoColorSpace;
          texture.needsUpdate = true;
        }
      }
    }
  });
}

/** Release a loaded model whose geometry, materials and textures are exclusively owned. */
export function disposeGLTF(model: GLTF) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  for (const scene of model.scenes) scene.traverse(object => {
    if ('geometry' in object && object.geometry instanceof BufferGeometry) geometries.add(object.geometry);
    if (!('material' in object)) return;
    const attached = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of attached) if (material instanceof Material) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

class OnDemandDRACOLoader extends DRACOLoader {
  // GLTFLoader calls preload for every declaration of the extension. Starting
  // on first decode keeps decoder fetch failures linked to a consumer promise.
  override preload(): this { return this; }
}

export function createAssetManager({
  assetBaseURL, dracoDecoderBaseURL, timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchAsset = globalThis.fetch,
}: AssetManagerOptions): AssetManager {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError('Asset timeout must be positive and within the timer range');
  }
  const base = directory(assetBaseURL);
  const lifetime = new AbortController();
  const decoderManager = new LoadingManager();
  const draco = new OnDemandDRACOLoader(decoderManager).setDecoderPath(
    dracoDecoderBaseURL === undefined ? DRACO_GLTF_CONFIG : directory(dracoDecoderBaseURL),
  );
  const dependencies = new LoadingManager();
  const gltfLoader = new GLTFLoader(dependencies).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const textureLoader = new TextureLoader(dependencies);
  const idleWaiters = new Set<() => void>();
  let pending = 0;

  // A decoder transfer may be completing while dispose runs. Give any resulting
  // decoder initialization microtasks a turn, then release their worker/blob too.
  decoderManager.onLoad = () => {
    if (lifetime.signal.aborted) setTimeout(() => draco.dispose(), 0);
  };

  function url(path: string): string {
    return /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(path) ? path : base + path;
  }

  async function request(path: string, signal: AbortSignal): Promise<Response> {
    const response = await fetchAsset(path, { signal });
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  }

  async function track<T>(
    path: string, caller: AbortSignal | undefined, load: (resource: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    lifetime.signal.throwIfAborted();
    caller?.throwIfAborted();
    const resource = url(path);
    const timeout = new AbortController();
    const signals = [lifetime.signal, timeout.signal];
    if (caller) signals.push(caller);
    const signal = AbortSignal.any(signals);
    const timer = setTimeout(() => {
      timeout.abort(new DOMException(`Timed out loading ${resource}`, 'TimeoutError'));
    }, timeoutMs);
    let rejectOnAbort: (() => void) | undefined;
    pending++;
    try {
      const cancellation = new Promise<never>((_, reject) => {
        rejectOnAbort = () => reject(signal.reason);
        signal.addEventListener('abort', rejectOnAbort, { once: true });
      });
      const task = Promise.resolve().then(() => {
        signal.throwIfAborted();
        return load(resource, signal);
      });
      return await Promise.race([cancellation, task]);
    } catch (cause) {
      if (signal.aborted) throw signal.reason;
      const details = cause instanceof Error ? `: ${cause.message}` : '';
      throw new Error(`Failed to load ${resource}${details}`, { cause });
    } finally {
      clearTimeout(timer);
      if (rejectOnAbort) signal.removeEventListener('abort', rejectOnAbort);
      pending--;
      if (pending === 0) {
        for (const waiter of idleWaiters) waiter();
        idleWaiters.clear();
      }
    }
  }

  return {
    get pending() { return pending; },
    url,
    loadGLTF(path, { displaySpace = true, signal: caller } = {}) {
      return track(path, caller, async (resource, signal) => {
        const response = await request(resource, signal);
        const data = await response.arrayBuffer();
        signal.throwIfAborted();
        const location = response.url || resource;
        const dependencyBase = /^(?:data|blob):/i.test(location)
          ? base : LoaderUtils.extractUrlBase(location.split(/[?#]/, 1)[0]!);
        const model = await gltfLoader.parseAsync(data, dependencyBase);
        if (signal.aborted) {
          disposeGLTF(model);
          signal.throwIfAborted();
        }
        if (displaySpace && model.scene) useDisplaySpace(model.scene);
        return model;
      });
    },
    loadTexture(path, { colorSpace = NoColorSpace, signal: caller } = {}) {
      return track(path, caller, async (resource, signal) => {
        // r187 TextureLoader uses HTML image events. The request may deliver
        // after cancellation, so discard the texture without publishing it.
        const texture = await textureLoader.loadAsync(resource);
        if (signal.aborted) {
          texture.dispose();
          signal.throwIfAborted();
        }
        texture.colorSpace = colorSpace;
        return texture;
      });
    },
    loadJSON(path, { signal } = {}) {
      return track(path, signal, async (resource, active) => (await request(resource, active)).json());
    },
    loadArrayBuffer(path, { signal } = {}) {
      return track(path, signal, async (resource, active) => (await request(resource, active)).arrayBuffer());
    },
    async whenIdle() {
      do {
        if (pending > 0) await new Promise<void>(resolve => idleWaiters.add(resolve));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      } while (pending > 0);
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort(new DOMException('Asset manager disposed', 'AbortError'));
      // Three FileLoader coalesces duplicate dependency URLs. Abort shared
      // transports only at teardown, keeping their controllers aborted for late requests.
      dependencies.abortController.abort(lifetime.signal.reason);
      decoderManager.abortController.abort(lifetime.signal.reason);
      draco.dispose();
    },
  };
}
