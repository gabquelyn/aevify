import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Consistent JSON errors for every API route:
 *   { "error": { "type": "invalid_request", "message": "...", "param": "amount" } }
 */
export type ErrorType =
  | "invalid_request"
  | "authentication_required"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "merchant_not_ready"
  | "service_unavailable"
  | "chain_error"
  | "internal_error";

export function apiError(status: number, type: ErrorType, message: string, param?: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { type, message, ...(param ? { param } : {}) } }, { status, headers });
}

export function validationError(error: ZodError) {
  const issue = error.issues[0];
  const param = issue?.path.join(".") || undefined;
  return apiError(400, "invalid_request", issue ? `${param ? `${param}: ` : ""}${issue.message}` : "Invalid request.", param);
}

/** Parse a JSON body; returns undefined for a missing or malformed body. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * Wrap a route handler so unexpected errors become a clean 500 (details stay in the
 * server log) and known configuration errors become a 503.
 */
export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof Error && error.name === "DatabaseNotConfiguredError") {
        return apiError(503, "service_unavailable", "Database isn't configured (MONGODB_URI).");
      }
      if (error instanceof Error && error.name === "ChainNotConfiguredError") {
        return apiError(503, "service_unavailable", error.message);
      }
      console.error("[api] Unhandled error:", error);
      return apiError(500, "internal_error", "Something went wrong. Please try again.");
    }
  };
}
