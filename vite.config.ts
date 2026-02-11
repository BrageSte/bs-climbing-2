import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core — always needed
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/')) {
            return 'react-vendor';
          }
          // Three.js — DO NOT put in manualChunks; Vite adds modulepreload
          // for all manual chunks which defeats lazy loading. Let Vite
          // code-split naturally so it only loads when /configure is visited.
          // Radix UI — all packages in one chunk
          if (id.includes('node_modules/@radix-ui/')) {
            return 'radix-vendor';
          }
          // Supabase
          if (id.includes('node_modules/@supabase/')) {
            return 'supabase-vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
    exclude: ['three', '@react-three/fiber', '@react-three/drei'],
  },
}));
