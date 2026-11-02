import { serve as denoServe } from "https://deno.land/std@0.177.0/http/server.ts";
import { withSecurityLogging } from "./observability.ts";

type RequestHandler = (request: Request) => Response | Promise<Response>;

/**
 * Register an Edge Function with shared request and security telemetry.
 * Existing request spans are retained and correlated with the one completion
 * event emitted here after the handler response is known.
 */
export const serve = (handler: RequestHandler) =>
  denoServe((request) => {
    const pathname = new URL(request.url).pathname;
    const operation = `${request.method.toUpperCase()} ${pathname}`;
    return withSecurityLogging(
      request,
      operation,
      async () => await handler(request),
    );
  });
