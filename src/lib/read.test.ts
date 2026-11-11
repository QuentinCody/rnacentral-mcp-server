import { afterEach, expect, it, vi } from "vitest";
import { readRnaText } from "./read";

afterEach(() => vi.useRealTimers());

it("preserves multibyte text across chunks and permits the byte boundary", async () => {
  const bytes = new TextEncoder().encode("β".repeat(2 * 1024 * 1024));
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 1)); controller.enqueue(bytes.slice(1)); controller.close();
  } }));
  expect(await readRnaText(response, Date.now() + 30_000)).toBe("β".repeat(2 * 1024 * 1024));
});

it.each([undefined, "1"])("checks actual stream bytes despite missing or incorrect length: %s", async length => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(4 * 1024 * 1024)); controller.enqueue(new Uint8Array(1));
  }, cancel }), { headers: length ? { "content-length": length } : {} });
  await expect(readRnaText(response, Date.now() + 30_000)).rejects.toThrow("exceeds 4 MiB");
  expect(cancel).toHaveBeenCalled();
});

it("cancels an oversized advertised body before consuming it", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { headers: { "content-length": "4194305" } });
  await expect(readRnaText(response, Date.now() + 30_000)).rejects.toThrow("exceeds 4 MiB");
  expect(cancel).toHaveBeenCalled();
});

it("rejects invalid UTF-8 instead of corrupting source evidence", async () => {
  await expect(readRnaText(new Response(new Uint8Array([0xc3])), Date.now() + 30_000)).rejects.toThrow();
});

it("ends a stalled body at the remaining request deadline without awaiting cancellation", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const response = new Response(new ReadableStream({ cancel }));
  const result = expect(readRnaText(response, Date.now() + 25)).rejects.toThrow("deadline exceeded");
  await vi.advanceTimersByTimeAsync(25);
  await result;
  expect(cancel).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("cleans up the timer when the upstream stream fails", async () => {
  vi.useFakeTimers();
  const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error("upstream read failed")); } }));
  await expect(readRnaText(response, Date.now() + 25)).rejects.toThrow("upstream read failed");
  expect(vi.getTimerCount()).toBe(0);
});
