import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/offline', emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: Infinity,
    lib: { entry: 'src/offline-main.tsx', name: 'FormaOfflinePreview', formats: ['iife'], fileName: () => 'preview.js', cssFileName: 'preview' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
