import type {
  Change,
  Company,
  Draft,
  Keryx,
  LoadOptions,
  Versions,
  WakeupRequest,
} from './keryx-api';

/** What the Go side returns: the Go error message, or the value. */
type Result<T> = { value: T } | { error: string };

interface RawKeryx {
  load(opts: LoadOptions): Result<Company>;
  company(): Result<Company>;
  publish(channel: string, draft: Draft): Result<Change>;
  unpublish(channel: string, id: string): Result<Change>;
  refreshTimestamp(): Result<Change>;
  validate(): Result<string>;
  versions(channel: string): Result<Versions>;
  signWakeup(companyId: string, channel: string, seq: number): Result<WakeupRequest>;
}

declare global {
  /** Defined by wasm_exec.js. */
  class Go {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  }
  var keryx: RawKeryx | undefined;
}

let instance: Promise<Keryx> | undefined;

export async function loadKeryx(): Promise<Keryx> {
  instance ??= instantiate();
  return instance;
}

async function instantiate(): Promise<Keryx> {
  const base = import.meta.env.BASE_URL;
  await loadScript(`${base}wasm_exec.js`);
  const go = new Go();
  const wasm = await instantiateWasm(`${base}keryx.wasm`, go.importObject);
  void go.run(wasm.instance);
  const raw = globalThis.keryx;
  if (!raw) throw new Error('keryx.wasm did not define globalThis.keryx');
  return wrap(raw);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.append(script);
  });
}

async function instantiateWasm(
  url: string,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  const streamable =
    'instantiateStreaming' in WebAssembly &&
    response.headers.get('content-type')?.split(';')[0] === 'application/wasm';
  if (streamable) return WebAssembly.instantiateStreaming(response, imports);
  return WebAssembly.instantiate(await response.arrayBuffer(), imports);
}

function unwrap<T>(result: Result<T>): T {
  if ('error' in result) throw new Error(result.error);
  return result.value;
}

function wrap(raw: RawKeryx): Keryx {
  return {
    load: (opts) => unwrap(raw.load(opts)),
    company: () => unwrap(raw.company()),
    publish: (channel, draft) => unwrap(raw.publish(channel, draft)),
    unpublish: (channel, id) => unwrap(raw.unpublish(channel, id)),
    refreshTimestamp: () => unwrap(raw.refreshTimestamp()),
    validate: () => unwrap(raw.validate()),
    versions: (channel) => unwrap(raw.versions(channel)),
    signWakeup: (companyId, channel, seq) => unwrap(raw.signWakeup(companyId, channel, seq)),
  };
}
