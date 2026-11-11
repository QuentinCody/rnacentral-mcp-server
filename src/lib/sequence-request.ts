import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";

export const SEQUENCE_BASE = "https://search.rnacentral.org";
export const validJobId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export interface SequenceRequest {
  operation: "submit" | "status" | "results";
  jobId: string | null;
  body?: string;
}

/** Local bounds, not inferred provider limits. Preserve the submitted sequence verbatim. */
export function sequenceRequest(request: Parameters<ApiFetchFn>[0]): SequenceRequest {
  const path = request.path.replace(/\/$/, "");
  if (Object.keys(request.params ?? {}).length) throw new Error("Sequence jobs accept no query parameters");
  if (path === "/sequence-search/jobs" && request.method === "POST") {
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["query", "databases"].includes(key))) {
      throw new Error("Sequence submission requires a JSON object containing query and optional databases");
    }
    if (typeof body.query !== "string" || !body.query.trim() || new TextEncoder().encode(body.query).byteLength > 100_000) {
      throw new Error("Sequence query must contain 1–100000 UTF-8 bytes");
    }
    const databases = body.databases === undefined ? [] : body.databases;
    if (!Array.isArray(databases) || databases.length > 25 || databases.some(value => typeof value !== "string" || !value.trim() || value.length > 128)) {
      throw new Error("databases must contain at most 25 provider database identifiers, each 1–128 characters");
    }
    return { operation: "submit", jobId: null, body: JSON.stringify({ query: body.query, databases }) };
  }
  const match = path.match(/^\/sequence-search\/jobs\/([A-Za-z0-9_-]{1,128})(\/results)?$/);
  if (!match || request.method !== "GET" || request.body !== undefined) throw new Error("Use POST /sequence-search/jobs, GET /sequence-search/jobs/{job_id}, or GET /sequence-search/jobs/{job_id}/results");
  return { operation: match[2] ? "results" : "status", jobId: match[1] };
}
