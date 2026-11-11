import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";

export const EXPORT_BASE = "https://export.rnacentral.org";
export const validTaskId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function exportRequest(request: Parameters<ApiFetchFn>[0]) {
  const path = request.path.replace(/\/$/, "");
  const params = request.params ?? {};
  if (path === "/exports" && request.method === "POST") {
    const body = request.body as Record<string, unknown> | undefined;
    if (Object.keys(params).length || !body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => !["query", "format"].includes(key)) ||
        typeof body.query !== "string" || !body.query.trim() || body.query.length > 8192 ||
        typeof body.format !== "string" || !["fasta", "parquet"].includes(body.format)) {
      throw new Error("Export submission requires only a query (1–8192 characters) and format fasta or parquet in the JSON body");
    }
    const apiUrl = new URL("https://www.ebi.ac.uk/ebisearch/ws/rest/rnacentral");
    apiUrl.searchParams.set("query", body.query);
    apiUrl.searchParams.set("format", "json");
    // Live OpenAPI uses /submit/; the slashless path redirects before submission.
    return { url: `${EXPORT_BASE}/submit/`, method: "POST", format: String(body.format), taskId: null,
      body: JSON.stringify({ api_url: apiUrl.href, data_type: body.format }) };
  }
  const match = path.match(/^\/exports\/([A-Za-z0-9_-]{1,128})$/);
  if (!match || request.method !== "GET" || request.body !== undefined ||
      Object.keys(params).some(key => key !== "format") ||
      (params.format !== undefined && (typeof params.format !== "string" || !["fasta", "parquet"].includes(params.format)))) {
    throw new Error("Export status requires GET /exports/{task_id}, no body, and optional format fasta or parquet");
  }
  return { url: `${EXPORT_BASE}/status/${match[1]}`, method: "GET", body: undefined,
    format: params.format === undefined ? null : String(params.format), taskId: match[1] };
}
