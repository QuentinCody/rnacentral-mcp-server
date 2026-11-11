import type { Completeness } from "@bio-mcp/shared";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const total = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function page(rows: unknown[], count: unknown, detail: string): Completeness {
  const available = total(count);
  return { complete: false, returned: rows.length, ...(available === undefined ? {} : { total_available: available }),
    truncation: { reason: available !== undefined && available > rows.length ? "page_limit" : "unknown", detail,
      remedy: "Retain native paging, release and assembly evidence. Separate live reads are not an atomic snapshot; SQL child rows are not source record totals." } };
}

function direct(data: Record<string, unknown>): Completeness | undefined {
  if (record(data._scimodom)) {
    const native = data.native;
    if (record(native) && Array.isArray(native.records)) return page(native.records, native.totalRecords,
      "One Sci-ModoM region page of annotated contained sites; neither all modification sites nor transcript membership.");
    if (Array.isArray(native)) return page(native, undefined, "One mutable Sci-ModoM discovery response, not a pinned dataset snapshot.");
  }
  if (Array.isArray(data.entries) && "hitCount" in data) return page(data.entries, data.hitCount,
    "One EBI Search page. Gene-member fields may be truncated and duplicated upstream; entry totals do not count transcripts.");
  if (Array.isArray(data.results) && "count" in data) return page(data.results, data.count,
    "One RNAcentral collection response; records and nested annotations have distinct count semantics.");
  const evidence = record(data.meta) && record(data.meta.rnacentral) ? data.meta.rnacentral : undefined;
  if (evidence?.coverage_complete === false) {
    const coverage = page(Array.isArray(data.provider_response) ? data.provider_response : [], undefined,
      "A sequence job observation does not attest complete database coverage or RNACG membership.");
    if (!Array.isArray(data.provider_response)) {
      if (total(evidence.result_count) !== undefined) coverage.returned = total(evidence.result_count);
      else delete coverage.returned;
    }
    return coverage;
  }
  return undefined;
}

/** Preserve source limits through inline, staged and composed programs. */
export function rnaCompleteness(value: unknown): Completeness | undefined {
  const pending = [value]; const observations: Completeness[] = [];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    const coverage = record(item) ? direct(item) : undefined;
    if (coverage) observations.push(coverage);
    else if (record(item) && item.__staged === true) {
      if (record(item._staging) && record(item._staging.completeness) && item._staging.completeness.complete === false)
        observations.push({ ...item._staging.completeness, complete: false });
    } else pending.push(...Object.values(item));
  }
  if (observations.length < 2) return observations[0];
  return { complete: false, truncation: { reason: "unknown", detail: "Composed RNAcentral/Sci-ModoM evidence contains multiple independently bounded observations.",
    remedy: "Keep each source's pagination, release, assembly and count semantics separately." } };
}
