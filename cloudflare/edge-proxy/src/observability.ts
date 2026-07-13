export type SentryDsn = {
  publicKey: string;
  projectId: string;
  storeUrl: string;
};

export type ObservabilityDependencies = {
  randomUUID: () => string;
  now: () => number;
  currentDate?: () => Date;
};

const defaultDependencies: ObservabilityDependencies = {
  randomUUID: () => crypto.randomUUID(),
  now: () => Date.now(),
  currentDate: () => new Date(),
};

export const parseSentryDsn = (dsn?: string | null): SentryDsn | null => {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\/+/, "");
    if (!publicKey || !projectId) return null;
    return {
      publicKey,
      projectId,
      storeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
};

export const buildSentryEnvelope = (
  _dsn: SentryDsn,
  event: Record<string, unknown>,
  dependencies: ObservabilityDependencies = defaultDependencies,
) => {
  const eventId = dependencies.randomUUID().replace(/-/g, "");
  const now = dependencies.now();
  const envelopeHeaders = JSON.stringify({
    event_id: eventId,
    sent_at: (dependencies.currentDate?.() ?? new Date(now)).toISOString(),
  });
  const itemHeaders = JSON.stringify({ type: "event" });
  const payload = JSON.stringify({
    event_id: eventId,
    timestamp: Math.floor(now / 1000),
    platform: "javascript",
    logger: "itemtraxx-edge-proxy",
    ...event,
  });
  return `${envelopeHeaders}
${itemHeaders}
${payload}`;
};

export const reportWorkerEvent = async (
  env: Env,
  event: Record<string, unknown>,
) => {
  const sentry = parseSentryDsn(env.SENTRY_DSN?.trim());
  if (!sentry) return;

  const envelope = buildSentryEnvelope(sentry, event);
  await fetch(sentry.storeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth":
        `Sentry sentry_version=7, sentry_client=itemtraxx-edge-proxy/1.0, sentry_key=${sentry.publicKey}`,
    },
    body: envelope,
  }).catch(() => undefined);
};

export const reportWorkerException = (
  env: Env,
  request: Request,
  requestId: string,
  error: unknown,
  extra: Record<string, unknown> = {},
) => {
  const message = error instanceof Error ? error.message : String(error);
  return reportWorkerEvent(env, {
    level: "error",
    environment: env.SENTRY_ENVIRONMENT?.trim() || "production",
    request: {
      url: request.url,
      method: request.method,
      headers: { origin: request.headers.get("origin") ?? undefined },
    },
    tags: { runtime: "cloudflare-worker" },
    extra: { requestId, ...extra },
    exception: {
      values: [{
        type: error instanceof Error ? error.name : "WorkerError",
        value: message,
      }],
    },
  });
};

export const reportWorkerHttpFailure = (
  env: Env,
  request: Request,
  requestId: string,
  status: number,
  message: string,
  extra: Record<string, unknown> = {},
) =>
  reportWorkerEvent(env, {
    level: status >= 500 ? "error" : "warning",
    environment: env.SENTRY_ENVIRONMENT?.trim() || "production",
    request: {
      url: request.url,
      method: request.method,
      headers: { origin: request.headers.get("origin") ?? undefined },
    },
    tags: { runtime: "cloudflare-worker", status: String(status) },
    extra: { requestId, ...extra },
    message,
  });

export const maybeReportWorkerResponse = (
  env: Env,
  request: Request,
  requestId: string,
  response: Response,
  ctx: ExecutionContext,
  extra: Record<string, unknown> = {},
) => {
  if (response.status < 500) return;
  ctx.waitUntil(
    reportWorkerHttpFailure(
      env,
      request,
      requestId,
      response.status,
      `Worker request failed with status ${response.status}.`,
      extra,
    ),
  );
};
