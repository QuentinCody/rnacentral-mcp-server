import type { ApiEndpoint, ParamDef } from "@bio-mcp/shared/codemode/catalog";

const rnaSpecies: ParamDef[] = [
  { name: "urs", type: "string", required: true, description: "URS plus 10 hexadecimal characters, without a taxid suffix." },
  { name: "taxid", type: "number", required: true, description: "NCBI taxonomy ID." },
];
const paging: ParamDef[] = [
  { name: "page", type: "number", required: false, description: "One-based page number. Follow next; one page is not the entire dataset." },
  { name: "page_size", type: "number", required: false, description: "Results per page, at most 100." },
];

export const evidenceEndpoints: ApiEndpoint[] = [
  {
    method: "GET", path: "/search/", category: "genes",
    summary: "Search RNAcentral's EBI Search index for predicted genes and transcripts using field queries. Gene IDs (RNACG) differ from transcript URS IDs.",
    queryParams: [
      { name: "query", type: "string", required: true, description: "EBI Search query, e.g. entry_type:Gene AND NCBI_TAXONOMY_ID:9606 AND MIR29B2CHG, or id:RNACG48157878589.2." },
      { name: "fields", type: "string", required: false, description: "Comma-separated fields, e.g. id,description,entry_type,gene_member,NCBI_TAXONOMY_ID. Multi-valued fields may be limited upstream; gene_member is not a complete transcript census." },
      { name: "size", type: "number", required: false, default: 10, description: "Page size, integer 1–100." },
      { name: "start", type: "number", required: false, default: 0, description: "Zero-based result offset; compare with hitCount." },
    ],
    example: "return await api.get('/search/', {query: 'id:RNACG48157878589.2', fields: 'id,description,entry_type,gene_member,NCBI_TAXONOMY_ID', size: 1});",
  },
  {
    method: "GET", path: "/search/fields/", category: "discovery",
    summary: "Discover EBI Search field capabilities, index update date and release version. This index's release is not proof that every REST record or expert database is synchronized.",
    example: "return await api.get('/search/fields/');",
  },
  {
    method: "GET", path: "/rna/{urs}/genes/{taxid}/", category: "genes", pathParams: rnaSpecies,
    summary: "Find predicted, versioned RNACG gene groupings for a transcript and species. Preserve genomic coordinates and IDs; these are computational groupings, not direct experimental evidence or guaranteed Ensembl equivalents.",
    example: "return await api.get('/rna/{urs}/genes/{taxid}/', {urs: 'URS0000D59DC9', taxid: 9606});",
  },
  {
    method: "GET", path: "/rna/{urs}/xrefs/{taxid}/", category: "modifications", pathParams: rnaSpecies, queryParams: paging,
    summary: "Species-specific source records, including modification arrays where supplied. Preserve position versus author_assigned_position, chemical component/source, accession, method and publication links. Empty arrays are not evidence of an unmodified RNA.",
    example: "return await api.get('/rna/{urs}/xrefs/{taxid}/', {urs: 'URS00001BBAFC', taxid: 562, page_size: 10});",
  },
  {
    method: "GET", path: "/rna/{urs}/sequence-features/{taxid}/", category: "annotations", pathParams: rnaSpecies, queryParams: paging,
    summary: "Sequence features such as conserved structures and anticodons, retaining feature_name, positions and metadata. Evidence types differ; this route is not claimed to supply Sci-ModoM genome-browser track sites.",
    example: "return await api.get('/rna/{urs}/sequence-features/{taxid}/', {urs: 'URS00001BBAFC', taxid: 562});",
  },
  {
    method: "GET", path: "/rna/{urs}/qc-status/{taxid}/", category: "annotations", pathParams: rnaSpecies,
    summary: "QC flags including coding-potential checks (tcode/stopfree when supplied), contamination and Rfam issues. Preserve individual flags and messages; computational QC does not establish a transcript's biological function.",
    example: "return await api.get('/rna/{urs}/qc-status/{taxid}/', {urs: 'URS000075BC33', taxid: 9606});",
  },
  {
    method: "GET", path: "/rna/{urs}/genome-locations/{taxid}/", category: "genes", pathParams: rnaSpecies, queryParams: paging,
    summary: "Transcript genome locations derived from source records. Preserve strand, assembly and exon information where supplied; consult genome discovery before joining coordinates.",
    example: "return await api.get('/rna/{urs}/genome-locations/{taxid}/', {urs: 'URS000075BC33', taxid: 9606});",
  },
  {
    method: "GET", path: "/genomes/", category: "discovery", queryParams: paging,
    deprecated: true,
    summary: "Unavailable in live checks: the schema lists this route, but it returned an HTTP-200 HTML error page on 2026-09-27. Use /genome-browser/{species}/ and transcript genome-locations for assembly context.",
  },
  {
    method: "GET", path: "/genome-browser/{species}/", category: "discovery",
    summary: "Retrieve RNAcentral genome-browser assembly and default locus for a species; do not assume GRCh38 for every organism.",
    pathParams: [{ name: "species", type: "string", required: true, description: "Species slug, e.g. homo_sapiens." }],
    example: "return await api.get('/genome-browser/{species}/', {species: 'homo_sapiens'});",
  },
  {
    method: "GET", path: "/expert-dbs/", category: "discovery",
    summary: "Expert database configuration, imported status, examples and version metadata where available. Preserve provider values even when they differ from release announcements; this is not a synchronized release guarantee.",
    example: "return await api.get('/expert-dbs/');",
  },
  {
    method: "GET", path: "/litsumm/", category: "generated-summaries", queryParams: paging,
    summary: "Browse AI-generated literature summaries, not experimental annotations. Retain the provider warning, cited papers, primary_id and generated-evidence metadata.",
    usageHint: "Start with page_size 10 and follow next. Live page_size 100 returned an HTML error page; smaller pages succeeded. Never treat an error page as an empty result.",
    example: "return await api.get('/litsumm/', {page_size: 1});",
  },
  {
    method: "GET", path: "/litsumm/{rna_id}/", category: "generated-summaries",
    summary: "Retrieve an AI-generated literature summary by its RNA name/identifier. Check assertions against original papers; primary_id identifies the linked RNAcentral transcript/species.",
    pathParams: [{ name: "rna_id", type: "string", required: true, description: "LitSumm RNA identifier, e.g. mmu-mir-191; not necessarily a URS ID." }],
    example: "return await api.get('/litsumm/{rna_id}/', {rna_id: 'mmu-mir-191'});",
  },
];
