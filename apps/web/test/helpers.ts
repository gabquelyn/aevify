/** Helpers for calling route handlers directly, like Next.js does. */

export function jsonRequest(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

export async function json<T = any>(input: Response | Promise<Response>): Promise<{ status: number; body: T; headers: Headers }> {
  const response = await input;
  return { status: response.status, body: (await response.json()) as T, headers: response.headers };
}

export const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
