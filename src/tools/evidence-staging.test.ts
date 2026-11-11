import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { hashCanonicalJson, verifyCitationEnvelope } from "@bio-mcp/shared";
import { fixture, recover } from "./staging-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const note = "β\"\\".repeat(11000);

it.each([
  { path: "/search/", params: { query: "entry_type:Gene" }, table: "search_entries", total: 6,
    native: { hitCount: 6, entries: [{ id: "RNACG1.2", fields: { gene_member: ["URS1_9606", "URS1_9606"], description: [note] } }] } },
  { path: "/rna/URS00001BBAFC/xrefs/562/", table: "xrefs", total: 1898,
    native: { count: 1898, next: "page2", results: [{ database: "PDBe", taxid: 562, accession: { id: "3CW5_A_1", description: note }, modifications: [{ position: 21, author_assigned_position: 20, chem_comp: { id: "H2U" } }] }] } },
  { path: "/scimodom/modification/query/gene", params: { taxaId: 9606, rnaType: "WTS", chrom: "1", chromStart: 0, chromEnd: 1000 }, table: "modification_sites", total: 2500,
    native: { totalRecords: 2500, records: [{ dataset_id: "source", score: 0, coverage: 0, frequency: 17, start: 0, end: 1, meta: { note } }] } },
])("recovers exact $table evidence, pages and SQL parents through both aliases", async ({ path, params, native, table, total }) => {
  const f = fixture(); vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try {
    for (const prefix of ["", "mcp_"]) {
      const args = { code: `return await api.get(${JSON.stringify(path)}, ${JSON.stringify(params ?? {})});` };
      const result = await f.tools[prefix + "rnacentral_execute"].handler(args, {});
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const sc = result.structuredContent;
      expect(sc._meta.completeness).toMatchObject({ complete: false, returned: 1, total_available: total });
      const recovered = await recover(f, sc.data.data_access_id, prefix);
      expect(recovered.native ?? { ...recovered, meta: undefined }).toMatchObject(native);
      expect(sc._meta.citation.result_hash).toBe(await hashCanonicalJson(recovered));
      const sqlArgs = { data_access_id: sc.data.data_access_id, sql: `SELECT count(*) AS n FROM ${table}` };
      const sql = await f.tools[prefix + "rnacentral_query_data"].handler(sqlArgs, {});
      expect(sql.structuredContent.data.rows).toEqual([{ n: 1 }]);
      const verified = await verifyCitationEnvelope({ citation: sql.structuredContent._meta.citation,
        structuredContent: sql.structuredContent, toolArguments: sqlArgs });
      expect(verified.verification).toMatchObject({ query: "verified", result: "verified" });
    }
  } finally { f.close(); }
});

it("stages escaped SQL results containing generated row IDs without collisions", async () => {
  const f = fixture(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ rnacentral_id: "URSfixture", description: note })));
  try {
    const result = await f.tools.rnacentral_execute.handler({ code: "return await api.get('/rna/{urs}/', {urs:'URSfixture'});" }, {});
    const id = result.structuredContent.data.data_access_id;
    const args = { data_access_id: id, sql: "SELECT * FROM rna_entry" };
    const query = await f.tools.rnacentral_query_data.handler(args, {});
    expect(query).toMatchObject({ structuredContent: { success: true, staged: true } });
    const original = await recover(f, query.structuredContent.data_access_id, "mcp_");
    expect(original.structuredContent.data.rows[0]).toMatchObject({ _rowid: 1, rnacentral_id: "URSfixture", description: note });
    const verified = await verifyCitationEnvelope({ citation: query.structuredContent._meta.citation,
      structuredContent: query.structuredContent, toolArguments: args, materialized: { value: original } });
    expect(verified.verification).toMatchObject({ query: "verified", result: "verified" });
  } finally { f.close(); }
});

it("cites discovery and program errors and keeps composition coverage conservative", async () => {
  const f = fixture(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hitCount: 8, entries: [{ id: "RNACG1" }] })));
  try {
    for (const prefix of ["", "mcp_"]) {
      for (const [suffix, args] of [["search", { query: "genes", max_results: 2 }], ["execute", { code: "throw new Error('test failure');" }]] as const) {
        const result = await f.tools[prefix + "rnacentral_" + suffix].handler(args, {});
        const verified = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation,
          structuredContent: result.structuredContent, toolArguments: args });
        expect(verified.verification).toMatchObject({ query: "verified", result: "verified" });
        expect(result.isError === true).toBe(suffix === "execute");
      }
    }
    const result = await f.tools.rnacentral_execute.handler({ code: "return {first: await api.get('/search/', {query:'gene'}), second: await api.get('/search/', {query:'gene2'})};" }, {});
    expect(result.structuredContent._meta.completeness).toMatchObject({ complete: false, truncation: { reason: "unknown" } });
    expect(result.structuredContent._meta.completeness.total_available).toBeUndefined();
  } finally { f.close(); }
});
