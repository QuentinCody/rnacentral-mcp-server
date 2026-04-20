import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

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
    endpointCount: 10,
    notes:
        "- RNAcentral record/collection paths require a TRAILING SLASH; omitting it returns 301 redirects.\n" +
        "- URS identifiers look like `URS0000000001` or `URS0000000001_9606` (with taxid).\n" +
        "- List responses use Django REST Framework paging: `{ count, next, previous, results: [...] }`.\n" +
        "- Start with `rna/` for browsing and `rna/<URS>/` / `rna/<URS>/xrefs/` for targeted lookups.\n" +
        "- Keep `page_size` ≤ 100 for prompt responses.",
    endpoints: [
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
            path: "/rna/{urs}/{taxid}/publications/",
            summary: "Publications referencing an RNA entry for a given species.",
            category: "rna",
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
