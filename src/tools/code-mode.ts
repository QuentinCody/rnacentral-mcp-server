import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { rnacentralCatalog } from "../spec/catalog";
import { createRnacentralApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    RNACENTRAL_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(server: McpServer, env: CodeModeEnv): void {
    const apiFetch = createRnacentralApiFetch();

    const searchTool = createSearchTool({
        prefix: "rnacentral",
        catalog: rnacentralCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "rnacentral",
        // Verifiable provenance: rnacentral_execute results carry a _meta.citation.
        source: { id: "rnacentral", name: "RNAcentral", url: "https://rnacentral.org", license: "CC0 1.0" },
        catalog: rnacentralCatalog,
        apiFetch,
        doNamespace: env.RNACENTRAL_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
