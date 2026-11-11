import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";
import { evidenceEndpoints } from "./evidence";
import { scimodomEndpoints } from "./scimodom";
import { exportEndpoints } from "./exports";
import { sequenceSearchEndpoints } from "./sequence-search";
import { structureEndpoints } from "./structure";

/**
 * RNAcentral API catalog.
 * All collection and record paths include a TRAILING SLASH — the upstream API
 * issues 301 redirects without it, which lose query parameters. The adapter
 * also re-adds a slash defensively.
 */
export const rnacentralCatalog: ApiCatalog = {
    name: "RNAcentral",
    baseUrl: "https://rnacentral.org/api/v1",
    version: "v1",
    auth: "none",
    endpointCount: 8 + evidenceEndpoints.length + scimodomEndpoints.length + exportEndpoints.length + sequenceSearchEndpoints.length + structureEndpoints.length,
    notes:
        "- /rna/{urs}/2d/ and /rna/{urs}/2d/svg/ retrieve precomputed R2DT structures as native JSON/SVG text. Lookup uses the base URS sequence even when a taxid suffix is supplied. Computed structures remain separate from experimental modification evidence; large layouts use normal staging.\n" +
        "- /sequence-search/jobs/ submits a provider similarity-search job. Save its receipt and read status/results separately; partial_success is not complete coverage or exact identity.\n" +
        "- /exports/ submits a FASTA/Parquet job to the provider export service; /exports/{task_id}/ reads its saved status. Submit once, preserve receipts, and never assume job completion or gene-member completeness.\n" +
        "- RNAcentral record/collection paths require a TRAILING SLASH; omitting it returns 301 redirects.\n" +
        "- URS identifiers look like `URS0000000001` or `URS0000000001_9606` (with taxid).\n" +
        "- List responses use Django REST Framework paging: `{ count, next, previous, results: [...] }`.\n" +
        "- Start with `rna/` for browsing and `rna/<URS>/` / `rna/<URS>/xrefs/` for targeted lookups.\n" +
        "- Keep `page_size` ≤ 100 for prompt responses.\n" +
        "- /search/ uses the separate EBI Search index: entry_type:Gene finds predicted RNACG genes; gene_member can be truncated upstream. /rna/{urs}/genes/{taxid}/ maps a transcript back to its gene groupings.\n" +
        "- LitSumm routes return AI-generated summaries with meta.rnacentral labels; these are not experimental evidence. Gene groupings are computational predictions.\n" +
        "- Modification arrays belong to individual source xrefs. Keep sequence position and author-assigned position distinct. /scimodom/* reads the separate Sci-ModoM API, preserving native measurements and its own source/release/assembly context; genomic sites are not sequence-feature coordinates. These routes use no trailing slash upstream.\n" +
        "- /search/fields/ reports index release; /expert-dbs/ reports source metadata. Neither is a synchronized release guarantee for all REST data.",
    endpoints: [
        ...evidenceEndpoints,
        ...scimodomEndpoints,
        ...exportEndpoints,
        ...sequenceSearchEndpoints,
        ...structureEndpoints,
        {
            method: "GET",
            path: "/rna/",
            summary: "List / search RNA sequences — paginated browse endpoint.",
            category: "rna",
            queryParams: [
                { name: "page", type: "number", required: false, description: "Page number (1-based)." },
                { name: "page_size", type: "number", required: false, description: "Page size (default 10, max 100)." },
                { name: "md5", type: "string", required: false, description: "Filter by MD5 hash of the sequence." },
                { name: "external_id", type: "string", required: false, description: "Filter by external accession." },
                { name: "database", type: "string", required: false, description: "Filter by source database (e.g. 'miRBase', 'Rfam')." },
            ],
        },
        {
            method: "GET",
            path: "/rna/{urs}/",
            summary: "Get a single RNA entry by URS identifier.",
            category: "rna",
            pathParams: [
                { name: "urs", type: "string", required: true, description: "RNAcentral URS identifier (e.g. 'URS0000000001' or 'URS0000000001_9606')." },
            ],
        },
        {
            method: "GET",
            path: "/rna/{urs}/xrefs/",
            summary: "List cross-references for an RNA entry (external databases with the same sequence).",
            category: "rna",
            pathParams: [
                { name: "urs", type: "string", required: true, description: "URS identifier." },
            ],
            queryParams: [
                { name: "page", type: "number", required: false, description: "Page number." },
                { name: "page_size", type: "number", required: false, description: "Page size." },
            ],
        },
        {
            method: "GET",
            path: "/rna/{urs}/{taxid}/",
            summary: "Get the species-specific record for a URS (URS × taxid).",
            category: "rna",
            pathParams: [
                { name: "urs", type: "string", required: true, description: "URS identifier (without _taxid)." },
                { name: "taxid", type: "number", required: true, description: "NCBI taxonomy ID (e.g. 9606 for human)." },
            ],
        },
        {
            method: "GET",
            path: "/rna/{urs}/publications/{taxid}/",
            summary: "Publications referencing an RNA entry for a given species.",
            category: "rna",
            queryParams: [
                { name: "page", type: "number", required: false, description: "One-based page number; follow next." },
                { name: "page_size", type: "number", required: false, description: "Results per page, at most 100." },
            ],
            pathParams: [
                { name: "urs", type: "string", required: true, description: "URS identifier." },
                { name: "taxid", type: "number", required: true, description: "NCBI taxonomy ID." },
            ],
        },
        {
            method: "GET",
            path: "/accession/{accession}/citations/",
            summary: "Literature citations linked to a source-database accession.",
            category: "accessions",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Source-database accession (e.g. 'MI0000001' for miRBase)." },
            ],
        },
        {
            method: "GET",
            path: "/accession/{accession}/info/",
            summary: "Metadata for a source-database accession (organism, RNA type, description).",
            category: "accessions",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Source-database accession." },
            ],
        },
        // NOTE: /organisms/ and /expert-databases/ were removed from the
        // catalog on 2026-04-17 — upstream returned HTTP 404. RNAcentral's
        // taxonomy and source-database metadata is now expressed through
        // /rna/{urs}/xrefs/ and the accession endpoints.
        {
            method: "GET",
            path: "/rna/{urs}/go-annotations/{taxid}/",
            summary: "GO term annotations for an RNA entry in a given species.",
            category: "annotations",
            pathParams: [
                { name: "urs", type: "string", required: true, description: "URS identifier." },
                { name: "taxid", type: "number", required: true, description: "NCBI taxonomy ID." },
            ],
        },
    ],
};
