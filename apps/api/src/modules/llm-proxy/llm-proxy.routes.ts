import { Elysia } from 'elysia';
import { settingsService } from '../settings/settings.service';

const PROVIDERS: Record<string, { upstream: string; settingsKey: string; authHeader: (key: string) => [string, string] }> = {
  anthropic: {
    upstream: 'https://api.anthropic.com',
    settingsKey: 'ANTHROPIC_API_KEY',
    authHeader: (key) => ['x-api-key', key],
  },
  openai: {
    upstream: 'https://api.openai.com',
    settingsKey: 'OPENAI_API_KEY',
    authHeader: (key) => ['authorization', `Bearer ${key}`],
  },
};

async function handleLlmProxy(
  request: Request,
  provider: string,
  subpath: string,
): Promise<Response> {
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = await settingsService.get(cfg.settingsKey);
  if (!apiKey) {
    return new Response(JSON.stringify({ error: `No API key configured for ${provider}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const incoming = new URL(request.url);
  const target = incoming.search
    ? `${cfg.upstream}/${subpath}${incoming.search}`
    : `${cfg.upstream}/${subpath}`;

  try {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');
    // Prevent compressed responses — Bun's fetch auto-decompresses but
    // forwards Content-Encoding, causing a double-decode on the client.
    headers.delete('accept-encoding');

    // Replace auth — strip any dummy credentials, inject the real key
    headers.delete('x-api-key');
    headers.delete('authorization');
    const [headerName, headerValue] = cfg.authHeader(apiKey);
    headers.set(headerName, headerValue);

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: 'manual',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      (init as any).duplex = 'half';
    }

    const upstream = await fetch(target, init);

    const respHeaders = new Headers();
    const skipHeaders = new Set(['transfer-encoding', 'content-encoding', 'content-length']);
    upstream.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        respHeaders.set(key, value);
      }
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `LLM proxy error: ${err instanceof Error ? err.message : String(err)}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

const LLM_PROXY_PATTERN = /^\/llm-proxy\/(anthropic|openai)(\/.*)?$/;

export const llmProxyRoutes = new Elysia()
  .onRequest(({ request }) => {
    const url = new URL(request.url);
    const match = url.pathname.match(LLM_PROXY_PATTERN);
    if (!match) return undefined;

    const [, provider, rest] = match;
    const subpath = (rest || '/').replace(/^\//, '');
    return handleLlmProxy(request, provider, subpath);
  });
