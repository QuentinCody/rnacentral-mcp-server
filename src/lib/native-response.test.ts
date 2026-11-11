import { afterEach, expect, it, vi } from "vitest";
import { createRnacentralApiFetch } from "./api-adapter";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const api = createRnacentralApiFetch();

it.each(["/scimodom/release", "/rna/example/"])("preserves complete malformed/non-JSON/partial bodies for %s", async path => {
  for (const [text, status, headers] of [["<html>upstream error</html>", 200, {}], ["{broken", 200, { "content-type": "application/json" }],
    ['{"records":[]}', 206, { "content-type": "application/json" }], ['{"records":[]}', 200, { "content-type": "application/json", "content-range": "bytes 0-13/99" }]] as const) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { status, headers })));
    await expect(api({ method: "GET", path })).rejects.toMatchObject({ status: 502, data: text });
  }
});

it("preserves failed HTTP-body status and Retry-After without waiting for cancel", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 429, headers: { "retry-after": "60" } })));
  const result = expect(api({ method: "GET", path: "/scimodom/release" })).rejects.toMatchObject({ status: 429,
    data: { http_status: 429, body_unavailable: true, retry_after: "60" } });
  await vi.advanceTimersByTimeAsync(30000); await result;
  expect(cancel).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it("bounds an uncooperative Sci-ModoM header read and cancels a late response", async () => {
  vi.useFakeTimers(); let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  const result = expect(api({ method: "GET", path: "/scimodom/release" })).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(30000); await result;
  const cancel = vi.fn(); resolve(new Response(new ReadableStream({ cancel })));
  await Promise.resolve(); expect(cancel).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it("reads a BOM without altering native fields or confusing site totals with dataset counts", async () => {
  const native = { records: [{ dataset_id: "source", coverage: 0, frequency: 0 }], totalRecords: 2500 };
  vi.stubGlobal("fetch", vi.fn(async () => new Response("\uFEFF" + JSON.stringify(native), { headers: { "content-type": "application/json" } })));
  expect(await api({ method: "GET", path: "/scimodom/modification/query/gene", params: { taxaId: 9606, rnaType: "WTS", chrom: "1", chromStart: 0, chromEnd: 1 } }))
    .toMatchObject({ data: { native, _scimodom: { native_sha256: expect.any(String) } }, upstreamTotal: 2500,
      completeness: { complete: false, returned: 1, total_available: 2500 } });
});
