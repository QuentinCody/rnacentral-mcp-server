import { afterEach, expect, it, vi } from "vitest";
import { hashCanonicalJson } from "@bio-mcp/shared";
import { createRnacentralApiFetch } from "./api-adapter";

const api = createRnacentralApiFetch();
const urs = "URS0000049E57";
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>α</text></svg>';
const json = { data: { layout: svg, secondary_structure: "((..))", template: "native-template", future: [null, "0.0000010"] }, meta: { native: true } };
const request = { method: "GET", path: `/rna/${urs}/2d/` };
const svgRequest = { ...request, path: `/rna/${urs}/2d/svg/` };
function stub(response: Response) { const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetch); return fetch; }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("preserves the complete native JSON layout and dot-bracket with separately scoped evidence", async () => {
  const fetch = stub(Response.json(json, { headers: { etag: "native-etag", "last-modified": "native-date" } }));
  expect(await api(request)).toMatchObject({ status: 200, data: { provider_response: json, native_text: JSON.stringify(json),
    parsed_response_sha256: await hashCanonicalJson(json), source_url: `https://rnacentral.org/api/v1/rna/${urs}/2d/`, native_body_complete: true,
    etag: "native-etag", last_modified: "native-date", decoded_utf8_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    meta: { rnacentral: { evidence_type: "computed_secondary_structure", method: "R2DT", lookup_scope: "sequence", release_pinned: false,
      experimental_validation_attested: false, svg_root_detected: true, svg_parsed: false } } } });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://rnacentral.org/api/v1/rna/${urs}/2d/`, expect.objectContaining({ method: "GET", redirect: "manual", headers: { Accept: "application/json" } }));
});

it.each([urs, urs.toLowerCase(), `${urs}_9606`])("canonicalizes %s to the base sequence and records the supplied identifier", async id => {
  const fetch = stub(new Response(svg, { headers: { "content-type": "image/svg+xml" } }));
  expect((await api({ ...svgRequest, path: `/rna/${id}/2d/svg` })).data).toMatchObject({ native_text: svg,
    meta: { rnacentral: { requested_id: id, urs, taxid_suffix: id.includes("_") ? "9606" : null, taxid_used_for_lookup: false, representation: "svg" } } });
  expect(fetch.mock.calls[0][0]).toBe(`https://rnacentral.org/api/v1/rna/${urs}/2d/svg/`);
  expect(fetch.mock.calls[0][1].headers.Accept).toBe("*/*");
});

it.each([
  svg, "\uFEFF\n<?xml version='1.0'?>\n<!-- header -->\n" + svg,
  '<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' + svg,
  '<svg xmlns="http://www.w3.org/2000/svg"><script>untouched()</script><image href="https://external.example/image"/></svg>',
])("retains SVG markup as inert text without resolving embedded content: %#", async text => {
  const fetch = stub(new Response(text));
  expect((await api(svgRequest)).data).toMatchObject({ native_text: text, native_body_complete: true, meta: { rnacentral: { svg_parsed: false } } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("preserves split Unicode, a UTF-8 BOM and CRLF in the text and content hash", async () => {
  const text = "\uFEFF<?xml version='1.0'?>\r\n" + svg;
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  stub(new Response(stream));
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  expect((await api(svgRequest)).data).toMatchObject({ native_text: text, decoded_utf8_sha256: sha });
});

it.each([
  { ...request, method: "POST" }, { ...request, body: {} }, { ...request, params: { format: "json" } },
  { ...request, path: "/rna/RNACG48157878589.2/2d/" }, { ...request, path: "/rna/URS0000049E57_0/2d/" },
  { ...request, path: "/rna/URS0000049E57_9606_1/2d/" }, { ...request, path: "/rna/URS0000049E57/2d/?url=https://other.example" },
  { ...request, path: "/rna/%2e%2e/2d/" }, { ...request, path: "/rna/URS0000049E57/2d/svg/extra" },
])("rejects unsupported selections before I/O: %#", async input => {
  const fetch = stub(Response.json(json));
  await expect(api(input)).rejects.toMatchObject({ status: 400, data: { request_valid: false } });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([201, 206, 302, 404, 429, 503])("retains HTTP %i evidence without asserting absence or retrying", async status => {
  const text = "<html>provider status</html>";
  const fetch = stub(new Response(text, { status, headers: { "retry-after": "60" } }));
  await expect(api(svgRequest)).rejects.toMatchObject({ status: status >= 300 ? status : 502, data: { availability: "not_established",
    observation: { http_status: status, native_text: text, retry_after: "60", native_body_complete: true, decoded_utf8_sha256: expect.any(String) } } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["", "<html><svg/></html>", "<svg-error/>", "<!-- <svg/> -->", "<?xml version='1.0' <svg/>"])("rejects an HTTP-200 non-SVG body with retained evidence: %j", async text => {
  stub(new Response(text));
  await expect(api(svgRequest)).rejects.toMatchObject({ status: 502, data: { observation: { native_text: text, native_body_complete: true } } });
});

it.each([{}, [], null, { data: {} }, { data: { layout: "unavailable" } }, { data: { layout: 1 } }])("preserves malformed JSON structure evidence: %j", async native => {
  stub(Response.json(native));
  await expect(api(request)).rejects.toMatchObject({ status: 502, data: { provider_response: native, parsed_response_sha256: await hashCanonicalJson(native),
    observation: { native_text: JSON.stringify(native), native_body_complete: true }, availability: "not_established" } });
});

it("preserves non-JSON error pages returned with HTTP 200", async () => {
  stub(new Response("<html>unavailable</html>"));
  await expect(api(request)).rejects.toMatchObject({ status: 502, data: { observation: { native_text: "<html>unavailable</html>" } } });
});

it.each([
  new Response(svg, { headers: { "content-length": "4194305" } }),
  new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { "content-length": "1" } }),
  new Response(Uint8Array.of(0xff)),
])("does not return partial native evidence after oversized or invalid UTF-8 reads: %#", async response => {
  stub(response);
  await expect(api(svgRequest)).rejects.toMatchObject({ status: 502, data: { observation: { native_body_complete: false, decoded_utf8_sha256: null } } });
});

it("rejects Content-Range even on HTTP 200", async () => {
  stub(new Response(svg, { headers: { "content-range": "bytes 0-9/100" } }));
  await expect(api(svgRequest)).rejects.toMatchObject({ status: 502, data: { availability: "not_established", observation: { native_text: svg } } });
});

it("bounds header time and cancels a late body", async () => {
  vi.useFakeTimers(); let finish!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetch);
  const result = api(svgRequest).catch(error => error);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await result).toMatchObject({ status: 502, data: { observation: { http_status: null, native_body_complete: false } } });
  const cancel = vi.fn(); finish(new Response(new ReadableStream({ cancel })));
  await vi.advanceTimersByTimeAsync(1);
  expect(cancel).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
});

it("shares the deadline across headers and a stalled body without waiting on cancel", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => setTimeout(() => resolve(new Response(new ReadableStream({ cancel }))), 20_000))));
  const result = api(request).catch(error => error);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await result).toMatchObject({ status: 502, data: { observation: { http_status: 200, native_body_complete: false } } });
  expect(cancel).toHaveBeenCalledTimes(1);
});
