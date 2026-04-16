import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { rnacentralFetch } from "./http";

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
    // Don't add a trailing slash to obvious file extensions (none expected on RNAcentral)
    return basePart + "/" + rest;
}

export function createRnacentralApiFetch(): ApiFetchFn {
    return async (request) => {
        const path = ensureTrailingSlash(request.path);
        const response = await rnacentralFetch(path, request.params);

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(
                `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
            ) as Error & { status: number; data: unknown };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();
            return { status: response.status, data: text };
        }
        const data = await response.json();
        return { status: response.status, data };
    };
}
