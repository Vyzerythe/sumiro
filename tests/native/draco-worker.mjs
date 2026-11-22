import { resolveObjectURL } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { Worker as Thread } from 'node:worker_threads';

const loader = import.meta.resolve('three/addons/loaders/DRACOLoader.js');
const decoder = new URL('../libs/draco/gltf/', loader);
const localAssets = new Map(['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js']
  .map(name => [new URL(name, decoder).href, new URL(name, decoder)]));

/** Supply the browser worker transport for the installed Three.js Draco decoder. */
export function installDracoWorker() {
  const originalFetch = globalThis.fetch;
  const workerDefinition = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const progressDefinition = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent');

  class DecoderWorker {
    #jobs = new Set();
    #starting;
    #stopped = false;

    constructor(url) {
      const source = resolveObjectURL(url);
      if (!source) throw Error('Three.js Draco worker source is unavailable');
      this.#starting = source.text().then(code => {
        if (this.#stopped) return undefined;
        const thread = new Thread(`
          const { parentPort } = require('node:worker_threads');
          globalThis.self = globalThis;
          self.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
          self.addEventListener = (type, callback) => parentPort.on(type, data => callback({ data }));
          ${code}
          parentPort.on('message', data => self.onmessage?.({ data }));
        `, { eval: true, execArgv: [] });
        thread.on('message', data => {
          this.#jobs.delete(data.id);
          this.onmessage?.({ data });
        });
        thread.on('error', error => this.#fail(error));
        thread.unref();
        return thread;
      });
    }

    #fail(error) {
      for (const id of this.#jobs) this.onmessage?.({ data: { type: 'error', id, error: error.message } });
      this.#jobs.clear();
    }

    postMessage(message, transfer) {
      if (message.type === 'decode') this.#jobs.add(message.id);
      void this.#starting.then(thread => {
        if (!this.#stopped) thread?.postMessage(message, transfer);
      }).catch(error => this.#fail(error));
    }

    terminate() {
      this.#stopped = true;
      this.#jobs.clear();
      void this.#starting.then(thread => thread?.terminate()).catch(() => {});
    }
  }

  globalThis.fetch = async (request, options) => {
    const url = request instanceof Request ? request.url : String(request);
    const asset = localAssets.get(url);
    if (!asset) return originalFetch(request, options);
    (request instanceof Request ? request.signal : options?.signal)?.throwIfAborted();
    return new Response(await readFile(asset));
  };
  Object.defineProperty(globalThis, 'Worker', { value: DecoderWorker, configurable: true });
  if (!progressDefinition) Object.defineProperty(globalThis, 'ProgressEvent', {
    configurable: true,
    value: class ProgressEvent extends Event {
      constructor(type, details) { super(type); Object.assign(this, details); }
    },
  });
  return () => {
    globalThis.fetch = originalFetch;
    if (workerDefinition) Object.defineProperty(globalThis, 'Worker', workerDefinition);
    else delete globalThis.Worker;
    if (!progressDefinition) delete globalThis.ProgressEvent;
  };
}
