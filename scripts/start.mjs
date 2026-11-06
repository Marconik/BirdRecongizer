import { createAppServer } from '../server/http.mjs';
const port = Number(process.env.PORT) || 5173;
const server = await createAppServer({ production: true, port });
server.listen(port, '127.0.0.1', () => console.log(`WildScene: http://127.0.0.1:${port}`));
