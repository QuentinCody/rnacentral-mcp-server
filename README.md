# rnacentral-mcp-server

MCP server wrapping the [RNAcentral API](https://rnacentral.org/api) and its EBI Search index for non-coding RNA sequences and predicted gene groupings.

Runs on Cloudflare Workers. Exposes four tools: Code Mode (`rnacentral_search`, `rnacentral_execute`) plus staging (`rnacentral_query_data`, `rnacentral_get_schema`), each also registered with its `mcp_` alias.

- Upstream docs: https://rnacentral.org/api and [live OpenAPI](https://rnacentral.org/api/schema/swagger-ui/)
- Base URL: `https://rnacentral.org/api/v1`
- Local dev port: 8880
- Category focus: RNA entries, predicted genes, source modifications, computed secondary structures, QC, literature summaries and species/accession metadata.

The adapter normalizes collection/record paths with a trailing slash and preserves explicit format suffixes. Data reads accept bodyless GETs; `/exports/` and `/sequence-search/jobs/` additionally accept the explicit POSTs described below. Unsupported methods or request bodies fail rather than silently being discarded. RNAcentral and EBI Search responses, including text exports and HTTP error bodies, have a 4 MiB byte limit and share a 30-second request/body deadline. Oversized responses fail explicitly; narrow the query or page size. UTF-8 decoding preserves characters split across network chunks and rejects invalid encoding.

Gene discovery uses the same EBI Search source used by the [provider's MCP](https://github.com/RNAcentral/rnacentral-mcp-server). Search supports `query`, `fields`, `size` (1–100) and zero-based `start`:

```javascript
return await api.get('/search/', {
  query: 'entry_type:Gene AND NCBI_TAXONOMY_ID:9606 AND MIR29B2CHG',
  fields: 'id,description,entry_type,gene_member,NCBI_TAXONOMY_ID', size: 5
});
```

`/search/fields/` discovers field capabilities and the index's release/update metadata. A gene's `gene_member` field can be truncated upstream and contain duplicates; do not treat it as a complete transcript list. `/rna/{urs}/genes/{taxid}/` maps an individual transcript to versioned RNACG gene groupings. These are computational predictions, labeled in `meta.rnacentral`, and are not automatically equivalent to Ensembl genes. `/genome-browser/{species}/` and `/rna/{urs}/genome-locations/{taxid}/` provide assembly and coordinate context. The schema-listed `/genomes/` route returned an HTTP-200 HTML error page during validation and is marked unavailable in discovery; the adapter rejects such pages rather than presenting them as data.

For modification evidence, use `/rna/{urs}/xrefs/{taxid}/` and retain each source accession, chemical component, `position`, `author_assigned_position` and publication links. An observed PDBe example is `URS00001BBAFC` / taxid `562`; its two position systems differ. Paginate using `next`; empty modification arrays do not prove absence of modifications. `/sequence-features/` provides other annotations, while `/qc-status/` preserves individual coding-potential and quality flags.

`/litsumm/` and `/litsumm/{rna_id}/` expose **AI-generated literature summaries**, with `experimental_evidence: false` in `meta.rnacentral`. Preserve provider warnings, primary transcript IDs and citations, then verify assertions against the papers. Example RNA identifier: `mmu-mir-191`. Start listing with `page_size: 10` and follow `next`; a live request for 100 returned an HTML error page while 10 and 20 succeeded.

Large results use the existing staging/SQL tools, including source and evidence metadata. For annotated search, gene-grouping and summary responses, local labels remain at `meta.rnacentral`; any original provider `meta` value is retained verbatim at `meta.upstream`, including keys that collide with local labels. Other top-level native fields remain unchanged. `/expert-dbs/` reports source configuration and versions where available; observed source metadata can lag release announcements, so it must not be treated as synchronized release provenance.

Release 27's [Sci-ModoM integration](https://blog.rnacentral.org/2026/07/rnacentral-release-27.html) is a genome-browser track hub for human GRCh38 and mouse GRCm39. The Worker now provides separate, bounded reads from Sci-ModoM's public REST API, based on its [route implementation](https://raw.githubusercontent.com/dieterich-lab/scimodom/master/server/src/scimodom/api/modification.py) and [discovery routes](https://github.com/dieterich-lab/scimodom/blob/master/server/src/scimodom/api/utilities.py), reviewed September 30, 2026. This does not download the browser tracks or establish parity with their pinned snapshots.

| Code Mode path | Purpose |
| --- | --- |
| `/scimodom/release` | Native release metadata |
| `/scimodom/rna_types` | RNA-type identifiers for queries |
| `/scimodom/taxa` | Organism discovery |
| `/scimodom/assembly/{taxa_id}` | Provider assembly context |
| `/scimodom/dataset/list_all` | Dataset, assay and source metadata |
| `/scimodom/modification/query/gene` | Paged sites contained in a genomic interval, restricted to sites with genomic annotations |

First discover the source context:

```javascript
return {
  release: await api.get('/scimodom/release'),
  rnaTypes: await api.get('/scimodom/rna_types'),
  taxa: await api.get('/scimodom/taxa'),
  assembly: await api.get('/scimodom/assembly/{taxa_id}', {taxa_id: 9606})
};
```

The region query requires `taxaId`, a discovered `rnaType`, `chrom`, `chromStart`
and `chromEnd`. Coordinates are zero-based and half-open, with a maximum interval
of one million bases. It selects contained sites rather than arbitrary overlaps.
`firstRecord` is a zero-based offset; `maxRecords` defaults to 100 and is capped
at 1000. Compare `native.records` with `native.totalRecords`, preserving repeated
observations across pages. Tied positions and mutable data prevent a snapshot
completeness guarantee. This query is not an RNACG gene-member lookup.

Responses preserve provider JSON under `native`, with separate `_scimodom`
source context. Preserve `dataset_id`, technology, cell/tissue, modification,
score, coverage and frequency when interpreting measurements. Zero score or
coverage can mean unavailable information; empty results do not establish an
unmodified base. See the [bedRMod conventions](https://dieterich-lab.github.io/scimodom/bedrmod.html).
No assembly is inferred from taxonomy or RNAcentral's release announcement.

Sci-ModoM reads are bodyless GETs with a 30-second deadline, no automatic retries
or redirects, and a 4 MiB response cap. Oversized native reads fail explicitly;
large accepted results retain the existing staging/SQL flow. Whole MCP success
and error envelopes over 30 KiB also stage with both response fields retained.

Tests use synthetic provider-shaped fixtures; public Sci-ModoM data, live MCP/SQL acceptance
and complete RNACG membership remain unverified under the current network/runtime
restrictions. Precomputed structure reads are described below; this integration
does not claim full provider-MCP parity.

## Precomputed secondary structures

The [provider MCP implementation](https://github.com/RNAcentral/rnacentral-mcp-server/blob/main/rnacentral_sequence_search/structure.py)
and R2DT widget [routes](https://github.com/RNAcentral/r2dt-web/blob/master/src/routes.js)
and [JSON consumer](https://github.com/RNAcentral/r2dt-web/blob/master/src/app.js),
reviewed October 2, 2026, establish these existing read endpoints:

```javascript
return await api.get('/rna/{urs}/2d/', {urs: 'URS0000049E57'});
```

The JSON representation is retained under `provider_response`, including
`data.layout` (SVG), `data.secondary_structure` (dot-bracket) and unknown fields.
For the native SVG text representation:

```javascript
return await api.get('/rna/{urs}/2d/svg/', {urs: 'URS0000049E57_9606'});
```

Lookup uses the uppercase base URS, removing the optional taxid suffix as in the
provider MCP. The supplied identifier and suffix remain in `meta.rnacentral`,
with `lookup_scope: "sequence"` and `taxid_used_for_lookup: false`. These are
[computed R2DT structures](https://rnacentral.org/help/secondary-structure),
separate from experimental modification evidence. A missing or failed diagram
does not prove absence of biological structure, and no historical release is pinned.

Both reads retain native text, source URL, retrieval time, content type, ETag,
Last-Modified, Retry-After and decoded-text SHA-256; JSON also has a canonical
parsed-response hash. SVG markup is inert text: no rendering, entity expansion
or embedded URL retrieval occurs. Root recognition is explicit and does not
claim full XML validation. BOMs, Unicode and line endings are preserved.

Reads accept no query parameters or body, use a 4 MiB cap and one 30-second
header/body deadline, and do not retry or follow redirects. Failed HTTP or
representation checks retain their complete source evidence when available;
incomplete body reads remain explicitly incomplete. Large results and errors
use the existing Code Mode/staging/SQL tools. Fixture validation reconstructs
complete JSON/SVG layouts and errors from the production staging class through
both aliases. Fresh provider and local Worker acceptance remain pending.

## FASTA and Parquet export jobs

Release 27 advertises sequence exports. The provider's [export client](https://github.com/RNAcentral/rnacentral-mcp-server/blob/main/rnacentral_sequence_search/search.py) and [service configuration](https://github.com/RNAcentral/rnacentral-mcp-server/blob/main/rnacentral_sequence_search/utils.py) establish the submit/status/download workflow. October 3 native acceptance revalidated the [live export OpenAPI](https://export.rnacentral.org/openapi.json): submission requires `/submit/` and JSON fields `api_url` and `data_type`. The older client's slashless URL now returns HTTP 307; the Worker uses the canonical URL directly and retains redirect `Location` on failures without replaying POST.

`POST /exports/` creates one provider job for an explicit EBI Search query:

```javascript
return await api.post('/exports/', {
  query: 'NCBI_TAXONOMY_ID:9606 AND mir-191', format: 'fasta'
});
```

Save the returned task ID, then read status in a separate call:

```javascript
return await api.get('/exports/{task_id}/', {
  task_id: 'saved-task-id', format: 'fasta'
});
```

Formats are `fasta` and `parquet`. Submission makes one request without automatic
retries; status reads do not poll. Responses retain the native object and decoded
response text, unknown states, HTTP failures and Retry-After. Missing submission
IDs or transport failures leave acceptance uncertain: do not resubmit automatically.
Download links are candidates derived from the provider contract, not verified
artifacts. No download or Hugging Face publication occurs. Export selection does
not establish complete RNACG membership or a pinned historical release.

Export responses share the 4 MiB/30-second bounds and existing Code Mode staging
flow. Synthetic tests cover the actual Code Mode proxy, native receipts, failures,
timeouts and full large-response staging. October 3 native/Worker acceptance
submitted separate single-record FASTA and Parquet jobs. FASTA completed; its
601-byte gzip download contained one 1,338-base sequence matching the source
after T/U normalization. Parquet returned a saved task ID, then native `FAILURE`
with a database-connection error; successful Parquet artifact validation remains
pending. The Worker does not download artifacts implicitly.

## Sequence-similarity jobs

The provider's [sequence-search client](https://github.com/RNAcentral/rnacentral-mcp-server/blob/main/rnacentral_sequence_search/search.py)
and [service configuration](https://github.com/RNAcentral/rnacentral-mcp-server/blob/main/rnacentral_sequence_search/utils.py),
reviewed October 2, 2026, specify submission, status and result operations at
`https://search.rnacentral.org`. These are existing provider capabilities newly
exposed through this Worker's Code Mode catalog.

Submit once, keeping the native receipt and `meta.rnacentral.job_id`:

```javascript
return await api.post('/sequence-search/jobs/', { query: '>query\nACGUACGU\n' });
```

The sequence is passed verbatim. Optional `databases` contains provider database
identifiers; omission uses the provider client's empty-list default. Local bounds
are 100,000 UTF-8 query bytes and 25 identifiers of at most 128 characters each.
The provider validates sequence syntax and database names.

Read a saved job's status in a separate call:

```javascript
return await api.get('/sequence-search/jobs/{job_id}/', { job_id: 'saved-job-id' });
```

Retrieve results after completion:

```javascript
return await api.get('/sequence-search/jobs/{job_id}/results/', { job_id: 'saved-job-id' });
```

Result retrieval checks status once and reads the hit array only for native
`success` or `partial_success`. It preserves all returned hits, scores, alignment
fields, unknown fields and the status observation. It does not truncate to the
provider MCP's display preview. Native JSON, decoded response text, source URLs,
retrieval times and canonical JSON hashes remain available through staging/SQL.
Similarity is not proof of exact sequence identity, function or complete RNACG
membership; no historical release is pinned.

No call polls, retries or follows redirects. The status and result requests share
a 30-second deadline, with a 4 MiB limit per response. A missing receipt or failed
submission leaves acceptance uncertain; preserve `submission_state_unknown` and
any recovered job ID rather than automatically submitting again. Uncaught API
errors return `isError: true` with native evidence or its staged reference.
Programs may still catch API errors explicitly. Programs that crash after a
staged read retain the evidence and an explicit failure flag. Full composed
responses also stage above 30 KiB, with a hash covering the preserved response.

Validation uses fixtures and the production staging class over in-memory SQLite.
An October 3 live submission of a public 77-base RNA returned HTTP 500 with a
complete native HTML error and no job ID. The Worker preserved that evidence,
its citation and `submission_state_unknown`; the submission was not retried.
Positive sequence-job/result acceptance remains pending upstream availability.

Code Mode citations bind to the exact submitted JavaScript, including surrounding
whitespace. API error capture runs inside the generated isolate program and
preserves native status/data without changing that query identity. Inline and
staged results retain independently verifiable query/result hashes through both
tool aliases.

## October 3 native acceptance

Native receipts dated October 4 UTC qualify gene search and transcript grouping,
source modification records, QC, genome locations/browser assembly, sequence
features, expert databases, AI literature summaries, precomputed R2DT JSON/SVG,
and all Sci-ModoM discovery/region reads. EBI discovery reports release 27.
Six MIR29B2CHG gene entries span two search pages; native `gene_member` duplicates
and truncation remain explicit. This does not establish complete RNACG membership.
Sci-ModoM reports 163 datasets / 7,952,319 sites; two 100-row human region pages
retain a native total of 20,091 sites, measurements, dataset IDs and assay context.
These observations do not pin browser-track snapshots or a synchronized release.

SVG retrieval now uses the provider-compatible `Accept: */*`; an SVG-only
header received HTTP 406. Complete bounded upstream errors remain available;
non-JSON/partial bodies cannot masquerade as successful JSON. Sci-ModoM header
and body deadlines also bound uncooperative streams and cancellation.

Search, SQL, schema and program-error responses now carry verifiable citations.
Source coverage survives inline, staged and composed results. Explicit SQL
projections preserve record/child relationships without guessed sparse indexes
or `_rowid` collisions. Original payloads remain recoverable through `payloads`
and chunk storage. SQL's omitted limit defaults inside the handler, preserving
the caller's signed arguments.

Read acceptance passed **788 local MCP calls**, including **770 inline and 18
staged citation proofs** through both aliases. Largest structured content was
21,935 bytes; largest whole envelope was 29,085 bytes. Export receipts/status
and native failures were checked separately. **207 focused tests**, 13 static
checks, TypeScript, scoped lint, dry bundle, nine live contract checks, full
Vitest and `check:affected` pass. Local Workerd used installed public CA roots
with TLS verification enabled; production trust/deployment remain unverified.

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from RNAcentral (+ Sci-ModoM) and stays under the terms of that source: RNAcentral CC0; Sci-ModoM: no data license found (software AGPL-3.0).
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
