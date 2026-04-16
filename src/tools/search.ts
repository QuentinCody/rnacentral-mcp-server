import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { rnacentralFetch } from "../lib/http";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

interface SearchEnv {
    RNACENTRAL_DATA_DO?: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(req: Request): Promise<Response> };
    };
}

/**
 * Simple URS lookup over the RNAcentral API.
 * For advanced queries (xrefs, publications, etc.) use Code Mode rnacentral_execute.
 */
export function registerSearch(server: McpServer, env?: SearchEnv): void {
    server.registerTool(
        "rnacentral_lookup",
        {
            title: "Lookup RNAcentral entry",
            description:
                "Get a single RNA entry from RNAcentral by URS identifier (e.g. URS0000000001 or URS0000000001_9606).",
            inputSchema: {
                urs: z
                    .string()
                    .min(1)
                    .describe("RNAcentral URS identifier (e.g. URS0000000001). Accepts URS alone or URS_taxid."),
            },
        },
        async (args, extra) => {
            const runtimeEnv = env || (extra as { env?: SearchEnv })?.env;
            try {
                const response = await rnacentralFetch(`/rna/${args.urs}/`);

                if (!response.ok) {
                    const body = await response.text().catch(() => "");
                    throw new Error(
                        `RNAcentral API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`,
                    );
                }

                const data = await response.json();

                const responseSize = JSON.stringify(data).length;
                if (shouldStage(responseSize) && runtimeEnv?.RNACENTRAL_DATA_DO) {
                    const staged = await stageToDoAndRespond(
                        data,
                        runtimeEnv.RNACENTRAL_DATA_DO as DurableObjectNamespace,
                        "rna_entry",
                        undefined,
                        undefined,
                        "rnacentral",
                        (extra as { sessionId?: string })?.sessionId,
                    );
                    return createCodeModeResponse(
                        {
                            staged: true,
                            data_access_id: staged.dataAccessId,
                            total_rows: staged.totalRows,
                            _staging: staged._staging,
                            message: `Entry staged. Use rnacentral_query_data with data_access_id '${staged.dataAccessId}' to query.`,
                        },
                        { meta: { staged: true, data_access_id: staged.dataAccessId } },
                    );
                }

                return createCodeModeResponse(
                    { data },
                    { meta: { fetched_at: new Date().toISOString() } },
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return createCodeModeError("API_ERROR", `rnacentral_lookup failed: ${msg}`);
            }
        },
    );
}
