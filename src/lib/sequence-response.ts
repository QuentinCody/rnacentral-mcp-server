import { hashCanonicalJson } from "@bio-mcp/shared";
import { readRnaText } from "./read";

export interface SequenceObservation {
  source_url: string;
  retrieved_at: string;
  http_status: number | null;
  retry_after: string | null;
  native_body_complete: boolean;
  parsed_response_sha256: string | null;
  provider_response?: unknown;
  native_text?: string;
}

/** One request with a shared operation deadline; never retries or follows redirects. */
export async function readSequenceResponse(url: string, deadline: number, body?: string): Promise<SequenceObservation> {
  const observation: SequenceObservation = { source_url: url, retrieved_at: new Date().toISOString(), http_status: null,
    retry_after: null, native_body_complete: false, parsed_response_sha256: null };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (Date.now() >= deadline) throw new Error("Sequence search deadline exceeded");
    const pending = fetch(url, { method: body === undefined ? "GET" : "POST", body,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      redirect: "manual", signal: controller.signal });
    void pending.then(late => { if (controller.signal.aborted) void late.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Sequence search deadline exceeded")); }, Math.max(0, deadline - Date.now()));
    })]);
    observation.http_status = response.status;
    observation.retry_after = response.headers.get("retry-after");
    observation.native_text = await readRnaText(response, deadline);
    observation.native_body_complete = true;
    try { observation.provider_response = JSON.parse(observation.native_text); }
    catch { throw new Error("Sequence search returned non-JSON data"); }
    observation.parsed_response_sha256 = await hashCanonicalJson(observation.provider_response);
    if (!response.ok) throw new Error(`Sequence search HTTP ${response.status}`);
    if (Date.now() >= deadline) throw new Error("Sequence search deadline exceeded");
    return observation;
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { observation });
  } finally { clearTimeout(timer); controller.abort(); }
}
