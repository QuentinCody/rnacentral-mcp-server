import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { hashCanonicalJson } from "@bio-mcp/shared";
import { fetchScimodomBody, parseNativeJson } from "./native-response";
import { rnaCompleteness } from "./completeness";

const BASE = "https://scimodom.dieterichlab.org/api/v0";
const DISCOVERY = new Set(["/release", "/rna_types", "/taxa", "/dataset/list_all"]);

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function regionParams(input: Record<string, unknown>): Record<string, string | number> {
  const allowed = ["taxaId", "rnaType", "chrom", "chromStart", "chromEnd", "firstRecord", "maxRecords"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Unsupported Sci-ModoM region parameter.");
  const taxaId = integer(input.taxaId, "taxaId", 1, Number.MAX_SAFE_INTEGER);
  const chromStart = integer(input.chromStart, "chromStart", 0, Number.MAX_SAFE_INTEGER);
  const chromEnd = integer(input.chromEnd, "chromEnd", chromStart + 1, chromStart + 1_000_000);
  if (typeof input.chrom !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(input.chrom)) throw new Error("A provider chromosome name is required.");
  if (typeof input.rnaType !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(input.rnaType)) throw new Error("Discover rnaType using /scimodom/rna_types.");
  return { taxaId, rnaType: input.rnaType, chrom: input.chrom, chromStart, chromEnd,
    firstRecord: integer(input.firstRecord ?? 0, "firstRecord", 0, Number.MAX_SAFE_INTEGER),
    maxRecords: integer(input.maxRecords ?? 100, "maxRecords", 1, 1000) };
}

function requestUrl(request: Parameters<ApiFetchFn>[0]): URL {
  if (request.method !== "GET" || request.body !== undefined) throw new Error("Sci-ModoM supports bodyless GET reads only.");
  const path = request.path.slice("/scimodom".length).replace(/\/$/, "");
  let params: Record<string, unknown> = request.params ?? {};
  if (path === "/modification/query/gene") params = regionParams(params);
  else {
    if (!DISCOVERY.has(path) && !/^\/assembly\/[1-9]\d*$/.test(path)) throw new Error("Unsupported Sci-ModoM read route.");
    if (Object.keys(params).length) throw new Error("Sci-ModoM discovery accepts no query parameters.");
  }
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}

/** Separate native provider response and provenance; do not overwrite provider fields. */
export const scimodomFetch: ApiFetchFn = async request => {
  const url = requestUrl(request);
  const { response, text } = await fetchScimodomBody(url.toString());
  const native = parseNativeJson(text, response, "Sci-ModoM ");
  const data = {
    native,
    _scimodom: {
      source_url: url.toString(), retrieved_at: new Date().toISOString(), api_version: "v0",
      native_sha256: await hashCanonicalJson(native),
      evidence_type: "provider-reported RNA modification data",
      coordinate_system: "0-based half-open; provider chromosome names",
      query_semantics: "Region queries select contained sites with genomic annotations; not all sites or transcript membership.",
      release: null, assembly: null, snapshot_verified: false,
      guidance: "Retain /release and /assembly/{taxa_id} separately. Discovery does not pin this mutable query. Preserve dataset_id, score, coverage, frequency and technology; zero score/coverage may mean unavailable. A page or empty result does not establish absence of modification.",
    },
  };
  const completeness = rnaCompleteness(data);
  return { status: response.status, data, ...(completeness ? { completeness, upstreamTotal: completeness.total_available ?? null } : {}) };
};
