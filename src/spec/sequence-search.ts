import type { ApiEndpoint } from "@bio-mcp/shared/codemode/catalog";

const job = [{ name: "job_id", type: "string" as const, required: true, description: "Saved provider job ID; 1–128 letters, digits, hyphens or underscores." }];
export const sequenceSearchEndpoints: ApiEndpoint[] = [
  { method: "POST", path: "/sequence-search/jobs/", category: "sequence-search",
    summary: "Submit one RNAcentral sequence-similarity search job and retain the native receipt. No automatic retry or polling.",
    body: { contentType: "application/json", description: "{query: sequence string, databases?: provider database ID strings[]}. Query is preserved verbatim; local limits: 100000 UTF-8 bytes and 25 database IDs of at most 128 characters. Omitted databases uses the provider client's empty-list selection." },
    usageHint: "Creates a provider job. Save job_id before a later status read. A failed request can mean an accepted job with a lost receipt; never resubmit automatically. Database identifiers and sequence syntax are validated by the provider.",
  },
  { method: "GET", path: "/sequence-search/jobs/{job_id}/", category: "sequence-search", pathParams: job,
    summary: "Read one saved sequence-search status. Preserve unknown states, native errors and Retry-After; does not submit or poll.",
  },
  { method: "GET", path: "/sequence-search/jobs/{job_id}/results/", category: "sequence-search", pathParams: job,
    summary: "Check status once, then read the complete native hit array only for success or partial_success. Large results stage for SQL.",
    usageHint: "Retains every returned hit, alignment field, score and native status; partial_success remains explicit. Similarity does not establish exact identity or complete database/gene coverage. At most two GETs share a 30-second deadline; each response is limited to 4 MiB.",
  },
];
