import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export async function ping(): Promise<string> {
  return invoke<string>("ping");
}

export async function setClickThrough(enable: boolean): Promise<void> {
  await invoke("set_click_through", { enable });
}

/** T04 预留：Agent 事件订阅。返回取消订阅函数。 */
export function onAgentEvent(cb: (event: unknown) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;
  listen("agent://event", (e) => cb(e.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
