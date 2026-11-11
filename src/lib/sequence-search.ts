import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { hashCanonicalJson } from "@bio-mcp/shared";
import { SEQUENCE_BASE, SequenceRequest, sequenceRequest, validJobId } from "./sequence-request";
import { readSequenceResponse, type SequenceObservation } from "./sequence-response";

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function statusValue(observation: SequenceObservation, jobId: string): string {
  const native = object(observation.provider_response);
  if (observation.http_status !== 200 || !native || typeof native.status !== "string" || !native.status.trim() ||
      (native.job_id !== undefined && native.job_id !== jobId)) throw new Error("Sequence status has missing state or conflicting job identity");
  return native.status;
}

/** Provider MCP contract: submit-job, job-status, job-result on search.rnacentral.org. */
export const sequenceSearchFetch: ApiFetchFn = async (request) => {
  const operation = sequenceRequest(request);
  const deadline = Date.now() + 30_000;
  const observations: SequenceObservation[] = [];
  let jobId = operation.jobId;
  let providerState: string | null = null;
  const requestHash = await hashCanonicalJson(operation.body === undefined ? { job_id: jobId } : JSON.parse(operation.body));
  const observe = async (path: string, body?: string) => {
    const value = await readSequenceResponse(`${SEQUENCE_BASE}/api/${path}`, deadline, body);
    observations.push(value); return value;
  };
  try {
    if (operation.operation === "submit") {
      const receipt = await observe("submit-job", operation.body);
      const native = object(receipt.provider_response);
      if (validJobId(native?.job_id)) jobId = native.job_id;
      if (receipt.http_status !== 201 || !jobId) throw new Error("Sequence submission did not return a verified HTTP-201 job receipt; do not resubmit automatically");
      providerState = typeof native?.status === "string" ? native.status : null;
    } else {
      const status = await observe(`job-status/${jobId}`);
      providerState = statusValue(status, String(jobId));
      if (operation.operation === "results") {
        if (!["success", "partial_success"].includes(providerState)) throw new Error(`Sequence results are not ready (provider status: ${providerState})`);
        const result = await observe(`job-result/${jobId}`);
        if (result.http_status !== 200 || !Array.isArray(result.provider_response) || result.provider_response.some(row => !object(row))) {
          throw new Error("Sequence result is not the expected native hit array");
        }
      }
    }
    return buildSequenceReceipt(observations, operation, jobId, providerState, requestHash);
  } catch (error) {
    const failed = object(error)?.observation;
    if (failed) observations.push(failed as SequenceObservation);
    const status = observations[observations.length - 1]?.http_status;
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { status: status && status >= 300 ? status : 502,
      data: { observations, operation: operation.operation, job_id: jobId, provider_state: providerState,
        request_sha256: requestHash, submission_state_unknown: operation.operation === "submit" } });
  }
};

function buildSequenceReceipt(observations: SequenceObservation[], operation: SequenceRequest, jobId: string | null, providerState: string | null, requestHash: string) {
  const last = observations[observations.length - 1];
  return {
    status: last.http_status as number, data: {
      ...last, ...(observations.length > 1 ? { status_observation: observations[0] } : {}),
      meta: {
        rnacentral: {
          operation: operation.operation, job_id: jobId, provider_state: providerState,
          partial_success: providerState === "partial_success", request_sha256: requestHash,
          result_count: Array.isArray(last.provider_response) ? last.provider_response.length : null,
          release_pinned: false, coverage_complete: false, submission_state_unknown: false,
          guidance: "Preserve the job receipt. Status reads do not poll; results read status once first. Similarity scores and provider partial_success do not establish sequence identity, function or complete RNACG membership.",
        }
      },
    }
  };
}
