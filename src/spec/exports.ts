import type { ApiEndpoint } from "@bio-mcp/shared/codemode/catalog";

export const exportEndpoints: ApiEndpoint[] = [
  {
    method: "POST", path: "/exports/", category: "exports",
    summary: "Submit one RNAcentral FASTA or Parquet export job for an explicit EBI Search query. Creates a provider job; save its native task receipt. No automatic retry, polling, artifact download or Hugging Face publication.",
    body: { contentType: "application/json", description: 'Only {query: string (1–8192 characters), format: "fasta" | "parquet"}. Include desired taxon/source filters in the EBI Search query. Arbitrary URLs are not accepted.' },
    usageHint: "The provider's own export client establishes submit/status/download contracts. This adapter submits once; preserve task_id and use GET /exports/{task_id}/ later. A timeout can mean an accepted job with a lost receipt; do not automatically retry. Data release and complete gene membership are not attested.",
  },
  {
    method: "GET", path: "/exports/{task_id}/", category: "exports",
    summary: "Read a saved RNAcentral export job once, preserving native state, errors and result metadata. Does not create a job or wait for completion.",
    pathParams: [{ name: "task_id", type: "string", required: true, description: "Task ID from the native submission receipt; 1–128 letters, digits, hyphens or underscores." }],
    queryParams: [{ name: "format", type: "string", required: false, enum: ["fasta", "parquet"], description: "Original submission format, if known; adds a candidate download link without fetching it. Never inferred from missing state." }],
    usageHint: "Read provider_response.state/status and preserve unknown states. download_verified remains false even when the provider says the job completed; no file checksum or release pin is established.",
  },
];
