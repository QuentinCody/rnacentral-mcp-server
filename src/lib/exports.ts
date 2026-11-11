import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { EXPORT_BASE, exportRequest, validTaskId } from "./export-request";
import { readRnaText } from "./read";

/** Submit once or read one saved job; never poll, replay, or download an artifact implicitly. */
export const exportFetch: ApiFetchFn = async (request) => {
  const operation = exportRequest(request);
  const submitting = operation.method === "POST";
  const controller = new AbortController();
  const deadline = Date.now() + 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let response: Response | undefined;
  let raw: string | undefined;
  let native: unknown;
  try {
    const pending = fetch(operation.url, { method: operation.method, body: operation.body,
      headers: { Accept: "application/json", ...(submitting ? { "Content-Type": "application/json" } : {}) },
      redirect: "manual", signal: controller.signal });
    // A fetch implementation may ignore abort and resolve after the deadline.
    void pending.then(late => { if (controller.signal.aborted) void late.body?.cancel().catch(() => undefined); }, () => undefined);
    response = await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("RNAcentral export request timed out")); }, 30_000);
    })]);
    raw = await readRnaText(response, deadline);
    try { native = JSON.parse(raw); } catch { native = raw; }
    return buildExportReceipt(response, native, operation, raw, submitting);
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
      status: response && !response.ok ? response.status : 502,
      data: { source_url: operation.url, http_status: response?.status ?? null,
        retry_after: response?.headers.get("retry-after") ?? null,
        location: response?.headers.get("location") ?? null,
        provider_response: native, native_text: raw, native_body_complete: raw !== undefined,
        submission_state_unknown: submitting, task_id: operation.taskId,
      },
    });
  } finally { clearTimeout(timer); controller.abort(); }
};

function buildExportReceipt(response: Response, native: unknown, operation: { url: string; method: string; format: string; taskId: null; body: string; } | { url: string; method: string; body: undefined; format: string | null; taskId: string; }, raw: string, submitting: boolean) {
  if (!response.ok) throw new Error(`RNAcentral export HTTP ${response.status}`);
  if (!native || typeof native !== "object" || Array.isArray(native)) throw new Error("RNAcentral export returned an invalid JSON object");
  const payload = native as Record<string, unknown>;
  if (operation.taskId && payload.task_id !== undefined && payload.task_id !== operation.taskId) {
    throw new Error("RNAcentral export status returned a different task ID");
  }
  const taskId = operation.taskId ?? (validTaskId(payload.task_id) ? payload.task_id : null);
  return {
    status: response.status, data: {
      provider_response: native, native_text: raw,
      meta: {
        rnacentral: {
          source_url: operation.url, retrieved_at: new Date().toISOString(), http_status: response.status,
          retry_after: response.headers.get("retry-after"), task_id: taskId,
          location: response.headers.get("location"),
          provider_state: payload.state ?? payload.status ?? null,
          status_url: taskId ? `${EXPORT_BASE}/status/${taskId}` : null,
          download_url: taskId && operation.format ? `${EXPORT_BASE}/download/${taskId}/${operation.format}` : null,
          format: operation.format, download_verified: false, release_pinned: false,
          submission_state_unknown: submitting && !taskId,
          guidance: "Save the native receipt and task ID. Read status separately; do not resubmit after timeouts. Download URL is a provider-defined candidate, not verified availability. Export selection is not complete RNACG gene membership or a pinned historical release.",
        }
      },
    }
  };
}
