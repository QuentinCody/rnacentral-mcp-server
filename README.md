# rnacentral-mcp-server

MCP server wrapping the [RNAcentral API](https://rnacentral.org/help/api) — EMBL-EBI's unified database of non-coding RNA sequences from 40+ expert databases (miRBase, Rfam, Ensembl, snoDB, etc.).

Runs on Cloudflare Workers. Exposes four Code Mode tools (`rnacentral_search`, `rnacentral_execute`, `rnacentral_query_data`, `rnacentral_get_schema`) plus a convenience `rnacentral_lookup`.

- Upstream docs: https://rnacentral.org/help/api
- Base URL: `https://rnacentral.org/api/v1`
- Local dev port: 8880
- Category focus: RNA entries, cross-references, species/accession metadata, and GO annotations.

RNAcentral requires a **trailing slash** on collection/record paths to avoid 301 redirects that drop query parameters. Slashes are baked into catalog paths and defensively re-added by the api-adapter.
