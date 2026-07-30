import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Durante o desenvolvimento (npm run dev dentro de /web) as chamadas a /api
// são redirecionadas para o Express local, para não esbarrar em CORS.
export default defineConfig({
  plugins: [react()],
  // Necessário quando o projeto está numa unidade de rede mapeada (ex: S:\
  // apontando para um compartilhamento \\servidor\...): sem isso o Vite usa
  // fs.realpath nativo, que resolve o caminho para o UNC real do servidor e
  // quebra a resolução de módulos ("Could not load /servidor/.../main.jsx").
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
    // Unidades de rede mapeadas geralmente não suportam fs.watch nativo do
    // Windows (o servidor de dev derruba com "UNKNOWN: unknown error,
    // watch") — polling evita depender dessa API.
    watch: {
      usePolling: true,
    },
  },
});
