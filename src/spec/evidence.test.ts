/// <reference types="node" />
import { runInNewContext } from "node:vm";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { afterEach, expect, it, vi } from "vitest";
import { createRnacentralApiFetch } from "../lib/api-adapter";
import { rnacentralCatalog } from "./catalog";
import { evidenceEndpoints } from "./evidence";

afterEach(() => vi.unstubAllGlobals());
it("executes discovery examples through the real API proxy with path parameters removed from query", async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ results: [] }));
  vi.stubGlobal("fetch", fetch);
  // SAFETY: small fixture responses never use staging or session capabilities.
  const proxy = createApiProxyTool({ catalog: rnacentralCatalog, apiFetch: createRnacentralApiFetch(), doNamespace: {} as DurableObjectNamespace, stagingPrefix: "rnacentral" });
  // SAFETY: no data handle is produced by these fixtures.
  const context = {} as Parameters<typeof proxy.handler>[1];
  const api = { get: (path: string, params?: Record<string, unknown>) => proxy.handler({ method: "GET", path, params }, context) };
  for (const endpoint of evidenceEndpoints.filter(e => e.example)) {
    const result = await runInNewContext(`(async()=>{${endpoint.example}})()`, { api });
    expect(result.__api_error).not.toBe(true);
  }
  const urls = fetch.mock.calls.map(call => new URL(String(call[0])));
  expect(urls.map(url => url.pathname)).toContain("/api/v1/rna/URS0000D59DC9/genes/9606/");
  expect(urls.every(url => !url.searchParams.has("urs") && !url.searchParams.has("taxid"))).toBe(true);
  expect(rnacentralCatalog.endpointCount).toBe(rnacentralCatalog.endpoints.length);
  expect(rnacentralCatalog.endpoints.some(e => e.path === "/rna/{urs}/publications/{taxid}/")).toBe(true);
});
