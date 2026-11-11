import { readRnaText } from "./read";

/** Keep bounded error evidence and distinguish missing bytes from an empty result. */
export async function readNativeBody(response: Response, deadline: number): Promise<string> {
  let text: string;
  try { text = await readRnaText(response, deadline, true); }
  catch (error) {
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${error instanceof Error ? error.message : String(error)}`), {
      status: response.status, data: { http_status: response.status, body_unavailable: true,
        retry_after: response.headers.get("retry-after"), body_error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`), { status: response.status, data: text });
  if (response.status !== 200 || response.headers.has("content-range")) throw Object.assign(new Error("Expected a complete HTTP-200 representation"), { status: 502, data: text });
  return text;
}

export function parseNativeJson(text: string, response: Response, provider: string): unknown {
  if (!(response.headers.get("content-type") ?? "").includes("json")) throw Object.assign(new Error(`Expected ${provider}JSON, not an upstream HTML error page.`), { status: 502, data: text });
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw Object.assign(new Error("Upstream returned malformed JSON"), { status: 502, data: text }); }
}

/** Bound headers and body together even when a fetch/stream ignores cancellation. */
export async function fetchScimodomBody(url: string): Promise<{ response: Response; text: string }> {
  const deadline = Date.now() + 30_000; const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = fetch(url, { headers: { Accept: "application/json" }, redirect: "manual", signal: controller.signal });
    void pending.then(late => { if (controller.signal.aborted) void late.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("Sci-ModoM response deadline exceeded"), { status: 504 })); }, Math.max(0, deadline - Date.now()));
    })]);
    return { response, text: await readNativeBody(response, deadline) };
  } finally { clearTimeout(timer); controller.abort(); }
}
