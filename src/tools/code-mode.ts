import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { rnacentralCatalog } from "../spec/catalog";
import { createRnacentralApiFetch } from "../lib/api-adapter";
import { rnaResponse } from "../lib/tool-result";

interface CodeModeEnv {
    RNACENTRAL_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(server: McpServer, env: CodeModeEnv): void {
    const apiFetch = createRnacentralApiFetch();
    const registrar = { tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof rnaResponse>;
        const respond = (input: unknown, extra: unknown) => rnaResponse(
            () => handler(input, extra), env, String(name), extra, input);
        // SAFETY: shared factories supply the SDK arguments; only the alias and response boundary change.
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
    } };

    const searchTool = createSearchTool({
        prefix: "rnacentral",
        catalog: rnacentralCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "rnacentral",
        // Verifiable provenance: rnacentral_execute results carry a _meta.citation.
        source: { id: "rnacentral", name: "RNAcentral and separate Sci-ModoM data", url: "https://rnacentral.org" },
        catalog: rnacentralCatalog,
        apiFetch,
        preserveApiErrors: true,
        doNamespace: env.RNACENTRAL_DATA_DO,
        loader: env.CODE_MODE_LOADER,
        maxInlineBytes: 30 * 1024,
        timeout: 60_000,
        stagingThreshold: 30 * 1024,
    });
    executeTool.register(registrar);
}
