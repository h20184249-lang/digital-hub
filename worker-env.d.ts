declare module 'cloudflare:node' {
  export interface HttpServerHandlerOptions {
    port: number;
  }

  export function httpServerHandler(options: HttpServerHandlerOptions): {
    fetch: (request: Request, env: Record<string, unknown>, ctx: unknown) => Promise<Response> | Response;
  };
}
