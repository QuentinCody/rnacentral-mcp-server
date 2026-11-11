import type { ApiEndpoint, ParamDef } from "@bio-mcp/shared/codemode/catalog";

const identifiers: ParamDef[] = [{ name: "urs", type: "string", required: true,
  description: "URS plus 10 hexadecimal characters, optionally followed by _taxid. Lookup canonicalizes to uppercase and removes the suffix, as in the provider MCP; this is a sequence-level lookup." }];

export const structureEndpoints: ApiEndpoint[] = [
  { method: "GET", path: "/rna/{urs}/2d/", category: "secondary-structure", pathParams: identifiers,
    summary: "Read precomputed R2DT secondary structure JSON, preserving data.layout (SVG), data.secondary_structure (dot-bracket) and every other native field. Computed template-based evidence, not an assertion of experimental validation.",
    usageHint: "Fixed-host read, bounded to 4 MiB and 30 seconds. No query parameters. Large layouts stage through the normal SQL tools; errors preserve source evidence. Release is not pinned.",
    example: "return await api.get('/rna/{urs}/2d/', {urs:'URS0000049E57'});" },
  { method: "GET", path: "/rna/{urs}/2d/svg/", category: "secondary-structure", pathParams: identifiers,
    summary: "Read the provider's precomputed secondary-structure SVG as native text with source URL, retrieval time and SHA-256. SVG markup is retained without rendering, XML entity expansion or fetching embedded references.",
    usageHint: "Use /2d/ for native JSON and dot-bracket context. A failed or missing diagram does not prove a biologically unstructured RNA. The adapter recognizes the SVG root but does not perform full XML validation.",
    example: "return await api.get('/rna/{urs}/2d/svg/', {urs:'URS0000049E57_9606'});" },
];
