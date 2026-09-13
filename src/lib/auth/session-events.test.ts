import { describe, expect, it, vi } from "vitest";
import { createSessionEvents } from "./session-events";

function testChannel() {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  return {
    postMessage: vi.fn<(message: unknown) => void>(),
    addEventListener: (_type: "message", listener: (event: MessageEvent<unknown>) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: "message", listener: (event: MessageEvent<unknown>) => void) => {
      listeners.delete(listener);
    },
    close: vi.fn(),
    receive: (data: unknown) => {
      listeners.forEach((listener) => listener(new MessageEvent("message", { data })));
    },
  };
}

describe("tokenless cross-tab invalidation", () => {
  it("sends only a signal and never identity or data", () => {
    const channel = testChannel();
    const events = createSessionEvents(vi.fn(), () => channel);
    events.invalidate();
    expect(channel.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "invalidate" });
    events.close();
  });
  it("ignores unknown and data-bearing messages", () => {
    const channel = testChannel();
    const invalidated = vi.fn();
    const events = createSessionEvents(invalidated, () => channel);
    for (const value of [
      null,
      "invalidate",
      {},
      { type: "authenticate" },
      { type: "invalidate", principal: "untrusted" },
    ])
      channel.receive(value);
    expect(invalidated).not.toHaveBeenCalled();
    channel.receive({ type: "invalidate" });
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(channel.postMessage).not.toHaveBeenCalled();
    events.close();
  });
  it("removes listeners and closes the channel on cleanup", () => {
    const channel = testChannel();
    const invalidated = vi.fn();
    const events = createSessionEvents(invalidated, () => channel);
    events.close();
    channel.receive({ type: "invalidate" });
    events.invalidate();
    expect(invalidated).not.toHaveBeenCalled();
    expect(channel.postMessage).not.toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalledTimes(1);
  });
  it("falls back without browser storage when channel access is unavailable", () => {
    const events = createSessionEvents(vi.fn(), () => {
      throw new Error("Unavailable");
    });
    expect(() => events.invalidate()).not.toThrow();
    expect(() => events.close()).not.toThrow();
  });
});
