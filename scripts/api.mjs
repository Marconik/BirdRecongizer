import { createAppServer } from '../server/http.mjs';
const server = await createAppServer();
server.listen(5174, '127.0.0.1', () => console.log('WildScene API: http://127.0.0.1:5174'));
