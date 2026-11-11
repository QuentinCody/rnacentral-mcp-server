import { afterEach, expect, it, vi } from "vitest";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { createRnacentralApiFetch } from "./api-adapter";
import { rnacentralCatalog } from "../spec/catalog";

const api = createRnacentralApiFetch();
const submission = { method: "POST", path: "/exports/", body: { query: 'NCBI_TAXONOMY_ID:9606 AND description:"α & β"', format: "parquet" } };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function stub(response: Response) { const fetcher = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetcher); return fetcher; }

it.each(["fasta", "parquet"])("submits one correctly encoded %s request and retains the native receipt", async format => {
  const native = { task_id: "task_1-a", state: "PENDING", future: { zero: 0, missing: null } };
  const fetcher = stub(Response.json(native, { status: 202 }));
  const result = await api({ ...submission, body: { ...submission.body, format } });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://export.rnacentral.org/submit/");
  expect(init).toMatchObject({ method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" } });
  const body = JSON.parse(init.body);
  const selection = new URL(body.api_url);
  expect(selection.origin + selection.pathname).toBe("https://www.ebi.ac.uk/ebisearch/ws/rest/rnacentral");
  expect(Object.fromEntries(selection.searchParams)).toEqual({ query: submission.body.query, format: "json" });
  expect(body).toEqual({ api_url: selection.href, data_type: format });
  expect(result.data).toMatchObject({ provider_response: native, meta: { rnacentral: {
    task_id: "task_1-a", provider_state: "PENDING", submission_state_unknown: false,
    status_url: "https://export.rnacentral.org/status/task_1-a",
    download_url: `https://export.rnacentral.org/download/task_1-a/${format}`, download_verified: false, release_pinned: false,
  } } });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("submits through the actual Code Mode proxy with the body intact", async () => {
  const fetcher = stub(Response.json({ task_id: "saved-job" }, { status: 201 }));
  const proxy = createApiProxyTool({ apiFetch: api, catalog: rnacentralCatalog, stagingPrefix: "rnacentral" });
  const result = await proxy.handler(submission, { sql: () => [] });
  expect(result).toMatchObject({ provider_response: { task_id: "saved-job" }, meta: { rnacentral: { task_id: "saved-job" } } });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ data_type: "parquet" });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(["PENDING", "SUCCESS", "FAILURE", "new-provider-state"])("reads one saved job without resubmission or inferred readiness: %s", async state => {
  const fetcher = stub(Response.json({ state, errors: ["native"], task_id: "job-1" }));
  const result = await api({ method: "GET", path: "/exports/job-1/", params: { format: "fasta" } });
  expect(fetcher.mock.calls[0][0]).toBe("https://export.rnacentral.org/status/job-1");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", body: undefined });
  expect(result.data).toMatchObject({ provider_response: { state, errors: ["native"] }, meta: { rnacentral: { provider_state: state, download_verified: false } } });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("does not guess format and rejects mismatched receipt identity", async () => {
  stub(Response.json({ status: "SUCCESS" }));
  expect((await api({ method: "GET", path: "/exports/job-1" })).data).toMatchObject({ meta: { rnacentral: { task_id: "job-1", format: null, download_url: null } } });
  stub(Response.json({ task_id: "other-job" }));
  await expect(api({ method: "GET", path: "/exports/job-1" })).rejects.toMatchObject({ data: { provider_response: { task_id: "other-job" } } });
});

it.each([{}, { task_id: "../unsafe" }, { task_id: 123 }])("preserves an unusable submission receipt without inventing continuation: %j", async native => {
  stub(Response.json(native));
  expect((await api(submission)).data).toMatchObject({ provider_response: native, meta: { rnacentral: { task_id: null, status_url: null, download_url: null, submission_state_unknown: true } } });
});

it.each([302, 307, 400, 429, 500, 503])("preserves HTTP %i native failures and never replays POST", async status => {
  const fetcher = stub(new Response('{"error":"native rejection","score":"0.9000"}', { status, headers: { "Retry-After": "60", Location: "https://export.rnacentral.org/submit/" } }));
  await expect(api(submission)).rejects.toMatchObject({ status, data: { http_status: status, retry_after: "60", location: "https://export.rnacentral.org/submit/", native_body_complete: true, submission_state_unknown: true, provider_response: { error: "native rejection", score: "0.9000" } } });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([
  { ...submission, method: "GET" }, { ...submission, params: { url: "https://other.example" } },
  { ...submission, body: { query: "x", format: ["fasta"] } },
  { ...submission, body: { query: "", format: "parquet" } },
  { ...submission, body: { query: "x".repeat(8193), format: "parquet" } },
  { ...submission, body: { query: "x", format: "csv" } },
  { ...submission, body: { query: "x", format: "fasta", api_url: "https://other.example" } },
  { method: "GET", path: "/exports/../other" },
  { method: "GET", path: "/exports/job1", params: { format: ["fasta"] } },
  { method: "GET", path: "/exports/job1", body: {} },
])("rejects invalid export input before fetching: %#", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api(request)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});

it("retains an HTML response and uncertain submission without claiming a usable receipt", async () => {
  stub(new Response("<html>error</html>"));
  await expect(api(submission)).rejects.toMatchObject({ data: { native_text: "<html>error</html>", native_body_complete: true, submission_state_unknown: true } });
});

it("bounds header time even if fetch ignores abort, with no retry", async () => {
  vi.useFakeTimers(); const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
  const outcome = api(submission).catch(error => error);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await outcome).toMatchObject({ data: { http_status: null, submission_state_unknown: true } });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("bounds a stalled body and cancels without waiting for cancellation", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
  stub(new Response(new ReadableStream({ cancel })));
  const outcome = api(submission).catch(error => error);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await outcome).toMatchObject({ data: { native_body_complete: false, submission_state_unknown: true } });
  expect(cancel).toHaveBeenCalled();
});

it("rejects oversized export responses", async () => {
  stub(new Response(new Uint8Array(4 * 1024 * 1024 + 1)));
  await expect(api(submission)).rejects.toMatchObject({ data: { native_body_complete: false, submission_state_unknown: true } });
});

it("discovers and stages complete export status through the real Code Mode proxy", async () => {
  const native = { state: "SUCCESS", result: { description: "β".repeat(20000), metadata: { missing: null } } };
  stub(Response.json(native)); const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") { stored.push((await request.json() as { data: unknown }).data); return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 }); }
    return Response.json({ success: true, schema: { tables: { payloads: { columns: [{ name: "payload_json" }] } } } });
  } }) };
  const proxy = createApiProxyTool({ apiFetch: api, catalog: rnacentralCatalog, doNamespace: namespace, stagingPrefix: "rnacentral", maxInlineBytes: 30 * 1024 });
  const result = await proxy.handler({ method: "GET", path: "/exports/{task_id}/", params: { task_id: "job1", format: "parquet" } }, { sql: () => [] });
  expect(result).toMatchObject({ __staged: true, _staging: expect.any(Object) });
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toContainEqual(expect.objectContaining({ provider_response: native, native_text: JSON.stringify(native) }));
  expect(rnacentralCatalog.endpoints.filter(endpoint => endpoint.category === "exports")).toHaveLength(2);
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});
