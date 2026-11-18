import { httpServerHandler } from 'cloudflare:node';
import { createApiApp } from './server/apiApp.ts';

const app = createApiApp();
app.listen(3000);

export default httpServerHandler({ port: 3000 });
