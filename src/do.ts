import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class RnacentralDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        const obj = data as Record<string, unknown>;

        // Single RNA record (has URS/urs_taxid)
        if ((obj.rnacentral_id || obj.urs_taxid || obj.md5) && !Array.isArray(data)) {
            return {
                tableName: "rna_entry",
                indexes: ["rnacentral_id", "urs_taxid", "md5"],
            };
        }

        // Paginated list response { count, results: [...] }
        if (obj.results && Array.isArray(obj.results)) {
            const sample = obj.results[0] as Record<string, unknown> | undefined;
            if (sample) {
                if (sample.rnacentral_id || sample.urs_taxid) {
                    return {
                        tableName: "rna_entries",
                        indexes: ["rnacentral_id", "urs_taxid", "md5"],
                    };
                }
                if (sample.accession || sample.database) {
                    return {
                        tableName: "xrefs",
                        indexes: ["accession", "database", "taxid"],
                    };
                }
            }
        }

        return undefined;
    }
}
