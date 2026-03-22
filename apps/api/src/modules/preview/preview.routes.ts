import { Elysia } from 'elysia';
import { projectsService } from '../projects/projects.service';

async function resolveTarget(
  projectId: string,
  port: string,
): Promise<{ targetBase: string; error?: string }> {
  try {
    const project = await projectsService.findById(projectId);
    if (!project.sandboxId) return { targetBase: '', error: 'Sandbox not ready' };

    const manager = projectsService.getSandboxManager(project.provider);
    if (!manager) return { targetBase: '', error: 'Sandbox manager not available' };

    const { url } = await manager.getPortPreviewUrl(project.sandboxId, Number(port));
    return { targetBase: url.replace(/\/$/, '') };
  } catch (err) {
    return { targetBase: '', error: String(err) };
  }
}

async function handleProxy(request: Request, projectId: string, port: string, subpath: string): Promise<Response> {
  const { targetBase, error } = await resolveTarget(projectId, port);
  if (error) {
    return new Response(JSON.stringify({ error }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const incoming = new URL(request.url);
  const target = incoming.search
    ? `${targetBase}/${subpath}${incoming.search}`
    : `${targetBase}/${subpath}`;

  try {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');

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
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'transfer-encoding') {
        respHeaders.set(key, value);
      }
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Proxy error: ${err instanceof Error ? err.message : String(err)}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

const PREVIEW_PATTERN = /^\/preview\/([^/]+)\/(\d+)(\/.*)?$/;

export const previewRoutes = new Elysia()
  .onRequest(({ request }) => {
    const url = new URL(request.url);
    const match = url.pathname.match(PREVIEW_PATTERN);
    if (!match) return undefined;

    const [, projectId, port, rest] = match;

    if (!rest) {
      return new Response(null, {
        status: 302,
        headers: { Location: `/preview/${projectId}/${port}/${url.search}` },
      });
    }

    const subpath = rest.replace(/^\//, '');
    return handleProxy(request, projectId, port, subpath);
  });
