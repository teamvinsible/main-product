import type { IntakePlan, SpineSnapshot } from "@teamvinsible/shared";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export function fetchSpine(project?: string) {
  const q = project ? `?project=${encodeURIComponent(project)}` : "";
  return req<SpineSnapshot>(`/api/spine${q}`);
}

export function submitIntake(body: { idea?: string; text?: string; kind?: string; url?: string }) {
  return req<IntakePlan & Record<string, unknown>>("/api/intake", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startRun(body: Record<string, unknown>) {
  return req<{ ok?: boolean; error?: string }>("/api/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchHealth() {
  return req<{ ok: boolean; swarm: boolean; platformHost: string }>("/api/health");
}
