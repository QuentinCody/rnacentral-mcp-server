import { afterEach, expect, it, vi } from "vitest";
import { createRnacentralApiFetch } from "./api-adapter";

afterEach(() => vi.unstubAllGlobals());

it("preserves RNAcentral paths, query strings and explicit format suffixes", async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ rnacentral_id: "URS00001BBAFC_562" }));
  vi.stubGlobal("fetch", fetch);
  const api = createRnacentralApiFetch();
  for (const path of ["/rna/URS00001BBAFC", "/rna/URS00001BBAFC/?page=2", "/rna/URS00001BBAFC?flat=true", "/rna/URS00001BBAFC.fasta", ""]) await api({ method: "GET", path });
  expect(fetch.mock.calls.map(c => String(c[0]))).toEqual([
    "https://rnacentral.org/api/v1/rna/URS00001BBAFC/", "https://rnacentral.org/api/v1/rna/URS00001BBAFC/?page=2",
    "https://rnacentral.org/api/v1/rna/URS00001BBAFC/?flat=true", "https://rnacentral.org/api/v1/rna/URS00001BBAFC.fasta", "https://rnacentral.org/api/v1/",
  ]);
});

it("retains modification positions and structural provenance without conflating numbering", async () => {
  const data = { count: 1898, next: "https://rnacentral.org/api/v1/rna/URS00001BBAFC/xrefs/562/?page=2", results: [{ database: "PDBe", modifications: [{ position: 21, author_assigned_position: 20, chem_comp: { id: "H2U", source: "PDB" } }] }] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
  expect(await createRnacentralApiFetch()({ method: "GET", path: "/rna/URS00001BBAFC/xrefs/562/" })).toMatchObject({ status: 200, data,
    upstreamTotal: 1898, completeness: { complete: false, returned: 1, total_available: 1898 } });
});

it("labels AI summaries and EBI Search at the adapter boundary", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ primary_id: "URS00005C2E31_10090" })));
  const api = createRnacentralApiFetch();
  expect(await api({ method: "GET", path: "/litsumm/mmu-mir-191" })).toHaveProperty("data.meta.rnacentral.experimental_evidence", false);
  expect(await api({ method: "GET", path: "/search", params: { query: "entry_type:Gene" } })).toHaveProperty("data.meta.rnacentral.evidence_type", "EBI Search index");
});

it("rejects unsupported methods instead of silently converting them to GET", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(createRnacentralApiFetch()({ method: "POST", path: "/rna/" })).rejects.toThrow("GET reads only");
  expect(fetch).not.toHaveBeenCalled();
});

it("retains HTTP errors and supports explicit non-JSON formats", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 })).mockResolvedValueOnce(new Response(">URS00001BBAFC\nACGU"));
  vi.stubGlobal("fetch", fetch);
  await expect(createRnacentralApiFetch()({ method: "GET", path: "/rna/invalid/" })).rejects.toMatchObject({ status: 404, data: "missing" });
  expect(await createRnacentralApiFetch()({ method: "GET", path: "/rna/URS00001BBAFC.fasta" })).toHaveProperty("data", ">URS00001BBAFC\nACGU");
});

it.each(["/litsumm/", "/genomes/", "/rna/URS00001BBAFC/"])("does not return HTTP-200 HTML as successful data for %s", async path => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>error</html>")));
  await expect(createRnacentralApiFetch()({ method: "GET", path })).rejects.toThrow("Expected JSON");
});

it.each([
  { path: "/search/", params: { query: "entry_type:Gene" }, status: 200, type: "application/json" },
  { path: "/rna/URS00001BBAFC.fasta", status: 200, type: "text/plain" },
  { path: "/rna/missing/", status: 404, type: "text/plain" },
])("bounds search, text exports and HTTP error bodies: %j", async ({ path, params, status, type }) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(4 * 1024 * 1024 + 1), { status, headers: { "content-type": type } })));
  await expect(createRnacentralApiFetch()({ method: "GET", path, params })).rejects.toThrow("exceeds 4 MiB");
});

it("does not silently discard a caller's GET body", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(createRnacentralApiFetch()({ method: "GET", path: "/rna/", body: {} })).rejects.toThrow("do not accept a body");
  expect(fetch).not.toHaveBeenCalled();
});
