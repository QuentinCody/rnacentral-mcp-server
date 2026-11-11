import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { hashCanonicalJson, verifyCitationEnvelope } from "@bio-mcp/shared";
import { rnaResponse } from "../lib/tool-result";
import { fixture, recover } from "./staging-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("discovers all three sequence job operations through both search aliases", async () => {
  const f = fixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}rnacentral_search`].handler({ query: "sequence-search", max_results: 10 }, {});
      expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
      for (const path of ["/sequence-search/jobs/", "/sequence-search/jobs/{job_id}/", "/sequence-search/jobs/{job_id}/results/"]) expect(JSON.stringify(result)).toContain(path);
    }
  } finally { f.close(); }
});

it("submits exactly once through each execute alias and preserves the native receipt", async () => {
  const f = fixture();
  const body = { query: ">fixture\nACGUacgu\n", databases: ["fixture-db"] };
  const fetch = vi.fn(async () => Response.json({ job_id: "saved-job" }, { status: 201 })); vi.stubGlobal("fetch", fetch);
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}rnacentral_execute`].handler({ code: `return await api.post('/sequence-search/jobs/', ${JSON.stringify(body)});` }, {});
      expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, data: { provider_response: { job_id: "saved-job" } }, _meta: { citation: { result_hash: expect.any(String) } } } });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).query === body.query)).toBe(true);
  } finally { f.close(); }
});

it.each(["success", "partial_success"])("recovers every native hit and status through Code Mode and SQL for %s", async state => {
  const f = fixture();
  const hits = Array.from({ length: 8 }, (_, i) => ({ rnacentral_id: `URS_FIXTURE_${i}`, score: "1e-500", alignment: { query: "AC-G", target: "ACTG" }, description: '🧬 \\"'.repeat(1000) }));
  const status = { status: state, native_warning: "retain" };
  const fetch = vi.fn(async (url: string) => Response.json(url.includes("job-status") ? status : hits)); vi.stubGlobal("fetch", fetch);
  try {
    const code = " \nreturn await api.get('/sequence-search/jobs/{job_id}/results/', {job_id:'saved-job'});\n";
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}rnacentral_execute`].handler({ code }, {});
      expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, _staging: expect.any(Object), _meta: { citation: { result_hash: expect.any(String) } } } });
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30720);
      const id = result.structuredContent.data_access_id ?? result.structuredContent.data?.data_access_id;
      const recovered = await recover(f, id, prefix);
      expect(recovered).toMatchObject({ provider_response: hits, native_text: JSON.stringify(hits), parsed_response_sha256: await hashCanonicalJson(hits),
        status_observation: { provider_response: status }, meta: { rnacentral: { job_id: "saved-job", partial_success: state === "partial_success", coverage_complete: false, result_count: 8 } } });
      expect(result.structuredContent._meta.citation.result_hash).toBe(await hashCanonicalJson(recovered));
      const verified = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation,
        structuredContent: result.structuredContent, toolArguments: { code }, materialized: { value: recovered } });
      expect(verified.verification).toMatchObject({ query: "verified", result: "verified", quarantined: false });
      const schema = await f.tools[`${prefix}rnacentral_get_schema`].handler({ data_access_id: id }, {});
      expect(schema.isError).not.toBe(true); expect(schema.content).toBeDefined(); expect(schema.structuredContent).toBeDefined();
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  } finally { f.close(); }
});

it.each([64, 20000])("retains failed submission evidence (%i characters) and marks a recovered program crash as an error", async length => {
  const f = fixture();
  const native = { error: "provider failure", details: "α".repeat(length) };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native, { status: 503, headers: { "retry-after": "90" } })));
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}rnacentral_execute`].handler({ code: "return await api.post('/sequence-search/jobs/', {query:'ACGU'});" }, {});
      expect(result).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false } });
      const marker = result.structuredContent.error?.details?.data ?? result.structuredContent.data?.data;
      if (length === 20000) expect(marker).toMatchObject({ __staged: true, data_access_id: expect.any(String) });
      const recovered = length === 20000 ? await recover(f, marker.data_access_id, prefix) : marker;
      expect(recovered).toMatchObject({ submission_state_unknown: true, observations: [{ provider_response: native, http_status: 503, retry_after: "90" }] });
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30720);
    }
    const original = { content: [{ type: "text" as const, text: "PROGRAM DID NOT COMPLETE" }], structuredContent: { success: true, disposition: "partial", program_error: { code: "PROGRAM_DID_NOT_COMPLETE" }, data: { __staged: true, data_access_id: "saved-evidence" } } };
    expect(await rnaResponse(async () => original, f.env, "rnacentral_execute", {})).toMatchObject({ isError: true, structuredContent: { success: false, data: original.structuredContent.data, program_error: original.structuredContent.program_error } });
  } finally { f.close(); }
});

it("keeps the staged job results when the user program crashes after retrieval", async () => {
  const f = fixture();
  const hits = [{ rnacentral_id: "URS_FIXTURE", description: "α".repeat(20000) }];
  vi.stubGlobal("fetch", async (url: string) => Response.json(url.includes("job-status") ? { status: "success" } : hits));
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}rnacentral_execute`].handler({ code: "const data = await api.get('/sequence-search/jobs/saved-job/results/'); throw new Error('fixture program crash');" }, {});
      expect(result).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false,
        program_error: { code: "PROGRAM_DID_NOT_COMPLETE", message: "fixture program crash" }, _staging: expect.any(Object) } });
      const recovered = await recover(f, result.structuredContent.data.data_access_id, prefix);
      expect(recovered.provider_response).toEqual(hits);
    }
  } finally { f.close(); }
});

it("discovers both secondary-structure reads through both search aliases", async () => {
  const f = fixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}rnacentral_search`].handler({ query: "secondary-structure", max_results: 10 }, {});
      expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
      expect(JSON.stringify(result)).toContain("/rna/{urs}/2d/");
      expect(JSON.stringify(result)).toContain("/rna/{urs}/2d/svg/");
    }
  } finally { f.close(); }
});

it.each(["json", "svg"])("retains inline and chunked %s structures through both Code Mode and SQL aliases", async representation => {
  const f = fixture();
  try {
    for (const large of [false, true]) {
      const layout = '<svg xmlns="http://www.w3.org/2000/svg"><text>' + '🧬 \\"'.repeat(large ? 12000 : 1) + "</text></svg>";
      const native = { data: { layout, secondary_structure: "((..))", future: { precision: "0.0000010" } }, native_warning: "preserve" };
      const text = representation === "svg" ? layout : JSON.stringify(native);
      const fetch = vi.fn(async () => new Response(text, { headers: { "content-type": representation === "svg" ? "image/svg+xml" : "application/json" } }));
      vi.stubGlobal("fetch", fetch);
      for (const prefix of ["", "mcp_"]) {
        const code = `\uFEFF \nreturn await api.get('/rna/{urs}/2d/${representation === "svg" ? "svg/" : ""}', {urs:'urs0000049e57_9606'}); // native structure\r\n`;
        const result = await f.tools[`${prefix}rnacentral_execute`].handler({ code }, {});
        expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, _meta: { citation: { result_hash: expect.any(String) } } } });
        expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30720);
        let recovered = result.structuredContent.data;
        if (large) {
          expect(result.structuredContent._staging).toBeDefined();
          const id = result.structuredContent.data_access_id ?? result.structuredContent.data?.data_access_id;
          recovered = await recover(f, id, prefix);
          const schema = await f.tools[`${prefix}rnacentral_get_schema`].handler({ data_access_id: id }, {});
          expect(schema.isError).not.toBe(true); expect(schema.content).toBeDefined(); expect(schema.structuredContent).toBeDefined();
        }
        expect(recovered).toMatchObject({ native_text: text, native_body_complete: true,
          source_url: `https://rnacentral.org/api/v1/rna/URS0000049E57/2d/${representation === "svg" ? "svg/" : ""}`,
          meta: { rnacentral: { urs: "URS0000049E57", taxid_suffix: "9606", taxid_used_for_lookup: false, evidence_type: "computed_secondary_structure" } } });
        if (representation === "json") expect(recovered.provider_response).toEqual(native);
        expect(result.structuredContent._meta.citation.result_hash).toBe(await hashCanonicalJson(recovered));
        const verified = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation,
          structuredContent: result.structuredContent, toolArguments: { code }, materialized: { value: recovered } });
        expect(verified.verification).toMatchObject({ query: "verified", result: "verified", quarantined: false });
      }
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  } finally { f.close(); }
});

it.each([64, 20000])("retains native structure error evidence (%i characters) with both MCP response fields", async length => {
  const f = fixture();
  const text = "<html>" + 'α \\"'.repeat(length) + "</html>";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { status: 503, headers: { "retry-after": "60" } })));
  try {
    for (const prefix of ["", "mcp_"]) {
      const code = " \nreturn await api.get('/rna/{urs}/2d/svg/', {urs:'URS0000049E57'});\n";
      const result = await f.tools[`${prefix}rnacentral_execute`].handler({ code }, {});
      expect(result).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false } });
      const marker = result.structuredContent.error?.details?.data ?? result.structuredContent.data?.data;
      if (length === 20000) expect(marker).toMatchObject({ __staged: true, data_access_id: expect.any(String), _staging: expect.any(Object) });
      const recovered = length === 20000 ? await recover(f, marker.data_access_id, prefix) : marker;
      expect(recovered).toMatchObject({ operation: "secondary_structure", availability: "not_established",
        observation: { native_text: text, native_body_complete: true, http_status: 503, retry_after: "60", decoded_utf8_sha256: expect.any(String) } });
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30720);
      const verified = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation,
        structuredContent: result.structuredContent, toolArguments: { code } });
      expect(verified.verification).toMatchObject({ query: "verified", result: "verified", quarantined: false });
    }
  } finally { f.close(); }
});
