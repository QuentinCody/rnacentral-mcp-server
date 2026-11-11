import type { ApiEndpoint } from "@bio-mcp/shared/codemode/catalog";

export const scimodomEndpoints: ApiEndpoint[] = [
  ...[
    ["release", "Discover Sci-ModoM's native release metadata; distinct from RNAcentral releases."],
    ["rna_types", "Discover supported RNA-type identifiers before modification queries."],
    ["taxa", "Discover organisms available in Sci-ModoM."],
    ["dataset/list_all", "List public Sci-ModoM dataset metadata; retain source publications, assay and sample context."],
  ].map(([path, summary]): ApiEndpoint => ({ method: "GET", path: `/scimodom/${path}`, category: "scimodom", summary,
    example: `return await api.get('/scimodom/${path}');` })),
  {
    method: "GET", path: "/scimodom/assembly/{taxa_id}", category: "scimodom",
    summary: "Read Sci-ModoM's assembly context for a species before comparing genomic coordinates. Does not pin later queries.",
    pathParams: [{ name: "taxa_id", type: "number", required: true, description: "NCBI taxonomy ID from /scimodom/taxa." }],
    example: "return await api.get('/scimodom/assembly/{taxa_id}', {taxa_id: 9606});",
  },
  {
    method: "GET", path: "/scimodom/modification/query/gene", category: "scimodom",
    summary: "Page Sci-ModoM modification sites contained within a genomic interval, restricted by the provider to sites with genomic annotations. Preserves native measurements and dataset identity. Not a gene-membership query or a transcript-coordinate lookup.",
    usageHint: "First inspect /scimodom/rna_types, /scimodom/taxa, /scimodom/release and /scimodom/assembly/{taxa_id}. Response native.records and native.totalRecords use firstRecord/maxRecords paging; tied sort positions and changing data preclude a snapshot-completeness guarantee. Use dataset/list_all for study context. Empty results do not establish unmodified bases.",
    queryParams: [
      { name: "taxaId", type: "number", required: true, description: "NCBI taxonomy ID, not provider organism ID." },
      { name: "rnaType", type: "string", required: true, description: "Exact supported identifier discovered at /scimodom/rna_types." },
      { name: "chrom", type: "string", required: true, description: "Provider chromosome name; do not silently rewrite chr prefixes." },
      { name: "chromStart", type: "number", required: true, description: "Zero-based inclusive start." },
      { name: "chromEnd", type: "number", required: true, description: "Exclusive end, greater than start; at most 1,000,000 bases per request." },
      { name: "firstRecord", type: "number", required: false, default: 0, description: "Zero-based offset." },
      { name: "maxRecords", type: "number", required: false, default: 100, description: "Page size 1–1000. Entire responses over 4 MiB fail; decrease this value." },
    ],
  },
];
