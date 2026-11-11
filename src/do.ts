import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export class RnacentralDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
      ? value.structuredContent.data : value;
    if (!record(data)) return data;
    // Wrap SQL rows so native or generated _rowid columns cannot collide with the new table's primary key.
    if (typeof data.sql === "string" && Array.isArray(data.rows)) return { query_rows: data.rows.map(native => ({ native })) };
    if (record(data._scimodom)) {
      if (record(data.native) && Array.isArray(data.native.records)) return { modification_sites: data.native.records };
      if (Array.isArray(data.native)) return { native: data.native };
    }
    if (Array.isArray(data.entries)) return { search_entries: data.entries };
    if (Array.isArray(data.results)) {
      const sample = data.results.find(record);
      const table = sample?.accession || sample?.database ? "xrefs" : sample?.gene_name ? "gene_groups" : "rna_entries";
      return { [table]: data.results };
    }
    if (data.rnacentral_id || data.urs_taxid || data.md5) return { rna_entry: [data] };
    return data;
  }
}
