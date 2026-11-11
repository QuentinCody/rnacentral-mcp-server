import { type ApiFetchFn, commercialUseRefusal } from "@bio-mcp/shared/codemode/catalog";
import { rnacentralFetch } from "./http";
import { annotateRnaEvidence, searchRequest } from "./search";
import { scimodomFetch } from "./scimodom";
import { readNativeBody, parseNativeJson } from "./native-response";
import { rnaCompleteness } from "./completeness";
import { exportFetch } from "./exports";
import { sequenceSearchFetch } from "./sequence-search";
import { structureFetch } from "./structure";

/**
 * Preserve the RNAcentral trailing-slash convention: collection and record
 * paths require it to avoid redirects. Query-string suffixes are normalised
 * so the slash lives before `?`.
 */
function ensureTrailingSlash(path: string): string {
    if (!path) return "/";
    const qIdx = path.indexOf("?");
    const basePart = qIdx === -1 ? path : path.slice(0, qIdx);
    const rest = qIdx === -1 ? "" : path.slice(qIdx);
    if (basePart.endsWith("/")) return path;
    if (/\.(json|fasta|yaml|api)$/.test(basePart)) return path;
    return basePart + "/" + rest;
}

export function createRnacentralApiFetch(): ApiFetchFn {
    return async (request) => {
        if (request.path.startsWith("/rna/") && /\/2d(?:[/?#]|$)/i.test(request.path)) return structureFetch(request);
        if (request.path === "/sequence-search" || request.path.startsWith("/sequence-search/")) return sequenceSearchFetch(request);
        if (request.path === "/exports" || request.path.startsWith("/exports/")) return exportFetch(request);
        // License audit 2026-11-10: RNAcentral is CC0. Sci-ModoM states no data
        // license (its software is AGPL-3.0).
        if (request.licenseProfile === "commercial" && (request.path === "/scimodom" || request.path.startsWith("/scimodom/"))) {
            return commercialUseRefusal("The Sci-ModoM routes (/scimodom/)", "Sci-ModoM states no data license; RNAcentral stays available");
        }
        if (request.path.startsWith("/scimodom/")) return scimodomFetch(request);
        if (request.method !== "GET") throw new Error("RNAcentral supports GET reads only.");
        if (request.body !== undefined) throw new Error("RNAcentral GET reads do not accept a body.");
        const deadline = Date.now() + 30_000;
        const path = ensureTrailingSlash(request.path);
        const response = path.startsWith("/search/") ? await searchRequest({ ...request, path }) : await rnacentralFetch(path, request.params);
        const text = await readNativeBody(response, deadline);

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const textFormat = ["fasta", "yaml", "api", "jsonp"].includes(String(request.params?.format)) || /\.(fasta|yaml|api)$/.test(path);
            if (textFormat) return { status: response.status, data: text };
        }
        const data = annotateRnaEvidence(path, parseNativeJson(text, response, ""));
        const completeness = rnaCompleteness(data);
        return { status: response.status, data, ...(completeness ? { completeness, upstreamTotal: completeness.total_available ?? null } : {}) };
    };
}
