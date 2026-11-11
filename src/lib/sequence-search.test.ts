import { afterEach, expect, it, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { hashCanonicalJson } from "@bio-mcp/shared";
import { createRnacentralApiFetch } from "./api-adapter";

const api = createRnacentralApiFetch();
const submit = { method: "POST", path: "/sequence-search/jobs/", body: { query: ">query\nACGUacgu\n", databases: ["fixture-db"] } };
const status = { method: "GET", path: "/sequence-search/jobs/job-1/" };
const results = { method: "GET", path: "/sequence-search/jobs/job-1/results/" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function stub(...responses: Response[]) { const fetch = vi.fn(); for (const response of responses) fetch.mockResolvedValueOnce(response); vi.stubGlobal("fetch", fetch); return fetch; }
async function untilFetch(fetch: ReturnType<typeof vi.fn>, count: number) {
  // WebCrypto completes on the real event loop; keep the fake request clock still.
  for (let i = 0; i < 1000 && fetch.mock.calls.length < count; i++) await setImmediate();
  expect(fetch).toHaveBeenCalledTimes(count);
}

it("submits once with an unchanged query and database selection, retaining receipt and hashes", async () => {
  const native = { job_id: "job-1", status: "queued", future: { native: [null, false, "1e-500"] } };
  const fetch = stub(Response.json(native, { status: 201 }));
  const response = await api(submit);
  expect(fetch).toHaveBeenCalledExactlyOnceWith("https://search.rnacentral.org/api/submit-job", expect.objectContaining({ method: "POST", body: JSON.stringify(submit.body), redirect: "manual" }));
  expect(response).toMatchObject({ status: 201, data: { provider_response: native, native_text: JSON.stringify(native), parsed_response_sha256: await hashCanonicalJson(native),
    meta: { rnacentral: { job_id: "job-1", provider_state: "queued", request_sha256: await hashCanonicalJson(submit.body), submission_state_unknown: false, release_pinned: false } } } });
});

it("uses the provider client's empty-list default without inventing database names", async () => {
  const fetch = stub(Response.json({ job_id: "saved" }, { status: 201 }));
  await api({ ...submit, body: { query: "ACGU" } });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ query: "ACGU", databases: [] });
});

it.each(["queued", "success", "partial_success", "failed", "future_state"])("reads %s once without polling or submission", async state => {
  const native = { status: state, errors: ["retain"], job_id: "job-1" };
  const fetch = stub(Response.json(native));
  expect(await api(status)).toMatchObject({ data: { provider_response: native, meta: { rnacentral: { provider_state: state, partial_success: state === "partial_success" } } } });
  expect(fetch).toHaveBeenCalledExactlyOnceWith("https://search.rnacentral.org/api/job-status/job-1", expect.objectContaining({ method: "GET", body: undefined }));
});

it.each(["success", "partial_success"])("retains every hit, score string and alignment after native %s", async state => {
  const hits = Array.from({ length: 8 }, (_, i) => ({ rnacentral_id: `URS_FIXTURE_${i}`, score: "1e-500", alignment: { query: "AC-G", target: "ACTG" }, future: [null, i] }));
  const statusBody = { status: state, warning: "native warning" };
  const fetch = stub(Response.json(statusBody), Response.json(hits));
  const response = await api(results);
  expect(response).toMatchObject({ status: 200, data: { provider_response: hits,
    parsed_response_sha256: await hashCanonicalJson(hits), status_observation: { provider_response: statusBody },
    meta: { rnacentral: { result_count: 8, provider_state: state, partial_success: state === "partial_success", coverage_complete: false } } } });
  expect(fetch.mock.calls.map(call => call[0])).toEqual(["https://search.rnacentral.org/api/job-status/job-1", "https://search.rnacentral.org/api/job-result/job-1"]);
  expect(fetch.mock.calls.every(call => call[1].method === "GET")).toBe(true);
});

it("retains an empty native result without claiming exhaustive coverage", async () => {
  stub(Response.json({ status: "success" }), Response.json([]));
  expect(await api(results)).toMatchObject({ data: { provider_response: [], meta: { rnacentral: { result_count: 0, coverage_complete: false } } } });
});

it.each(["queued", "failed", "future_state"])("does not fetch results when status is %s", async state => {
  const fetch = stub(Response.json({ status: state, message: "native" }));
  await expect(api(results)).rejects.toMatchObject({ data: { provider_state: state, observations: [{ provider_response: { message: "native" } }], submission_state_unknown: false } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([{}, { status: "success", job_id: "other" }, { status: 0 }])("rejects incomplete or mismatched status: %j", async native => {
  const fetch = stub(Response.json(native));
  await expect(api(results)).rejects.toMatchObject({ data: { observations: [{ provider_response: native }] } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([{}, { job_id: "../unsafe" }, { job_id: 1 }])("reports uncertain submission and preserves an unusable receipt: %j", async native => {
  const fetch = stub(Response.json(native, { status: 201 }));
  await expect(api(submit)).rejects.toMatchObject({ data: { job_id: null, submission_state_unknown: true, observations: [{ provider_response: native }] } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("retains a job ID from an unexpected submission status without replaying", async () => {
  const fetch = stub(Response.json({ job_id: "saved" }));
  await expect(api(submit)).rejects.toMatchObject({ data: { job_id: "saved", submission_state_unknown: true } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([302, 400, 429, 503])("preserves native HTTP %i failures and Retry-After without replay", async code => {
  const native = { error: "provider failure", details: { original: true } };
  const fetch = stub(Response.json(native, { status: code, headers: { "retry-after": "90" } }));
  await expect(api(submit)).rejects.toMatchObject({ status: code, data: { submission_state_unknown: true,
    observations: [{ provider_response: native, retry_after: "90", http_status: code, native_body_complete: true }] } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([{}, [null], "native-text"])("rejects malformed result shapes with complete evidence: %j", async native => {
  stub(Response.json({ status: "success" }), Response.json(native));
  await expect(api(results)).rejects.toMatchObject({ data: { observations: [{ provider_response: { status: "success" } }, { provider_response: native }] } });
});

it.each([
  { ...submit, method: "GET" }, { ...submit, params: { url: "https://other.example" } },
  { ...submit, body: { query: " " } }, { ...submit, body: { query: "α".repeat(50001) } },
  { ...submit, body: { query: "ACGU", databases: null } }, { ...submit, body: { query: "ACGU", databases: [1] } },
  { ...submit, body: { query: "ACGU", databases: Array(26).fill("db") } },
  { ...submit, body: { query: "ACGU", unknown: true } }, { ...status, body: {} },
  { ...status, path: "/sequence-search/jobs/../other" }, { ...results, method: "POST" },
])("rejects unsupported input before I/O: %#", async request => {
  const fetch = stub(); await expect(api(request)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});

it("preserves non-JSON errors without claiming a parsed hash", async () => {
  stub(new Response("<html>unavailable</html>", { status: 503 }));
  await expect(api(submit)).rejects.toMatchObject({ data: { observations: [{ native_text: "<html>unavailable</html>", parsed_response_sha256: null, native_body_complete: true }] } });
});

it("bounds fetch time and cancels a late response without resubmission", async () => {
  vi.useFakeTimers(); let finish!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetch);
  const pending = api(submit).catch(error => error);
  await untilFetch(fetch, 1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await pending).toMatchObject({ data: { submission_state_unknown: true, observations: [{ native_body_complete: false, http_status: null }] } });
  const cancel = vi.fn(); finish(new Response(new ReadableStream({ cancel })));
  await vi.advanceTimersByTimeAsync(1); expect(cancel).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
});

it("shares the deadline between status and result reads, including a stalled result body", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(Response.json({ status: "success" })), 20_000)))
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
  vi.stubGlobal("fetch", fetch);
  const pending = api(results).catch(error => error);
  await untilFetch(fetch, 1);
  await vi.advanceTimersByTimeAsync(20_000);
  await untilFetch(fetch, 2);
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await pending).toMatchObject({ data: { observations: [{ native_body_complete: true }, { native_body_complete: false }], submission_state_unknown: false } });
  expect(cancel).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(2);
});

it("fails oversized reads without keeping partial native evidence", async () => {
  stub(new Response(new Uint8Array(4 * 1024 * 1024 + 1), { status: 201 }));
  await expect(api(submit)).rejects.toMatchObject({ data: { observations: [{ native_body_complete: false, parsed_response_sha256: null }], submission_state_unknown: true } });
});
