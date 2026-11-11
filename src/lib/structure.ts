import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { hashCanonicalJson } from "@bio-mcp/shared";
import { readStructureResponse, type StructureObservation } from "./structure-response";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function selection(request: Parameters<ApiFetchFn>[0]) {
  const match = request.path.match(/^\/rna\/(URS[A-F0-9]{10})(?:_([1-9]\d{0,9}))?\/2d(\/svg)?\/?$/i);
  if (request.method !== "GET" || request.body !== undefined || Object.keys(request.params ?? {}).length || !match) {
    throw Object.assign(new Error("Use body-free GET /rna/{urs}/2d/ or /rna/{urs}/2d/svg/ without query parameters; urs is URS plus 10 hexadecimal characters and an optional positive taxid suffix"),
      { status: 400, data: { operation: "secondary_structure", request_valid: false } });
  }
  return { requested_id: request.path.split("/")[2], urs: match[1].toUpperCase(), taxid_suffix: match[2] ?? null, representation: match[3] ? "svg" : "json" };
}

/** Recognize the SVG root only; never render, resolve XML entities or claim full XML validation. */
function hasSvgRoot(text: string): boolean {
  let remaining = text.trimStart();
  while (remaining.startsWith("<?") || remaining.startsWith("<!--")) {
    const closing = remaining.startsWith("<?") ? "?>" : "-->";
    const end = remaining.indexOf(closing);
    if (end < 0) return false;
    remaining = remaining.slice(end + closing.length).trimStart();
  }
  // Recognize external DOCTYPE declarations without loading them. Internal subsets are not parsed.
  remaining = remaining.replace(/^<!DOCTYPE\s+svg\s+(?:[^>\["']|"[^"]*"|'[^']*')*>\s*/, "");
  return /^<svg(?:\s|\/?>)/.test(remaining);
}

/** Provider MCP + R2DT widget routes, reviewed 2026-10-02. */
export const structureFetch: ApiFetchFn = async request => {
  const selected = selection(request);
  const svg = selected.representation === "svg";
  const source = `https://rnacentral.org/api/v1/rna/${selected.urs}/2d/${svg ? "svg/" : ""}`;
  const observation: StructureObservation = { source_url: source, retrieved_at: new Date().toISOString(), http_status: null,
    content_type: null, etag: null, last_modified: null, retry_after: null, native_body_complete: false, decoded_utf8_sha256: null };
  let native: unknown;
  let parsedHash: string | null = null;
  try {
    const text = await readStructureResponse(source, svg, observation);
    if (svg) {
      if (!hasSvgRoot(text)) throw new Error("Secondary structure response does not begin with an SVG document");
    } else {
      try { native = JSON.parse(text.replace(/^\uFEFF/, "")); }
      catch { throw new Error("Secondary structure source returned non-JSON data"); }
      parsedHash = await hashCanonicalJson(native);
      if (!object(native) || !object(native.data) || typeof native.data.layout !== "string" || !hasSvgRoot(native.data.layout)) {
        throw new Error("Secondary structure JSON does not contain the provider's SVG layout at data.layout");
      }
    }
    return { status: 200, data: { ...observation, ...(svg ? {} : { provider_response: native, parsed_response_sha256: parsedHash }),
      meta: { rnacentral: { ...selected, operation: "secondary_structure", evidence_type: "computed_secondary_structure", method: "R2DT",
        lookup_scope: "sequence", taxid_used_for_lookup: false, release_pinned: false, experimental_validation_attested: false,
        svg_root_detected: true, svg_parsed: false,
        guidance: "Precomputed template-based structure. The provider looks up the base URS sequence, not the taxid suffix. Preserve native layout, dot-bracket and other fields; this read does not establish experimental validation or a historical release. SVG is returned as inert text, without rendering or fetching embedded references.",
      } } } };
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
      status: observation.http_status && observation.http_status >= 300 ? observation.http_status : 502,
      data: { operation: "secondary_structure", ...selected, observation, ...(native === undefined ? {} : { provider_response: native, parsed_response_sha256: parsedHash }),
        availability: "not_established", release_pinned: false },
    });
  }
};
