import { httpServerHandler } from 'cloudflare:node';
import { createApiApp } from './server/apiApp.ts';
import { setWorkerRuntimeEnv } from './server/db.ts';

const app = createApiApp();
app.listen(3000);

const handler = httpServerHandler({ port: 3000 });

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: unknown): Promise<Response> {
    setWorkerRuntimeEnv(env);
    return handler.fetch(request, env, ctx);
  },
};
