import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The browser harness: the real renderer over a fake main process (see main.tsx). For development only;
// the Electron build never includes it.
export default defineConfig({
  root: here('.'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: here('../out/harness'),
    emptyOutDir: true,
    rolldownOptions: { input: [here('index.html'), here('app.html')] },
  },
});
