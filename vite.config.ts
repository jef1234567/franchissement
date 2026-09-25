import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Build = un seul fichier HTML autonome (aucune ressource externe), utilisable
// sur poste isolé en ouvrant simplement le fichier (file://).
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
  build: { outDir: 'dist', assetsInlineLimit: 100_000_000, cssCodeSplit: false },
  test: { include: ['src/**/*.test.ts'] },
});
