export type GatewayOperation = 'encrypt' | 'decrypt' | 'hash-index';

// The override is server-only and restricted to loopback for local integration.
export function resolveGatewayOrigin(localOrigin: string | undefined): string {
  if (!localOrigin) return 'https://sgw.itemtraxx.com';
  try {
    const url = new URL(localOrigin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new Error('Gateway unavailable'); }
}

// Never accept a URL from a client: this function holds the internal bearer.
export async function callGateway(
  operation: GatewayOperation,
  body: Record<string, unknown>,
  secret: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  if (secret.length < 32) throw new Error('Gateway unavailable');
  try {
    const origin = resolveGatewayOrigin(Deno.env.get('ITX_SGW_LOCAL_ORIGIN'));
    const response = await fetcher(`${origin}/v1/crypto/${operation}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Gateway unavailable');
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Gateway unavailable');
    return result as Record<string, unknown>;
  } catch {
    throw new Error('Gateway unavailable');
  }
}
