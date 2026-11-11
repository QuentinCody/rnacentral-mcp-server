import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import type { ExecuteToolOptions } from "@bio-mcp/shared/codemode/execute-tool";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { rnaResponse } from "../lib/tool-result";
import { hashCanonicalJson } from "@bio-mcp/shared";

const captured = vi.hoisted(() => ({ options: [] as ExecuteToolOptions[] }));
vi.mock("@bio-mcp/shared/codemode/execute-tool", async importOriginal => {
  const actual = await importOriginal<typeof import("@bio-mcp/shared/codemode/execute-tool")>();
  return { ...actual, createExecuteTool: (options: ExecuteToolOptions) => { captured.options.push(options); return actual.createExecuteTool(options); } };
});
afterEach(() => { captured.options.length = 0; vi.unstubAllGlobals(); });

function registered() {
  const server = new McpServer({ name: "fixture", version: "1" });
  // SAFETY: invalid-code tests do not invoke the Worker loader.
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  registerQueryData(server, {}); registerGetSchema(server, {});
  // SAFETY: invoke the actual SDK callbacks to verify their aliases and result fields.
  return (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
}

function storage(stored: unknown[]) {
  return { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      const payload = await request.json() as { data: unknown }; stored.push(payload.data);
      return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 });
    }
    return Response.json({ success: true, schema: { tables: { payloads: { columns: [{ name: "payload_json" }] } } } });
  } }) };
}

it("registers all eight names and returns both fields for discovery and errors", async () => {
  const tools = registered();
  expect(Object.keys(tools).sort()).toEqual(["", "mcp_"].flatMap(prefix => ["search", "execute", "query_data", "get_schema"].map(name => `${prefix}rnacentral_${name}`)).sort());
  for (const prefix of ["", "mcp_"]) {
    expect(await tools[prefix + "rnacentral_search"].handler({ query: "scimodom", max_results: 10 }, {})).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    const exports = await tools[prefix + "rnacentral_search"].handler({ query: "parquet", max_results: 10 }, {});
    expect(JSON.stringify(exports)).toContain("/exports/");
    for (const [name, args] of [["execute", { code: "" }], ["query_data", { data_access_id: "fixture", sql: "SELECT 1" }], ["get_schema", { data_access_id: "fixture" }]] as const) {
      expect(await tools[prefix + "rnacentral_" + name].handler(args, {})).toMatchObject({ content: expect.any(Array), structuredContent: expect.any(Object), isError: true });
    }
  }
});

it("stages the entire native Sci-ModoM page together with source context", async () => {
  registered(); const options = captured.options[0];
  expect(options).toMatchObject({ maxInlineBytes: 30 * 1024, stagingThreshold: 30 * 1024 });
  const native = { totalRecords: 1000, records: [{ dataset_id: "fixture", score: 0, frequency: 23, description: "β".repeat(20000) }] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(native)));
  const stored: unknown[] = [];
  const proxy = createApiProxyTool({ apiFetch: options.apiFetch, catalog: options.catalog, doNamespace: storage(stored), stagingPrefix: "rnacentral", maxInlineBytes: options.maxInlineBytes });
  const result = await proxy.handler({ method: "GET", path: "/scimodom/modification/query/gene", params: { taxaId: 9606, rnaType: "WTS", chrom: "1", chromStart: 0, chromEnd: 1000 } }, { sql: () => [] });
  expect(result).toMatchObject({ __staged: true, data_access_id: expect.any(String), _staging: expect.any(Object) });
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toContainEqual(expect.objectContaining({ native, _scimodom: expect.objectContaining({ snapshot_verified: false, source_url: expect.stringContaining("scimodom.dieterichlab.org") }) }));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});

it.each([false, true])("stages full MCP success/error envelopes without losing error status: %s", async failed => {
  const stored: unknown[] = [];
  const original = { content: [{ type: "text" as const, text: "β".repeat(20000) }], structuredContent: { success: !failed, data: "native", _meta: { citation: { source_id: "rnacentral" } } }, ...(failed ? { isError: true } : {}) };
  const result = await rnaResponse(async () => original, { RNACENTRAL_DATA_DO: storage(stored) }, "rnacentral_execute", {});
  expect(result).toMatchObject({ structuredContent: { success: !failed, staged: true, _staging: expect.any(Object),
    _meta: { citation: { result_scope: "staged:full_result", result_hash: await hashCanonicalJson(original) } } } });
  expect(result.isError === true).toBe(failed);
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toContainEqual(original);
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});

it("returns an explicit bounded error if staging fails", async () => {
  const result = await rnaResponse(async () => ({ content: [{ type: "text", text: "x".repeat(40000) }] }), {}, "rnacentral_execute", {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: false, error: { code: "RESPONSE_ERROR" } }, isError: true });
});

it("retains the whole EBI Search page and colliding provider metadata through Code Mode staging", async () => {
  registered(); const options = captured.options[0];
  const native = { hitCount: 100, entries: [{ id: "RNACG48157878589.2", fields: { gene_member: ["URS0000D59DC9_9606"], description: ["β".repeat(20000)] } }], meta: { rnacentral: { release: "27" }, upstream: "provider" } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(native)));
  const stored: unknown[] = [];
  const proxy = createApiProxyTool({ apiFetch: options.apiFetch, catalog: options.catalog, doNamespace: storage(stored), stagingPrefix: "rnacentral", maxInlineBytes: options.maxInlineBytes });
  const result = await proxy.handler({ method: "GET", path: "/search/", params: { query: "id:RNACG48157878589.2", size: 1 } }, { sql: () => [] });
  expect(result).toMatchObject({ __staged: true, _staging: expect.any(Object) });
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toContainEqual({
    ...native, meta: { upstream: native.meta, rnacentral: expect.objectContaining({ guidance: expect.stringContaining("truncated") }) },
  });
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});
