import { createAppServer } from '../server/http.mjs';
const port = Number(process.env.PORT) || 5173;
const server = await createAppServer({ production: true, port });
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Stop the other instance or set PORT in .env.` : 'Local service could not start. Check the port and directory permissions.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`WildScene: http://127.0.0.1:${port}`));
