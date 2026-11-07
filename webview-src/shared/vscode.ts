// Webview side of the host <-> webview bridge.
import type { CommonRpc, HostEvent, RpcResponse, WebviewBootData } from '../../src/shared/protocol';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(s: T): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
declare global {
  interface Window {
    __VSCODECRAFT__?: WebviewBootData;
  }
}

const api: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: (m) => console.log('[postMessage]', m), getState: () => undefined, setState: () => undefined };

let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const listeners = new Map<string, Set<(data: any) => void>>();

window.addEventListener('message', (ev: MessageEvent) => {
  const m = ev.data as RpcResponse | HostEvent;
  if (!m || typeof m !== 'object') return;
  if (m.kind === 'rpc-result') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m.result);
  } else if (m.kind === 'event') {
    listeners.get(m.event)?.forEach((cb) => cb(m.data));
  }
});

/** Call an RPC method on the extension host. Typed for the common methods; any string for feature methods. */
export function call<K extends keyof CommonRpc>(method: K, params: CommonRpc[K]['params']): Promise<CommonRpc[K]['result']>;
export function call<T = any>(method: string, params?: unknown): Promise<T>;
export function call(method: string, params?: unknown): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    api.postMessage({ kind: 'rpc', id, method, params });
  });
}

/** Subscribe to host events (WebviewHost.post(event, data)). Returns an unsubscribe function. */
export function onEvent<T = any>(event: string, cb: (data: T) => void): () => void {
  let set = listeners.get(event);
  if (!set) listeners.set(event, (set = new Set()));
  set.add(cb);
  return () => set!.delete(cb);
}

/** Boot data injected by the host (language, l10n strings, initial state). */
export function boot<S = any>(): WebviewBootData & { state: S } {
  return (window.__VSCODECRAFT__ ?? { language: 'en', l10n: {}, state: null }) as WebviewBootData & { state: S };
}

/** Persisted webview state (survives hide/show when retainContextWhenHidden is false). */
export const state = {
  get: <T>() => api.getState<T>(),
  set: <T>(s: T) => api.setState(s),
};
