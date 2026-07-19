export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "invalid_request",
  ) {
    super(message);
  }
}

export async function readJsonObject(
  request: Request,
  maxBytes = 32 * 1024,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestError("Request body is too large", 413, "body_too_large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("JSON body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RequestError("Request body is too large", 413, "body_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError("Invalid JSON body", 400, "invalid_json");
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new RequestError("JSON body must be an object");
  }
  return value as Record<string, unknown>;
}

export function stringField(
  body: Record<string, unknown>,
  names: string | string[],
  options: { required?: boolean; maxLength?: number; fallback?: string } = {},
): string {
  const keys = Array.isArray(names) ? names : [names];
  const raw = keys.map((key) => body[key]).find((value) => value !== undefined);
  if (raw === undefined || raw === null || raw === "") {
    if (options.required) throw new RequestError(`${keys[0]} is required`);
    return options.fallback || "";
  }
  if (typeof raw !== "string") throw new RequestError(`${keys[0]} must be a string`);
  const value = raw.trim();
  if (options.required && !value) throw new RequestError(`${keys[0]} is required`);
  if (value.length > (options.maxLength ?? 2_000)) {
    throw new RequestError(`${keys[0]} exceeds the maximum length`);
  }
  return value;
}

export function slugField(body: Record<string, unknown>, name = "slug"): string {
  const value = stringField(body, name, { maxLength: 48 });
  if (value && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new RequestError("slug must contain lowercase letters, numbers, and single hyphens only");
  }
  return value;
}
