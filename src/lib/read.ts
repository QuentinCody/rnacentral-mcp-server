const MAX_BYTES = 4 * 1024 * 1024;

/** Bound decoded response bytes and body time, including error and text formats. */
export async function readRnaText(response: Response, deadline: number, preserveBom = false): Promise<string> {
  const tooLarge = () => new Error("RNAcentral response exceeds 4 MiB; narrow the query or page size.");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: preserveBom });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("RNAcentral response deadline exceeded.")), Math.max(0, deadline - Date.now()));
  });
  let bytes = 0; let text = "";
  try {
    while (true) {
      if (Date.now() >= deadline) throw new Error("RNAcentral response deadline exceeded.");
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw tooLarge();
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
