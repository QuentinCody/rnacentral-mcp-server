import { readRnaText } from "./read";

export interface StructureObservation {
  source_url: string;
  retrieved_at: string;
  http_status: number | null;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  retry_after: string | null;
  native_body_complete: boolean;
  decoded_utf8_sha256: string | null;
  native_text?: string;
}

/** One bounded fixed-host read. The caller retains this observation on failure. */
export async function readStructureResponse(url: string, svg: boolean, observation: StructureObservation) {
  const deadline = Date.now() + 30_000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The provider's DRF negotiation rejects SVG-only Accept headers with 406 before rendering SVG.
    const pending = fetch(url, { method: "GET", headers: { Accept: svg ? "*/*" : "application/json" },
      redirect: "manual", signal: controller.signal });
    void pending.then(late => { if (controller.signal.aborted) void late.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Secondary structure read exceeded 30 seconds")); }, Math.max(0, deadline - Date.now()));
    })]);
    observation.http_status = response.status;
    observation.content_type = response.headers.get("content-type");
    observation.etag = response.headers.get("etag");
    observation.last_modified = response.headers.get("last-modified");
    observation.retry_after = response.headers.get("retry-after");
    observation.native_text = await readRnaText(response, deadline, true);
    observation.native_body_complete = true;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(observation.native_text));
    observation.decoded_utf8_sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (response.status !== 200) throw new Error(`Secondary structure source returned HTTP ${response.status}`);
    if (response.headers.has("content-range")) throw new Error("Secondary structure source returned a partial representation");
    if (Date.now() >= deadline) throw new Error("Secondary structure read exceeded 30 seconds");
    return observation.native_text;
  } finally { clearTimeout(timer); controller.abort(); }
}
