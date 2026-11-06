import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:5174' },
    // Local model credentials/cache must never be served by Vite's file server.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/artifacts/**'] },
    watch: { ignored: ['**/artifacts/**', '**/data/**', '**/tags.json'] },
  },
});
