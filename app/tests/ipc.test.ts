import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listenMock(...a) }));

import { ping, setClickThrough, onAgentEvent } from "../src/ipc";

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
});

describe("ipc", () => {
  it("F-01 ping resolves pong and calls invoke once with 'ping'", async () => {
    invokeMock.mockResolvedValue("pong");
    await expect(ping()).resolves.toBe("pong");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("ping");
  });

  it("F-02 setClickThrough passes enable param through", async () => {
    invokeMock.mockResolvedValue(undefined);
    await setClickThrough(true);
    expect(invokeMock).toHaveBeenCalledWith("set_click_through", { enable: true });
    await setClickThrough(false);
    expect(invokeMock).toHaveBeenCalledWith("set_click_through", { enable: false });
  });

  it("F-03 ping rejects when invoke throws", async () => {
    invokeMock.mockRejectedValue(new Error("ipc down"));
    await expect(ping()).rejects.toThrow("ipc down");
  });

  it("F-04 onAgentEvent unsubscribe calls unlisten", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const off = onAgentEvent(() => {});
    await Promise.resolve(); // let listen() promise settle
    off();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("F-04b unsubscribe before listen settles still cleans up", async () => {
    const unlisten = vi.fn();
    let resolveListen: (fn: () => void) => void;
    listenMock.mockReturnValue(new Promise((r) => (resolveListen = r)));
    const off = onAgentEvent(() => {});
    off(); // cancel before listen resolves
    resolveListen!(unlisten);
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
