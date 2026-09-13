interface SessionChannel {
  postMessage(value: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

export function createSessionEvents(
  onInvalidated: () => void,
  createChannel?: (name: string) => SessionChannel,
) {
  let channel: SessionChannel | null = null;
  let closed = false;
  const receive = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (
      !closed &&
      data &&
      typeof data === "object" &&
      Object.keys(data).length === 1 &&
      "type" in data &&
      data.type === "invalidate"
    )
      onInvalidated();
  };
  try {
    const factory =
      createChannel ??
      (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
        ? (name: string) => new BroadcastChannel(name)
        : undefined);
    channel = factory?.("qafilah-session-invalidation") ?? null;
    channel?.addEventListener("message", receive);
  } catch {
    channel = null;
  }

  return {
    /** Only an invalidation signal crosses tabs. No identity, Store data, or secrets are sent. */
    invalidate(): void {
      if (closed) return;
      try {
        channel?.postMessage({ type: "invalidate" });
      } catch {
        /* Focus revalidation remains available. */
      }
    },
    close(): void {
      closed = true;
      channel?.removeEventListener("message", receive);
      channel?.close();
      channel = null;
    },
  };
}
