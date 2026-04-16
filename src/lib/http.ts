import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const RNACENTRAL_BASE = "https://rnacentral.org/api/v1";

export interface RnacentralFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the RNAcentral API.
 * Collection and record paths require a TRAILING SLASH to avoid redirects.
 */
export async function rnacentralFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: RnacentralFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? RNACENTRAL_BASE;
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503, 504],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "rnacentral-mcp-server/1.0 (bio-mcp)",
    });
}
