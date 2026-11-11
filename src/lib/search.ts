import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { rnacentralFetch } from "./http";

const SEARCH_BASE = "https://www.ebi.ac.uk/ebisearch/ws/rest/rnacentral";

/** EBI Search indexes gene entries as well as URS transcripts. */
export function searchRequest(request: Parameters<ApiFetchFn>[0]): Promise<Response> {
  const path = request.path.replace(/\/$/, "");
  if (path !== "/search" && path !== "/search/fields") throw new Error("Unsupported RNAcentral search path.");
  const params = { ...request.params };
  if (path === "/search/fields") {
    if (Object.keys(params).length) throw new Error("Search field discovery accepts no query parameters.");
  } else {
    if (typeof params.query !== "string" || !params.query.trim()) throw new Error("RNAcentral search requires a nonempty query.");
    for (const name of Object.keys(params)) {
      if (!["query", "size", "start", "fields"].includes(name)) throw new Error(`Unsupported search parameter: ${name}`);
    }
    params.size = params.size ?? 10;
    params.start = params.start ?? 0;
    if (!Number.isInteger(params.size) || Number(params.size) < 1 || Number(params.size) > 100) throw new Error("Search size must be an integer from 1 to 100.");
    if (!Number.isSafeInteger(params.start) || Number(params.start) < 0) throw new Error("Search start must be a nonnegative safe integer.");
  }
  return rnacentralFetch("", { ...params, format: "json" }, { baseUrl: SEARCH_BASE });
}

export function annotateRnaEvidence(path: string, data: unknown): unknown {
  let evidence: Record<string, unknown>;
  if (path.startsWith("/litsumm/")) {
    evidence = { evidence_type: "AI-generated literature summary", experimental_evidence: false, guidance: "Verify assertions against cited papers; retain the provider's warning and primary_id." };
  } else if (/\/genes\/\d+\//.test(path)) {
    evidence = { evidence_type: "predicted gene grouping", guidance: "RNACG versioned IDs group related transcripts; these are not automatically equivalent to curated Ensembl genes." };
  } else if (path.startsWith("/search")) {
    evidence = { evidence_type: "EBI Search index", source_url: SEARCH_BASE, guidance: "Search results are paged. Multi-valued fields, including gene_member, may be truncated upstream; do not treat them as a complete transcript list. Discover index release and fields at /search/fields/." };
  } else return data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Expected an RNAcentral JSON object.");
  // Keep an upstream meta value verbatim, including scalars and colliding keys.
  const upstream = Object.prototype.hasOwnProperty.call(data, "meta") ? { upstream: (data as Record<string, unknown>).meta } : {};
  return { ...data, meta: { ...upstream, rnacentral: evidence } };
}
