import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: false,
  },
  plugins: [
    {
      name: 'music-directory-scanner',
      configureServer(server) {
        server.middlewares.use('/api/music-tracks', (_req, res) => {
          const musicDir = path.resolve(process.cwd(), 'public', 'music');
          let files: string[] = [];
          try {
            if (fs.existsSync(musicDir)) {
              files = fs
                .readdirSync(musicDir)
                .filter((f) => /\.(mp3|ogg|wav|m4a)$/i.test(f))
                .map((f) => `/music/${encodeURIComponent(f)}`);
            }
          } catch {
            // fallback
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
        });
      },
    },
  ],
  build: {
    target: 'esnext',
  },
});

