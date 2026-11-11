import { afterEach, expect, it, vi } from "vitest";
import { createRnacentralApiFetch } from "./api-adapter";
import { scimodomEndpoints } from "../spec/scimodom";
import { rnacentralCatalog } from "../spec/catalog";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";

const api = createRnacentralApiFetch();
const path = "/scimodom/modification/query/gene";
const params = { taxaId: 9606, rnaType: "WTS", chrom: "1", chromStart: 0, chromEnd: 1000 };
afterEach(() => vi.unstubAllGlobals());

// Synthetic records reflect provider fields; not evidence of live host parity.
it("preserves native measurements, zeros, identifiers and metadata through region paging", async () => {
  const native = { totalRecords: 1234, records: [{ id: 9, chrom: "1", start: 0, end: 1, strand: "+", name: "m6A", score: 0, coverage: 0, frequency: 17, dataset_id: "fixture", tech: "assay", taxa_id: 9606, gene_name: "GENE", meta: { provider: true } }] };
  const fetcher = vi.fn().mockResolvedValue(Response.json(native)); vi.stubGlobal("fetch", fetcher);
  expect(await api({ method: "GET", path, params: { ...params, firstRecord: 100, maxRecords: 25 } })).toMatchObject({ status: 200, data: { native, _scimodom: { api_version: "v0", assembly: null, release: null, snapshot_verified: false, coordinate_system: "0-based half-open; provider chromosome names" } } });
  const [url, options] = fetcher.mock.calls[0];
  expect(String(url)).toBe("https://scimodom.dieterichlab.org/api/v0/modification/query/gene?taxaId=9606&rnaType=WTS&chrom=1&chromStart=0&chromEnd=1000&firstRecord=100&maxRecords=25");
  expect(options).toMatchObject({ redirect: "manual", headers: { Accept: "application/json" } });
});

it.each(scimodomEndpoints.filter(endpoint => !endpoint.path.includes("query")))("routes discovery $path through Code Mode with native arrays retained", async endpoint => {
  const fetcher = vi.fn().mockResolvedValue(Response.json([{ id: "native", assembly: "GRCh38" }])); vi.stubGlobal("fetch", fetcher);
  const proxy = createApiProxyTool({ apiFetch: api, catalog: rnacentralCatalog, doNamespace: {} as DurableObjectNamespace, stagingPrefix: "rnacentral" });
  const result = await proxy.handler({ method: "GET", path: endpoint.path, params: endpoint.pathParams ? { taxa_id: 9606 } : {} }, { sql: () => [] });
  expect(result).toMatchObject({ native: [{ id: "native", assembly: "GRCh38" }] });
  expect(String(fetcher.mock.calls[0][0])).toBe("https://scimodom.dieterichlab.org/api/v0" + endpoint.path.replace("/scimodom", "").replace("{taxa_id}", "9606"));
});

it.each([
  { taxaId: "9606" }, { taxaId: 0 }, { chromStart: -1 }, { chromEnd: 0 }, { chromEnd: 1_000_001 },
  { chrom: "1?other=true" }, { rnaType: "" }, { firstRecord: -1 }, { firstRecord: 0.5 },
  { maxRecords: 0 }, { maxRecords: 1001 }, { maxRecords: "10" }, { url: "https://example.org" },
])("rejects invalid region input before any fetch: %j", async patch => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api({ method: "GET", path, params: { ...params, ...patch } })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  { method: "POST", path, params }, { method: "GET", path, params, body: {} },
  { method: "GET", path: "/scimodom/dataset/list_mine" },
  { method: "GET", path: "/scimodom/release?x=1" },
  { method: "GET", path: "/scimodom/release", params: { format: "xml" } },
])("rejects unsupported methods, routes and discovery options: %j", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api(request)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it("preserves native errors and rejects HTML and redirects without following them", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ message: "Unknown RNA type" }, { status: 404 }))
    .mockResolvedValueOnce(new Response("<html>error</html>"))
    .mockResolvedValueOnce(new Response("moved", { status: 302, headers: { location: "https://example.org" } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(api({ method: "GET", path, params })).rejects.toMatchObject({ status: 404, data: '{"message":"Unknown RNA type"}' });
  await expect(api({ method: "GET", path, params })).rejects.toThrow("Expected Sci-ModoM JSON");
  await expect(api({ method: "GET", path, params })).rejects.toMatchObject({ status: 302 });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("bounds success and error streams even without content-length", async () => {
  for (const status of [200, 400]) {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
    await expect(api({ method: "GET", path, params })).rejects.toThrow("exceeds 4 MiB");
    expect(cancel).toHaveBeenCalledTimes(1);
  }
});

it("rejects declared oversize and invalid UTF-8 while decoding split multibyte characters", async () => {
  const text = JSON.stringify({ note: "β", records: [], totalRecords: 0 });
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(body, { headers: { "content-type": "application/json" } }))
    .mockResolvedValueOnce(new Response("", { headers: { "content-length": String(4 * 1024 * 1024 + 1) } }))
    .mockResolvedValueOnce(new Response(Uint8Array.of(255), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await api({ method: "GET", path, params })).toMatchObject({ data: { native: JSON.parse(text) } });
  await expect(api({ method: "GET", path, params })).rejects.toThrow("exceeds 4 MiB");
  await expect(api({ method: "GET", path, params })).rejects.toThrow();
});
